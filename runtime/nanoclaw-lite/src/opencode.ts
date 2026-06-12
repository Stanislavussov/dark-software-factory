import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ProcessResult, runProcess } from "./process.js";
import type { ChildHandler, Env, LoggerLike, ReviewFinding, ReviewResult, RuntimeConfig } from "./types.js";

const BEGIN = "NANOCLAW_REVIEW_RESULT_BEGIN";
const END = "NANOCLAW_REVIEW_RESULT_END";

export class OpenCodeRunner {
  config: RuntimeConfig;
  logger: LoggerLike;
  onChild: ChildHandler | undefined;

  constructor(config: RuntimeConfig, logger: LoggerLike, onChild?: ChildHandler) {
    this.config = config;
    this.logger = logger;
    this.onChild = onChild;
  }

  async implement(prompt: string, context = ""): Promise<ProcessResult> {
    const fullPrompt = [
      "You are implementing a nanoclaw-lite task in the Polyglot repository.",
      "Follow repository instructions. Do not commit or push.",
      context,
      prompt,
    ]
      .filter(Boolean)
      .join("\n\n");
    return this.run(this.config.opencodeRunArgs, fullPrompt, this.config.opencodeTimeoutMs);
  }

  async review({ diff }: { diff: string }): Promise<{ ok: boolean; result: ReviewResult; raw: ProcessResult }> {
    const prompt = [
      "You are a report-only code reviewer. Do not edit files, commit, or push.",
      "Return exactly one machine-readable result between these markers:",
      BEGIN,
      '{"status":"clean","summary":"short text","findings":[]}',
      END,
      "Use status findings when there are issues. Findings need severity, file, optional line, message, and recommendation.",
      await this.readOptional(join(this.config.targetRepoDir, "AGENTS.md")),
      await this.readSuperpowers(),
      "Current git diff:",
      diff || "(no diff)",
    ]
      .filter(Boolean)
      .join("\n\n");
    const result = await this.run(this.config.opencodeReviewArgs, prompt, this.config.reviewTimeoutMs);
    if (result.code !== 0) {
      return {
        ok: false,
        result: { status: "findings", summary: `OpenCode review exited ${result.code}.`, findings: [] },
        raw: result,
      };
    }
    try {
      return { ok: true, result: parseReviewResult(result.stdout), raw: result };
    } catch (error) {
      return { ok: false, result: { status: "findings", summary: errorMessage(error), findings: [] }, raw: result };
    }
  }

  async run(args: string[], prompt: string, timeoutMs: number): Promise<ProcessResult> {
    return runProcess({
      command: this.config.opencodeCommand,
      args,
      cwd: this.config.targetRepoDir,
      input: prompt,
      timeoutMs,
      logger: this.logger,
      allowCancel: this.onChild,
      env: this.opencodeEnv(),
    });
  }

  opencodeEnv() {
    const env: Env = {
      ...this.config.baseEnv,
      OPENCODE_API_KEY: this.config.opencodeApiKey,
    };
    if (this.config.opencodeGoApiBase) {
      env.OPENCODE_GO_API_BASE = this.config.opencodeGoApiBase;
    } else {
      delete env.OPENCODE_GO_API_BASE;
    }
    return env;
  }

  async readSuperpowers(): Promise<string> {
    const dir = this.config.nanoclawSkillsDir;
    const files = [
      "control-plane/SKILL.md",
      "git-workflow/SKILL.md",
      "polyglot-quality-gate/SKILL.md",
      "code-review-gate/SKILL.md",
    ];
    const parts: string[] = [];
    for (const file of files) {
      parts.push(await this.readOptional(join(dir, file)));
    }
    return parts.filter(Boolean).join("\n\n");
  }

  async readOptional(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  }
}

export function parseReviewResult(text: string): ReviewResult {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Review output did not contain the required JSON markers.");
  }
  const jsonText = text.slice(start + BEGIN.length, end).trim();
  const parsed: unknown = JSON.parse(jsonText);
  if (!isReviewResult(parsed)) {
    throw new Error("Review JSON did not match the required schema.");
  }
  return parsed;
}

function isReviewResult(value: unknown): value is ReviewResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "clean" && candidate.status !== "findings") {
    return false;
  }
  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.findings) &&
    candidate.findings.every(isReviewFinding)
  );
}

function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.severity === "string" &&
    typeof candidate.file === "string" &&
    (candidate.line === undefined || typeof candidate.line === "number") &&
    typeof candidate.message === "string" &&
    typeof candidate.recommendation === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
