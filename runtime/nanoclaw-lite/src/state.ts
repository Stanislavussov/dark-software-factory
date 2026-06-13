import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PublicConfigSnapshot, RuntimeConfig, RuntimeState, Task, TaskStatus } from "./types.js";

const FINAL_STATUSES = new Set<TaskStatus>(["pushed", "discarded", "archived"]);

export class StateStore {
  config: RuntimeConfig;
  statePath: string;
  tasksDir: string;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.statePath = join(config.dataDir, "state.json");
    this.tasksDir = join(config.dataDir, "tasks");
  }

  async init(): Promise<RuntimeState> {
    await mkdir(this.tasksDir, { recursive: true });
    const state = await this.readState();
    if (!state.activeTaskId) return state;
    const task = await this.readTask(state.activeTaskId).catch(() => null);
    if (!task || FINAL_STATUSES.has(task.status)) {
      state.activeTaskId = null;
      await this.writeState(state);
    } else if (task.status === "running") {
      task.status = "failed";
      task.latestFailure = { type: "crashed_or_interrupted", summary: "Runtime restarted while task was running." };
      task.updatedAt = now();
      await this.writeTask(task);
    }
    return state;
  }

  async readState(): Promise<RuntimeState> {
    try {
      return parseState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      return { activeTaskId: null, recentTaskIds: [], recoveryLock: null };
    }
  }

  async writeState(state: RuntimeState): Promise<void> {
    await atomicWriteJson(this.statePath, state);
  }

  taskPath(taskId: string): string {
    return join(this.tasksDir, `${taskId}.json`);
  }

  async readTask(taskId: string): Promise<Task> {
    return parseTask(JSON.parse(await readFile(this.taskPath(taskId), "utf8")));
  }

  async writeTask(task: Task): Promise<void> {
    await atomicWriteJson(this.taskPath(task.id), task);
  }

  async activeTask(): Promise<Task | null> {
    const state = await this.readState();
    if (!state.activeTaskId) return null;
    return this.readTask(state.activeTaskId);
  }

  async listTasks(limit = 20): Promise<Task[]> {
    const state = await this.readState();
    const fromState = state.recentTaskIds;
    const fromDisk = await this.taskIdsFromDisk();
    const ids = [...fromState, ...fromDisk].filter((id, index, all) => all.indexOf(id) === index);
    const tasks = await Promise.all(ids.map((id) => this.readTask(id).catch(() => null)));
    return tasks
      .filter((task): task is Task => task !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async setActiveTask(task: Task): Promise<void> {
    const state = await this.readState();
    state.activeTaskId = task.id;
    state.recentTaskIds = [task.id, ...(state.recentTaskIds || []).filter((id) => id !== task.id)].slice(0, 20);
    await this.writeTask(task);
    await this.writeState(state);
  }

  async clearActiveTask(): Promise<void> {
    const state = await this.readState();
    state.activeTaskId = null;
    await this.writeState(state);
  }

  async taskIdsFromDisk(): Promise<string[]> {
    try {
      const entries = await readdir(this.tasksDir);
      return entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -".json".length));
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      return [];
    }
  }
}

export function createTask({
  prompt,
  branch,
  configSnapshot,
  logPath,
}: {
  prompt: string;
  branch: string;
  configSnapshot: PublicConfigSnapshot;
  logPath: string;
}): Task {
  const id = `${compactDate(new Date())}-${slug(prompt)}`;
  return {
    id,
    prompt,
    status: "running",
    branch,
    baseBranch: configSnapshot.targetBranch,
    commitHash: null,
    pushedCommitHash: null,
    remoteBranch: null,
    compareUrl: null,
    createdAt: now(),
    updatedAt: now(),
    lastFailedGate: null,
    latestFailure: null,
    latestReview: null,
    latestManualFixNote: null,
    logPath,
    configSnapshot,
  };
}

export function branchNameFor(prompt: string): string {
  return `autonomous/${branchStamp(new Date())}-${slug(prompt)}`;
}

export function now(): string {
  return new Date().toISOString();
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

function compactDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function branchStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 16).replace(":", "")}`;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "task"
  );
}

function parseState(value: unknown): RuntimeState {
  if (!value || typeof value !== "object") throw new Error("Invalid runtime state file.");
  const candidate = value as Record<string, unknown>;
  return {
    activeTaskId: typeof candidate.activeTaskId === "string" ? candidate.activeTaskId : null,
    recentTaskIds: Array.isArray(candidate.recentTaskIds)
      ? candidate.recentTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    recoveryLock: typeof candidate.recoveryLock === "string" ? candidate.recoveryLock : null,
  };
}

function parseTask(value: unknown): Task {
  if (!value || typeof value !== "object") throw new Error("Invalid task file.");
  return value as Task;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
