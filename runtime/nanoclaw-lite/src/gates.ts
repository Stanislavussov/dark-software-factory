import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ProcessResult, shell } from "./process.js";
import type { ChildHandler, GateRunResult, LoggerLike, RuntimeConfig } from "./types.js";

export type GateFailureClassification = { type: "infra_gate"; summary: string } | { type: "app_gate" };

const INFRA_GATE_PATTERNS: Array<{ pattern: RegExp; summary: string }> = [
  { pattern: /\bnode_modules\b.*\bmissing\b/i, summary: "node_modules are missing in the tooling workspace." },
  {
    pattern: /\btsc:\s*(?:not found|command not found)\b/i,
    summary: "TypeScript is unavailable in the tooling workspace.",
  },
  {
    pattern: /Cannot find module .*[\\/]node_modules\b/i,
    summary: "A package module under node_modules is unavailable in the tooling workspace.",
  },
  {
    pattern: /Biome couldn't find an ignore file/i,
    summary: "Biome cannot find the configured ignore file in the tooling workspace.",
  },
  { pattern: /\bpnpm:\s*(?:not found|command not found)\b/i, summary: "pnpm is unavailable in the tooling workspace." },
  {
    pattern: /(?:No such file or directory|cannot access|can't open).*[\\/]workspace[\\/]package\.json/i,
    summary: "The mounted workspace does not contain package.json.",
  },
  {
    pattern: /ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND|No package\.json.*(?:\/workspace|workspace)/i,
    summary: "pnpm cannot find package.json in the tooling workspace.",
  },
];

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

export function classifyGateFailure(result: ProcessResult): GateFailureClassification {
  const text = `${result.stdout}\n${result.stderr}`;
  const match = INFRA_GATE_PATTERNS.find(({ pattern }) => pattern.test(text));
  return match ? { type: "infra_gate", summary: match.summary } : { type: "app_gate" };
}

function quote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
