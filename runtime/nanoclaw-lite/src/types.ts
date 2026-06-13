import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProcessResult } from "./process.js";

export type Env = Record<string, string | undefined>;

export type Gate = {
  id: string;
  command: string;
};

export type RuntimeConfig = {
  baseEnv: Env;
  telegramBotToken: string;
  telegramAllowedChatId: string;
  targetRepo: string;
  targetBranch: string;
  targetGithubToken: string;
  opencodeApiKey: string;
  opencodeGoApiBase: string;
  polyglotEnvB64: string;
  maxFixAttempts: number;
  logTailLines: number;
  cancelGraceMs: number;
  gitTimeoutMs: number;
  opencodeTimeoutMs: number;
  reviewTimeoutMs: number;
  gateTimeoutMs: number;
  workspaceDir: string;
  targetRepoDir: string;
  dataDir: string;
  logsDir: string;
  nanoclawSkillsDir: string;
  toolingComposeFile: string;
  toolingService: string;
  opencodeCommand: string;
  opencodeRunArgs: string[];
  opencodeReviewArgs: string[];
  gates: Gate[];
};

export type PublicConfigSnapshot = Pick<
  RuntimeConfig,
  | "targetRepo"
  | "targetBranch"
  | "gates"
  | "opencodeCommand"
  | "opencodeRunArgs"
  | "opencodeReviewArgs"
  | "toolingComposeFile"
  | "toolingService"
>;

export type ReviewFinding = {
  severity: string;
  file: string;
  line?: number;
  message: string;
  recommendation: string;
};

export type ReviewResult = {
  status: "clean" | "findings";
  summary: string;
  findings: ReviewFinding[];
};

export type FailureType =
  | "telegram"
  | "git"
  | "rebase"
  | "opencode"
  | "opencode_timeout"
  | "gate_app"
  | "gate_infra"
  | "review_findings"
  | "review_contract"
  | "protected_path"
  | "cancelled"
  | "crashed_or_interrupted"
  | "recovery_lock";

export type FailureSummary = {
  type: FailureType | string;
  summary: string;
  code?: number;
  signal?: string | null;
  timedOut?: boolean;
  gate?: Gate | null;
  command?: string;
  stdoutTail?: string;
  stderrTail?: string;
  review?: ReviewResult;
  rebaseStatus?: string;
};

export type TaskStatus = "idle" | "running" | "failed" | "ready_for_push" | "pushed" | "discarded" | "archived";

export type Task = {
  id: string;
  prompt: string;
  status: Exclude<TaskStatus, "idle">;
  branch: string;
  baseBranch: string;
  commitHash: string | null;
  pushedCommitHash: string | null;
  remoteBranch: string | null;
  compareUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastFailedGate: Gate | null;
  latestFailure: FailureSummary | null;
  latestReview: ReviewResult | null;
  latestManualFixNote: string | null;
  logPath: string;
  configSnapshot: PublicConfigSnapshot;
};

export type RuntimeState = {
  activeTaskId: string | null;
  recentTaskIds: string[];
  recoveryLock: string | null;
};

export type LoggerLike = {
  withFile(path: string): LoggerLike;
  info(message: string, fields?: LogFields): Promise<void>;
  error(message: string, fields?: LogFields): Promise<void>;
};

export type LogFields = Record<string, unknown>;

export type ChildHandler = (child: ChildProcessWithoutNullStreams) => void;

export type GateRunResult = { ok: true } | { ok: false; failedGate: Gate; result: ProcessResult };

export type TelegramCommand = {
  chatId: string;
  command: string;
  text: string;
  rawText: string;
};

export type TelegramSender = {
  send(chatId: string, text: string): Promise<unknown>;
};
