import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { Env, LoggerLike } from "./types.js";

export type ProcessResult = {
  code: number;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  stdout: string;
  stderr: string;
};

export type ProcessOptions = {
  command: string;
  args?: string[];
  cwd: string;
  input?: string;
  timeoutMs: number;
  env?: Env;
  logger?: LoggerLike;
  allowCancel?: (child: ChildProcessWithoutNullStreams) => void;
};

export function runProcess({
  command,
  args = [],
  cwd,
  input = "",
  timeoutMs,
  env = {},
  logger,
  allowCancel,
}: ProcessOptions): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5000).unref();
          }, timeoutMs)
        : null;

    if (allowCancel) allowCancel(child);
    child.stdin.end(input);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      logSubprocessOutput(logger, "subprocess.stdout", command, text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      logSubprocessOutput(logger, "subprocess.stderr", command, text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: 127, timedOut, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, signal, timedOut, stdout, stderr });
    });
  });
}

export function shell(
  command: string,
  options: Omit<ProcessOptions, "command" | "args" | "input">,
): Promise<ProcessResult> {
  return runProcess({ command: "sh", args: ["-lc", command], ...options });
}

function logSubprocessOutput(logger: LoggerLike | undefined, message: string, command: string, text: string): void {
  const cleanText = stripVTControlCharacters(text).trimEnd();
  if (!cleanText) return;
  logger?.info(message, { command, text: cleanText });
}
