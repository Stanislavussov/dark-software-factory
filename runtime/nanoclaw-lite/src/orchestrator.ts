import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { publicConfigSnapshot } from "./config.js";
import { classifyGateFailure, GateRunner } from "./gates.js";
import { compareUrl, GitClient } from "./git.js";
import { Logger } from "./logger.js";
import { OpenCodeRunner } from "./opencode.js";
import type { ProcessResult } from "./process.js";
import { branchNameFor, createTask, now } from "./state.js";
import type { Gate, LoggerLike, RuntimeConfig, Task, TaskStatus, TelegramCommand, TelegramSender } from "./types.js";

type ExecuteTaskOptions = {
  resetBranch: boolean;
  startGateId?: string | null;
};

type LogEvent = {
  ts: string;
  message: string;
  level?: string;
  fields: Record<string, unknown>;
};

const TERMINAL_LOG_EVENTS = new Set([
  "task.failed",
  "task.ready_for_push",
  "task.pushed",
  "task.archived",
  "task.discarded",
  "task.cancelled",
]);

const PROTECTED_PATHS = ["deploy/nanoclaw-tooling/", ".dockerignore", "pnpm-lock.yaml"];

export class Orchestrator {
  config: RuntimeConfig;
  store: import("./state.js").StateStore;
  logger: LoggerLike;
  running: boolean;
  phase: "idle" | "run" | "fix" | "push";
  currentChild: import("node:child_process").ChildProcessWithoutNullStreams | null;
  discardRequestedFor: string | null;

  constructor(config: RuntimeConfig, store: import("./state.js").StateStore, logger: LoggerLike) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.running = false;
    this.phase = "idle";
    this.currentChild = null;
    this.discardRequestedFor = null;
  }

  async handle(bot: TelegramSender, message: TelegramCommand): Promise<unknown> {
    try {
      switch (message.command) {
        case "/help":
          return bot.send(message.chatId, helpText());
        case "/status":
          return bot.send(message.chatId, await this.statusText());
        case "/tasks":
          return bot.send(message.chatId, await this.tasksText());
        case "/logs":
          return bot.send(message.chatId, await this.logsText(message.text));
        case "/inspect":
          return bot.send(message.chatId, await this.inspectText());
        case "/run":
          return this.run(bot, message.chatId, message.text);
        case "/fix":
          return this.fix(bot, message.chatId, message.text);
        case "/push":
          return this.push(bot, message.chatId);
        case "/discard":
          return this.discard(bot, message.chatId, message.text);
        case "/archive":
          return this.archive(bot, message.chatId);
        case "/cancel":
          return this.cancel(bot, message.chatId);
        default:
          return bot.send(message.chatId, "Unknown command. Send /help.");
      }
    } catch (error) {
      const messageText = errorMessage(error);
      await this.logger.error("command.failed", { command: message.command, error: messageText });
      return bot.send(message.chatId, `Command failed: ${messageText}`);
    }
  }

  async run(bot: TelegramSender, chatId: string, prompt: string): Promise<unknown> {
    if (!prompt.trim()) return bot.send(chatId, "Usage: /run <prompt>");
    if (this.running) return bot.send(chatId, "A task is already running.");
    const active = await this.store.activeTask();
    if (active && active.status !== "pushed")
      return bot.send(chatId, `Blocked by ${active.status} task ${active.id}. Use /status.`);
    this.running = true;
    this.phase = "run";
    await bot.send(chatId, "Starting task.");
    try {
      const branch = branchNameFor(prompt);
      const logPath = join(this.config.logsDir, "tasks", `${branch.split("/").pop()}.log`);
      const task = createTask({ prompt, branch, configSnapshot: publicConfigSnapshot(this.config), logPath });
      await this.store.setActiveTask(task);
      await this.executeTask(task, prompt, { resetBranch: true });
      await bot.send(chatId, await this.statusText());
    } finally {
      this.running = false;
      this.phase = "idle";
    }
  }

  async fix(bot: TelegramSender, chatId: string, extra: string): Promise<unknown> {
    if (this.running) return bot.send(chatId, "A task is already running.");
    const task = await this.store.activeTask();
    if (task?.status !== "failed") return bot.send(chatId, "/fix is only available for a failed task.");
    this.running = true;
    this.phase = "fix";
    task.status = "running";
    task.latestManualFixNote = extra || null;
    task.updatedAt = now();
    await this.store.writeTask(task);
    await bot.send(chatId, "Retrying failed task.");
    try {
      const context = [
        "Fix the current failed task.",
        task.latestFailure ? JSON.stringify(task.latestFailure) : "",
        extra ? `Operator instructions: ${extra}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      await this.executeTask(task, context, { resetBranch: false, startGateId: task.lastFailedGate?.id || null });
      await bot.send(chatId, await this.statusText());
    } finally {
      this.running = false;
      this.phase = "idle";
    }
  }

  async push(bot: TelegramSender, chatId: string): Promise<unknown> {
    if (this.running) return bot.send(chatId, "A task is already running.");
    const task = await this.store.activeTask();
    if (task?.status !== "ready_for_push") return bot.send(chatId, "/push requires a ready_for_push task.");
    this.running = true;
    this.phase = "push";
    try {
      const taskLogger = this.logger.withFile(task.logPath);
      const git = new GitClient(this.config, taskLogger);
      const gates = new GateRunner(this.config, taskLogger);
      const opencode = new OpenCodeRunner(this.config, taskLogger);
      const rebase = await git.rebaseTarget();
      if (rebase.code !== 0) {
        await this.failTask(task, "rebase", "Rebase failed before push.", rebase);
        return bot.send(chatId, await this.statusText());
      }
      const gateResult = await gates.runFrom();
      if (!gateResult.ok) {
        const classification = classifyGateFailure(gateResult.result);
        await this.failTask(
          task,
          classification.type,
          classification.type === "infra_gate"
            ? `Gate ${gateResult.failedGate.id} failed before push due to tooling/runtime infrastructure: ${classification.summary}`
            : `Gate ${gateResult.failedGate.id} failed before push.`,
          gateResult.result,
          gateResult.failedGate,
        );
        return bot.send(chatId, await this.statusText());
      }
      const review = await opencode.review({ diff: await git.currentDiff() });
      if (review.result.status !== "clean") {
        await this.failTask(task, "review", review.result.summary, review.raw);
        return bot.send(chatId, await this.statusText());
      }
      const hash = await git.pushAutonomous(task.branch);
      task.status = "pushed";
      task.pushedCommitHash = hash;
      task.remoteBranch = task.branch;
      task.compareUrl = compareUrl(this.config, task.branch);
      task.updatedAt = now();
      await taskLogger.info("task.pushed", { branch: task.branch, commitHash: hash, compareUrl: task.compareUrl });
      await this.store.writeTask(task);
      await this.store.clearActiveTask();
      return bot.send(chatId, `Pushed ${task.branch}\nCommit: ${hash}\n${task.compareUrl}`);
    } finally {
      this.running = false;
      this.phase = "idle";
    }
  }

  async executeTask(task: Task, prompt: string, options: ExecuteTaskOptions): Promise<void> {
    const taskLogger = new Logger(task.logPath);
    const git = new GitClient(this.config, taskLogger);
    const gates = new GateRunner(this.config, taskLogger, (child) => {
      this.currentChild = child;
    });
    const opencode = new OpenCodeRunner(this.config, taskLogger, (child) => {
      this.currentChild = child;
    });
    const protectedPathsAllowed = allowsToolingChanges(task.prompt);
    const protectedPathInstruction = protectedPathsAllowed
      ? ""
      : [
          "Protected paths are off-limits for this task unless the operator explicitly asks for tooling or deployment changes.",
          `Do not edit: ${PROTECTED_PATHS.join(", ")}.`,
        ].join("\n");
    await mkdir(this.config.logsDir, { recursive: true });
    await git.ensureRepo({ syncTargetBranch: options.resetBranch });
    if (options.resetBranch) {
      await git.createBranch(task.branch);
    } else if (task.latestFailure?.type === "rebase") {
      await taskLogger.info("task.fix_rebase_conflict", { branch: task.branch });
    } else {
      await git.checkoutBranch(task.branch);
    }
    const implementation = await opencode.implement(prompt, protectedPathInstruction);
    if (implementation.code !== 0)
      return this.failTask(task, "opencode", `OpenCode exited ${implementation.code}.`, implementation);
    const initialProtectedPaths = protectedPathsAllowed ? [] : protectedChangedFiles(await git.changedFiles());
    if (initialProtectedPaths.length > 0) {
      return this.failTask(
        task,
        "protected_path",
        `OpenCode changed protected tooling paths without an explicit tooling/deployment request: ${initialProtectedPaths.join(", ")}`,
        undefined,
      );
    }
    let nextGate = options.startGateId ?? null;
    for (let attempt = 0; attempt <= this.config.maxFixAttempts; attempt += 1) {
      const gateResult = await gates.runFrom(nextGate);
      if (gateResult.ok) break;
      task.lastFailedGate = gateResult.failedGate;
      const classification = classifyGateFailure(gateResult.result);
      if (classification.type === "infra_gate") {
        return this.failTask(
          task,
          "infra_gate",
          `Gate ${gateResult.failedGate.id} failed due to tooling/runtime infrastructure: ${classification.summary}`,
          gateResult.result,
          gateResult.failedGate,
        );
      }
      if (attempt === this.config.maxFixAttempts) {
        return this.failTask(
          task,
          "gate",
          `Gate ${gateResult.failedGate.id} failed after ${attempt} fix attempts.`,
          gateResult.result,
          gateResult.failedGate,
        );
      }
      const diff = await git.currentDiff();
      const fixPrompt = [
        `Fix failed gate ${gateResult.failedGate.id}: ${gateResult.failedGate.command}`,
        `Exit code: ${gateResult.result.code}`,
        protectedPathInstruction,
        `Current diff:\n${diff}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const fix = await opencode.implement(fixPrompt, protectedPathInstruction);
      if (fix.code !== 0)
        return this.failTask(task, "opencode_fix", `OpenCode fix exited ${fix.code}.`, fix, gateResult.failedGate);
      const changedProtectedPaths = protectedPathsAllowed ? [] : protectedChangedFiles(await git.changedFiles());
      if (changedProtectedPaths.length > 0) {
        return this.failTask(
          task,
          "protected_path",
          `OpenCode fix changed protected tooling paths without an explicit tooling/deployment request: ${changedProtectedPaths.join(", ")}`,
          undefined,
          gateResult.failedGate,
        );
      }
      nextGate = gateResult.failedGate.id;
    }
    const review = await opencode.review({ diff: await git.currentDiff() });
    task.latestReview = review.result;
    if (review.result.status !== "clean") return this.failTask(task, "review", review.result.summary, review.raw);
    const commit = await git.commit(review.result.summary || "automated task");
    task.status = "ready_for_push";
    task.commitHash = commit;
    task.latestFailure = null;
    task.updatedAt = now();
    await taskLogger.info("task.ready_for_push", { branch: task.branch, commitHash: commit });
    await this.store.writeTask(task);
  }

  async cancel(bot: TelegramSender, chatId: string): Promise<unknown> {
    if (!this.running) return bot.send(chatId, "No running task.");
    if (this.phase === "push") return bot.send(chatId, "/cancel is rejected during /push.");
    if (this.currentChild) {
      const child = this.currentChild;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), this.config.cancelGraceMs).unref();
    }
    const task = await this.store.activeTask();
    if (task?.status === "running") {
      task.status = "failed";
      task.latestFailure = { type: "cancelled", summary: "Task cancelled by operator." };
      task.updatedAt = now();
      const taskLogger = new Logger(task.logPath);
      await taskLogger.error("task.cancelled", task.latestFailure);
      await taskLogger.error("task.failed", task.latestFailure);
      await this.store.writeTask(task);
    }
    return bot.send(chatId, "Cancellation requested.");
  }

  async failTask(
    task: Task,
    type: string,
    summary: string,
    result: ProcessResult | undefined,
    gate: Gate | null = null,
  ): Promise<void> {
    task.status = "failed";
    task.latestFailure = { type, summary, code: result?.code, gate };
    task.lastFailedGate = gate;
    task.updatedAt = now();
    await new Logger(task.logPath).error("task.failed", task.latestFailure);
    await this.store.writeTask(task);
  }

  async discard(bot: TelegramSender, chatId: string, text: string): Promise<unknown> {
    const task = await this.store.activeTask();
    if (!task || !["failed", "ready_for_push"].includes(task.status)) return bot.send(chatId, "No discardable task.");
    const wantsConfirm = text.trim() === "confirm" || this.discardRequestedFor === task.id;
    if (!wantsConfirm) {
      this.discardRequestedFor = task.id;
      return bot.send(chatId, `Send /discard again or /discard confirm to delete local work for ${task.id}.`);
    }
    const git = new GitClient(this.config, this.logger.withFile(task.logPath));
    await git.discardBranch(task.branch);
    task.status = "discarded";
    task.updatedAt = now();
    await new Logger(task.logPath).info("task.discarded", { branch: task.branch });
    await this.store.writeTask(task);
    await this.store.clearActiveTask();
    this.discardRequestedFor = null;
    return bot.send(chatId, `Discarded ${task.id}.`);
  }

  async archive(bot: TelegramSender, chatId: string): Promise<unknown> {
    const task = await this.store.activeTask();
    if (!task || !["failed", "ready_for_push"].includes(task.status)) return bot.send(chatId, "No archivable task.");
    task.status = "archived";
    task.updatedAt = now();
    await new Logger(task.logPath).info("task.archived", { branch: task.branch });
    await this.store.writeTask(task);
    await this.store.clearActiveTask();
    return bot.send(chatId, `Archived ${task.id}.`);
  }

  async statusText(): Promise<string> {
    const state = await this.store.readState();
    const task = state.activeTaskId ? await this.store.readTask(state.activeTaskId) : null;
    if (!task) {
      return [`State: idle`, `Runtime phase: ${this.phase}`, "Next: /run <prompt>", "History: /tasks or /logs latest"]
        .filter(Boolean)
        .join("\n");
    }
    const lastEvent = await lastLogEvent(task.logPath);
    const terminalEvent = await lastTerminalLogEvent(task.logPath);
    const inconsistent =
      task.status === "running" &&
      this.phase === "idle" &&
      terminalEvent &&
      terminalEvent.message !== "task.ready_for_push";
    return [
      inconsistent
        ? "State inconsistency: task JSON is running but runtime is idle and the log has a terminal event."
        : "",
      `State: ${task.status}`,
      `Runtime phase: ${this.phase}`,
      `Task: ${task.id}`,
      `Branch: ${task.branch}`,
      `Base: ${task.baseBranch}`,
      `Last gate: ${task.lastFailedGate?.id || "none"}`,
      lastEvent ? `Last log: ${lastEvent.ts} ${lastEvent.message}` : "Last log: none",
      terminalEvent ? `Terminal log: ${terminalEvent.ts} ${terminalEvent.message}` : "",
      task.latestFailure ? `Failure: ${failureText(task.latestFailure)}` : "",
      `Next: ${nextAction(task.status)}`,
      task.status === "failed" ? `Log tail: /logs ${task.id}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async tasksText(): Promise<string> {
    const tasks = await this.store.listTasks(10);
    if (tasks.length === 0) return "No tasks found.";
    const rows = await Promise.all(
      tasks.map(async (task) => {
        const terminalEvent = await lastTerminalLogEvent(task.logPath);
        const failure = task.latestFailure ? failureText(task.latestFailure) : terminalEvent?.message || "none";
        return `${task.id} | ${task.status} | ${task.branch} | ${task.updatedAt} | ${task.lastFailedGate?.id || "none"} | ${failure}`;
      }),
    );
    return ["Recent tasks:", "id | status | branch | updatedAt | last gate | failure/terminal", ...rows].join("\n");
  }

  async logsText(args = ""): Promise<string> {
    const selection = await this.selectTaskForLogs(args);
    if (!selection.task) return selection.error;
    const { task, lines } = selection;
    let text = "";
    try {
      text = await readFile(task.logPath, "utf8");
    } catch {
      return `Task ${task.id} has no log yet.`;
    }
    return `Task ${task.id} readable log tail (${lines} lines):\n\n${formatLogTail(text, lines)}`;
  }

  async inspectText(): Promise<string> {
    const state = await this.store.readState();
    const active = state.activeTaskId ? await this.store.readTask(state.activeTaskId).catch(() => null) : null;
    const logFiles = await knownLogFiles(join(this.config.logsDir, "tasks"));
    const lastEvent = active ? await lastLogEvent(active.logPath) : null;
    return [
      "Runtime inspection:",
      `Running: ${this.running ? "yes" : "no"}`,
      `Phase: ${this.phase}`,
      `Current child: ${this.currentChild ? `pid ${this.currentChild.pid ?? "unknown"}` : "none"}`,
      `Active task id: ${state.activeTaskId || "none"}`,
      active ? `Active task status: ${active.status}` : "",
      lastEvent ? `Active last log: ${lastEvent.ts} ${lastEvent.message}` : "Active last log: none",
      `Recent task ids: ${state.recentTaskIds.length ? state.recentTaskIds.join(", ") : "none"}`,
      `Known task logs: ${logFiles.length ? logFiles.join(", ") : "none"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async selectTaskForLogs(
    args: string,
  ): Promise<{ task: Task; lines: number; error: string } | { task: null; error: string }> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const maybeLines = Number(parts.at(-1));
    const hasLineArg = Number.isInteger(maybeLines) && maybeLines > 0;
    const lines = hasLineArg ? Math.min(maybeLines, 500) : this.config.logTailLines;
    const selector = hasLineArg ? parts.slice(0, -1).join(" ") : parts.join(" ");
    if (!selector || selector === "active") {
      const task = await this.store.activeTask();
      return task ? { task, lines, error: "" } : { task: null, error: "No active task. Try /logs latest or /tasks." };
    }
    const tasks = await this.store.listTasks(50);
    if (selector === "latest") {
      const task = tasks[0] || null;
      return task ? { task, lines, error: "" } : { task: null, error: "No tasks found." };
    }
    const task = tasks.find((candidate) => candidate.id === selector || candidate.id.startsWith(selector));
    if (!task) return { task: null, error: `Task not found: ${selector}` };
    return { task, lines, error: "" };
  }
}

function helpText(): string {
  return [
    "Commands:",
    "/help",
    "/status - read-only runtime and active task status",
    "/tasks - read-only recent task history",
    "/logs [active|latest|task-id] [lines] - read-only task log tail",
    "/inspect - read-only runtime diagnostics",
    "/run <prompt> - implementation task; may create a branch, edit the repo, and run install/build/lint/deps/test gates",
    "/fix [extra instructions]",
    "/discard",
    "/discard confirm",
    "/archive",
    "/cancel",
    "/push",
  ].join("\n");
}

function nextAction(status: TaskStatus): string {
  const actions: Record<TaskStatus, string> = {
    idle: "/run <prompt>",
    running: "wait or /cancel",
    failed: "/fix, /discard, or /archive",
    ready_for_push: "/push, /discard, or /archive",
    pushed: "/run <prompt>",
    discarded: "/run <prompt>",
    archived: "/run <prompt>",
  };
  return actions[status];
}

function failureText(failure: NonNullable<Task["latestFailure"]>): string {
  const parts = [failure.type];
  if (failure.code !== undefined) parts.push(`code ${failure.code}`);
  if (failure.gate) parts.push(`gate ${failure.gate.id}`);
  parts.push(failure.summary);
  return parts.join(": ");
}

function formatLogTail(text: string, lines: number): string {
  const selected = logLines(text).slice(-lines);
  if (selected.length === 0) return "(log is empty)";
  return selected.map(formatLogLine).join("\n\n");
}

function logLines(text: string): string[] {
  return text
    .replace(/\r?\n$/, "")
    .split(/\r?\n/)
    .filter(Boolean);
}

function formatLogLine(line: string): string {
  const event = parseLogLine(line);
  if (!event) return ["RAW", indentBlock(truncate(line, 1200))].join("\n");
  const fields = event.fields;
  const heading = `${formatLogTime(event.ts)} ${formatLogLevel(event.level)} ${formatLogMessage(event.message)}`;
  const details = formatLogFields(fields);
  return [heading, details].filter(Boolean).join("\n");
}

function formatLogTime(ts: string): string {
  const time = ts.includes("T") ? ts.slice(11, 19) : ts;
  return `[${time}]`;
}

function formatLogLevel(level: string | undefined): string {
  if (level === "error") return "ERROR";
  if (level === "info") return "INFO ";
  return "LOG  ";
}

function formatLogMessage(message: string): string {
  const labels: Record<string, string> = {
    "subprocess.stdout": "stdout",
    "subprocess.stderr": "stderr",
    "gate.start": "gate started",
    "gate.pass": "gate passed",
    "gate.failed": "gate failed",
    "task.failed": "task failed",
    "task.ready_for_push": "ready for push",
    "task.pushed": "pushed",
    "task.archived": "archived",
    "task.discarded": "discarded",
    "task.cancelled": "cancelled",
  };
  return labels[message] || message;
}

function formatLogFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["gate", "code", "type", "summary", "branch", "commitHash", "compareUrl", "command"]) {
    if (fields[key] !== undefined) parts.push(`  ${key}: ${formatFieldValue(fields[key])}`);
  }
  if (fields.text !== undefined) {
    parts.push("  output:");
    parts.push(indentBlock(truncate(String(fields.text), 1800)));
  }
  const shown = new Set(["gate", "code", "type", "summary", "branch", "commitHash", "compareUrl", "command", "text"]);
  for (const [key, value] of Object.entries(fields)) {
    if (!shown.has(key)) parts.push(`  ${key}: ${formatFieldValue(value)}`);
  }
  return parts.join("\n");
}

function formatFieldValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return truncate(String(value), 400).replace(/\s+/g, " ").trim();
  }
  return truncate(JSON.stringify(value), 600);
}

function indentBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .slice(0, 80)
    .map((line) => `    | ${line}`)
    .join("\n");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... truncated ${text.length - maxLength} chars`;
}

async function lastLogEvent(path: string): Promise<LogEvent | null> {
  const events = await readLogEvents(path);
  return events.at(-1) || null;
}

async function lastTerminalLogEvent(path: string): Promise<LogEvent | null> {
  const events = await readLogEvents(path);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && TERMINAL_LOG_EVENTS.has(event.message)) return event;
  }
  return null;
}

async function readLogEvents(path: string): Promise<LogEvent[]> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .slice(-200)
    .map(parseLogLine)
    .filter((event): event is LogEvent => event !== null);
}

function parseLogLine(line: string): LogEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.ts !== "string" || typeof candidate.message !== "string") return null;
    const { ts, message, level, ...fields } = candidate;
    return {
      ts,
      message,
      level: typeof level === "string" ? level : undefined,
      fields,
    };
  } catch {
    return null;
  }
}

async function knownLogFiles(dir: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    return [];
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".log"))
      .map(async (entry) => {
        const path = join(dir, entry);
        const info = await stat(path);
        return { name: basename(path), updatedAt: info.mtimeMs };
      }),
  );
  return files
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10)
    .map((file) => file.name);
}

function protectedChangedFiles(files: string[]): string[] {
  return files.filter((file) =>
    PROTECTED_PATHS.some((protectedPath) =>
      protectedPath.endsWith("/") ? file.startsWith(protectedPath) : file === protectedPath,
    ),
  );
}

function allowsToolingChanges(prompt: string): boolean {
  return /\b(tooling|deployment|deploy|docker|compose|dockerfile|pnpm-lock|lockfile|nanoclaw-tooling|ci|gate)\b/i.test(
    prompt,
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
