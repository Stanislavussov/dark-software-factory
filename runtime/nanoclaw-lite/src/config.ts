import type { Env, PublicConfigSnapshot, RuntimeConfig } from "./types.js";

const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_CHAT_ID",
  "TARGET_REPO",
  "TARGET_BRANCH",
  "TARGET_GITHUB_TOKEN",
  "OPENCODE_API_KEY",
];

const DEFAULTS = {
  MAX_FIX_ATTEMPTS: "3",
  LOG_TAIL_LINES: "80",
  CANCEL_GRACE_MS: "10000",
  GIT_TIMEOUT_MS: "120000",
  OPENCODE_TIMEOUT_MS: "3600000",
  REVIEW_TIMEOUT_MS: "1800000",
  GATE_TIMEOUT_MS: "1200000",
  WORKSPACE_DIR: "/workspace",
  DATA_DIR: "/data",
  LOGS_DIR: "/logs",
  NANOCLAW_SKILLS_DIR: "/opt/nanoclaw/superpowers",
  TOOLING_COMPOSE_FILE: "deploy/nanoclaw-tooling/compose.yml",
  TOOLING_SERVICE: "polyglot-tooling",
  OPENCODE_COMMAND: "opencode",
  OPENCODE_GO_API_BASE: "",
  OPENCODE_RUN_ARGS: "",
  OPENCODE_REVIEW_ARGS: "",
  VERIFY_INSTALL: "pnpm install --frozen-lockfile",
  VERIFY_BUILD: "pnpm build",
  VERIFY_LINT: "pnpm lint",
  VERIFY_DEPS: "pnpm lint:deps",
  VERIFY_TEST: "pnpm test",
};

type DefaultName = keyof typeof DEFAULTS;

export function loadConfig(env: Env): RuntimeConfig {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const value = (name: DefaultName | (typeof REQUIRED)[number]): string =>
    env[name] ?? DEFAULTS[name as DefaultName] ?? "";
  const requiredValue = (name: (typeof REQUIRED)[number]): string => {
    const found = env[name];
    if (!found) throw new Error(`${name} is required.`);
    return found;
  };
  const numberValue = (name: DefaultName): number => {
    const parsed = Number(value(name));
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
    return parsed;
  };

  const workspaceDir = value("WORKSPACE_DIR");
  const targetRepoDir = `${workspaceDir.replace(/\/+$/, "")}/Polyglot`;
  const gates = [
    ["install", value("VERIFY_INSTALL")],
    ["build", value("VERIFY_BUILD")],
    ["lint", value("VERIFY_LINT")],
    ["deps", value("VERIFY_DEPS")],
    ["test", value("VERIFY_TEST")],
  ].map(([id, command]) => ({ id, command }));

  return {
    baseEnv: { ...env },
    telegramBotToken: requiredValue("TELEGRAM_BOT_TOKEN"),
    telegramAllowedChatId: String(env.TELEGRAM_ALLOWED_CHAT_ID),
    targetRepo: requiredValue("TARGET_REPO"),
    targetBranch: requiredValue("TARGET_BRANCH"),
    targetGithubToken: requiredValue("TARGET_GITHUB_TOKEN"),
    opencodeApiKey: requiredValue("OPENCODE_API_KEY"),
    opencodeGoApiBase: value("OPENCODE_GO_API_BASE"),
    polyglotEnvB64: env.POLYGLOT_ENV_B64 || "",
    maxFixAttempts: numberValue("MAX_FIX_ATTEMPTS"),
    logTailLines: numberValue("LOG_TAIL_LINES"),
    cancelGraceMs: numberValue("CANCEL_GRACE_MS"),
    gitTimeoutMs: numberValue("GIT_TIMEOUT_MS"),
    opencodeTimeoutMs: numberValue("OPENCODE_TIMEOUT_MS"),
    reviewTimeoutMs: numberValue("REVIEW_TIMEOUT_MS"),
    gateTimeoutMs: numberValue("GATE_TIMEOUT_MS"),
    workspaceDir,
    targetRepoDir,
    dataDir: value("DATA_DIR"),
    logsDir: value("LOGS_DIR"),
    nanoclawSkillsDir: value("NANOCLAW_SKILLS_DIR"),
    toolingComposeFile: value("TOOLING_COMPOSE_FILE"),
    toolingService: value("TOOLING_SERVICE"),
    opencodeCommand: value("OPENCODE_COMMAND"),
    opencodeRunArgs: splitArgs(value("OPENCODE_RUN_ARGS")),
    opencodeReviewArgs: splitArgs(value("OPENCODE_REVIEW_ARGS")),
    gates,
  };
}

export function publicConfigSnapshot(config: RuntimeConfig): PublicConfigSnapshot {
  return {
    targetRepo: config.targetRepo,
    targetBranch: config.targetBranch,
    gates: config.gates,
    opencodeCommand: config.opencodeCommand,
    opencodeRunArgs: config.opencodeRunArgs,
    opencodeReviewArgs: config.opencodeReviewArgs,
    toolingComposeFile: config.toolingComposeFile,
    toolingService: config.toolingService,
  };
}

function splitArgs(value: string): string[] {
  if (!value.trim()) return [];
  const out = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (quote) throw new Error("OpenCode args contain an unterminated quote.");
  if (current) out.push(current);
  return out;
}
