import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LogFields, LoggerLike } from "./types.js";

export class Logger implements LoggerLike {
  path: string;

  constructor(path = "") {
    this.path = path;
  }

  withFile(path: string): Logger {
    return new Logger(path);
  }

  async info(message: string, fields: LogFields = {}): Promise<void> {
    await this.write("info", message, fields);
  }

  async error(message: string, fields: LogFields = {}): Promise<void> {
    await this.write("error", message, fields);
  }

  async write(level: "info" | "error", message: string, fields: LogFields = {}): Promise<void> {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...redactFields(fields),
    });
    console.log(line);
    if (this.path) {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${line}\n`, "utf8");
    }
  }
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (/token|secret|key|password/i.test(key)) out[key] = "[redacted]";
    else out[key] = redact(inner);
  }
  return out;
}

function redactFields(fields: LogFields): Record<string, unknown> {
  return redact(fields) as Record<string, unknown>;
}
