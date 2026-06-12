import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shell } from "./process.js";
import type { ChildHandler, GateRunResult, LoggerLike, RuntimeConfig } from "./types.js";

export class GateRunner {
  config: RuntimeConfig;
  logger: LoggerLike;
  onChild: ChildHandler | undefined;

  constructor(config: RuntimeConfig, logger: LoggerLike, onChild?: ChildHandler) {
    this.config = config;
    this.logger = logger;
    this.onChild = onChild;
  }

  async prepareEnvFile(): Promise<string | null> {
    if (!this.config.polyglotEnvB64) return null;
    const path = join(this.config.targetRepoDir, ".env.nanoclaw");
    const content = Buffer.from(this.config.polyglotEnvB64, "base64");
    await writeFile(path, content, { mode: 0o600 });
    await chmod(path, 0o600);
    return path;
  }

  async runFrom(startGateId: string | null = null): Promise<GateRunResult> {
    const envFile = await this.prepareEnvFile();
    const startIndex = startGateId ? this.config.gates.findIndex((gate) => gate.id === startGateId) : 0;
    const gates = this.config.gates.slice(Math.max(0, startIndex));
    for (const gate of gates) {
      const compose = [
        "docker compose",
        "-f",
        quote(this.config.toolingComposeFile),
        envFile ? `--env-file ${quote(envFile)}` : "",
        "run --rm",
        quote(this.config.toolingService),
        "sh -lc",
        quote(gate.command),
      ]
        .filter(Boolean)
        .join(" ");
      await this.logger.info("gate.start", { gate: gate.id, command: gate.command });
      const result = await shell(compose, {
        cwd: this.config.targetRepoDir,
        timeoutMs: this.config.gateTimeoutMs,
        logger: this.logger,
        env: this.config.baseEnv,
        allowCancel: this.onChild,
      });
      if (result.code !== 0) {
        await this.logger.error("gate.failed", { gate: gate.id, code: result.code });
        return { ok: false, failedGate: gate, result };
      }
      await this.logger.info("gate.pass", { gate: gate.id });
    }
    return { ok: true };
  }
}

function quote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
