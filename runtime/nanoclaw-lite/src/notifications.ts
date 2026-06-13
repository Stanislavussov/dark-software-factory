import { readFile } from "node:fs/promises";
import type { LoggerLike, Task, TelegramSender } from "./types.js";

export class OperatorNotifier {
  bot: TelegramSender;
  chatId: string;
  logger: LoggerLike;

  constructor(bot: TelegramSender, chatId: string, logger: LoggerLike) {
    this.bot = bot;
    this.chatId = chatId;
    this.logger = logger;
  }

  async send(text: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.bot.send(this.chatId, text);
        return;
      } catch (error) {
        await this.logger.error("telegram.send_failed", { attempt: attempt + 1, error: errorMessage(error) });
        if (attempt < 2) await delay(250 * 2 ** attempt);
      }
    }
  }

  async taskStarted(task: Task): Promise<void> {
    await this.send([`Task started: ${task.id}`, `Branch: ${task.branch}`, "Next: wait or /cancel"].join("\n"));
  }

  async ready(task: Task): Promise<void> {
    await this.send(
      [
        `Ready for push: ${task.id}`,
        `Branch: ${task.branch}`,
        `Commit: ${task.commitHash || "none"}`,
        "Next: /push, /discard, or /archive",
      ].join("\n"),
    );
  }

  async pushed(task: Task): Promise<void> {
    await this.send(
      [`Pushed: ${task.branch}`, `Commit: ${task.pushedCommitHash || "unknown"}`, task.compareUrl || ""]
        .filter(Boolean)
        .join("\n"),
    );
  }

  async failed(task: Task): Promise<void> {
    const failure = task.latestFailure;
    if (!failure) {
      await this.send(`Task failed: ${task.id}`);
      return;
    }
    const lines = [
      `Task failed: ${task.id}`,
      `Stage: ${failure.type}`,
      `Branch: ${task.branch}`,
      failure.gate ? `Gate: ${failure.gate.id}` : "",
      failure.code !== undefined ? `Exit code: ${failure.code}` : "",
      failure.timedOut ? "Diagnosis: timed out" : `Diagnosis: ${failure.summary}`,
      `Next: ${failureNextActions(failure.type)}`,
      await logTail(task.logPath, 20),
    ];
    await this.send(lines.filter(Boolean).join("\n"));
  }

  async recovery(text: string): Promise<void> {
    await this.send(`Recovery:\n${text}`);
  }
}

export function failureNextActions(type: string): string {
  if (type === "gate_app" || type === "review_findings") return "/fix, /discard, or /archive";
  if (type === "recovery_lock") return "/doctor, /inspect, /discard confirm, or /archive";
  if (type === "cancelled") return "/fix, /discard, or /archive";
  return "/failure, /logs active, /discard, or /archive";
}

async function logTail(path: string, lines: number): Promise<string> {
  try {
    const text = await readFile(path, "utf8");
    const tail = text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
    return tail ? `Log tail:\n${tail}` : "";
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
