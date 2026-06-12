import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { publicConfigSnapshot } from "./config.js";
import { GateRunner } from "./gates.js";
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
        case "/logs":
          return bot.send(message.chatId, await this.logsText());
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
        await this.failTask(
          task,
          "gate",
          `Gate ${gateResult.failedGate.id} failed before push.`,
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
    await mkdir(this.config.logsDir, { recursive: true });
    await git.ensureRepo({ syncTargetBranch: options.resetBranch });
    if (options.resetBranch) {
      await git.createBranch(task.branch);
    } else if (task.latestFailure?.type === "rebase") {
      await taskLogger.info("task.fix_rebase_conflict", { branch: task.branch });
    } else {
      await git.checkoutBranch(task.branch);
    }
    const implementation = await opencode.implement(prompt);
    if (implementation.code !== 0)
      return this.failTask(task, "opencode", `OpenCode exited ${implementation.code}.`, implementation);
    let nextGate = options.startGateId ?? null;
    for (let attempt = 0; attempt <= this.config.maxFixAttempts; attempt += 1) {
      const gateResult = await gates.runFrom(nextGate);
      if (gateResult.ok) break;
      task.lastFailedGate = gateResult.failedGate;
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
      const fixPrompt = `Fix failed gate ${gateResult.failedGate.id}: ${gateResult.failedGate.command}\nExit code: ${gateResult.result.code}\n\nCurrent diff:\n${diff}`;
      const fix = await opencode.implement(fixPrompt);
      if (fix.code !== 0)
        return this.failTask(task, "opencode_fix", `OpenCode fix exited ${fix.code}.`, fix, gateResult.failedGate);
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
    await this.store.writeTask(task);
  }

  async discard(bot: TelegramSender, chatId: string, text: string): Promise<unknown> {
    const task = await this.store.activeTask();
    if (!task || !["failed", "ready_for_push"].includes(task.status)) return bot.send(chatId, "No discardable task.");
    if (text.trim() !== "confirm") {
      this.discardRequestedFor = task.id;
      return bot.send(chatId, `Send /discard confirm to delete local work for ${task.id}.`);
    }
    if (this.discardRequestedFor !== task.id) return bot.send(chatId, "Send /discard first, then /discard confirm.");
    const git = new GitClient(this.config, this.logger.withFile(task.logPath));
    await git.discardBranch(task.branch);
    task.status = "discarded";
    task.updatedAt = now();
    await this.store.writeTask(task);
    await this.store.clearActiveTask();
    return bot.send(chatId, `Discarded ${task.id}.`);
  }

  async archive(bot: TelegramSender, chatId: string): Promise<unknown> {
    const task = await this.store.activeTask();
    if (!task || !["failed", "ready_for_push"].includes(task.status)) return bot.send(chatId, "No archivable task.");
    task.status = "archived";
    task.updatedAt = now();
    await this.store.writeTask(task);
    await this.store.clearActiveTask();
    return bot.send(chatId, `Archived ${task.id}.`);
  }

  async statusText(): Promise<string> {
    const state = await this.store.readState();
    const task = state.activeTaskId ? await this.store.readTask(state.activeTaskId) : null;
    if (!task) return "State: idle\nNext: /run <prompt>";
    return [
      `State: ${task.status}`,
      `Task: ${task.id}`,
      `Branch: ${task.branch}`,
      `Base: ${task.baseBranch}`,
      `Last gate: ${task.lastFailedGate?.id || "none"}`,
      `Next: ${nextAction(task.status)}`,
    ].join("\n");
  }

  async logsText(): Promise<string> {
    const task = await this.store.activeTask();
    if (!task) return "No active task.";
    let text = "";
    try {
      text = await readFile(task.logPath, "utf8");
    } catch {
      return `Task ${task.id} has no log yet.`;
    }
    return `Task ${task.id} log tail:\n${tail(text, this.config.logTailLines)}`;
  }
}

function helpText(): string {
  return [
    "Commands:",
    "/help",
    "/status",
    "/run <prompt>",
    "/fix [extra instructions]",
    "/logs",
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

function tail(text: string, lines: number): string {
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
