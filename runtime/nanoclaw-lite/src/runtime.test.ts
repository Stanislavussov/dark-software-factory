import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "./config.js";
import { classifyGateFailure } from "./gates.js";
import { Orchestrator } from "./orchestrator.js";
import { createTask, StateStore } from "./state.js";
import type { LoggerLike, RuntimeConfig, TelegramCommand, TelegramSender } from "./types.js";

test("read-only commands do not need Git, OpenCode, or gates", async () => {
  const { orchestrator, bot } = await fixture();

  await orchestrator.handle(bot, command("/status"));
  await orchestrator.handle(bot, command("/tasks"));
  await orchestrator.handle(bot, command("/logs latest"));
  await orchestrator.handle(bot, command("/inspect"));

  assert.equal(bot.messages.length, 4);
  assert.match(bot.messages[0] || "", /State: idle/);
  assert.match(bot.messages[1] || "", /No tasks found/);
  assert.match(bot.messages[2] || "", /No tasks found/);
  assert.match(bot.messages[3] || "", /Runtime inspection/);
});

test("/run still routes to the implementation workflow", async () => {
  const { config, store, logger, bot } = await fixture();
  class TestOrchestrator extends Orchestrator {
    called = false;

    override async run(_bot: TelegramSender, _chatId: string, prompt: string): Promise<unknown> {
      this.called = true;
      return prompt;
    }
  }
  const orchestrator = new TestOrchestrator(config, store, logger);

  await orchestrator.handle(bot, command("/run implement something"));

  assert.equal(orchestrator.called, true);
});

test("status reports failed task JSON and terminal log event", async () => {
  const { orchestrator, store, config } = await fixture();
  const task = createTask({
    prompt: "fix app",
    branch: "autonomous/test-fix-app",
    configSnapshot: {
      targetRepo: config.targetRepo,
      targetBranch: config.targetBranch,
      gates: config.gates,
      opencodeCommand: config.opencodeCommand,
      opencodeRunArgs: config.opencodeRunArgs,
      opencodeReviewArgs: config.opencodeReviewArgs,
      toolingComposeFile: config.toolingComposeFile,
      toolingService: config.toolingService,
    },
    logPath: join(config.logsDir, "tasks", "test-fix-app.log"),
  });
  task.status = "failed";
  task.latestFailure = { type: "gate", summary: "lint failed", code: 1, gate: config.gates[2] || null };
  await mkdir(join(config.logsDir, "tasks"), { recursive: true });
  await writeFile(task.logPath, `${JSON.stringify({ ts: "2026-06-13T10:00:00.000Z", message: "task.failed" })}\n`);
  await store.setActiveTask(task);

  const text = await orchestrator.statusText();

  assert.match(text, /State: failed/);
  assert.match(text, /Terminal log: 2026-06-13T10:00:00.000Z task.failed/);
  assert.match(text, /Next: \/fix, \/discard, or \/archive/);
});

test("status flags running task JSON when runtime is idle and log is terminal", async () => {
  const { orchestrator, store, config } = await fixture();
  const task = createTask({
    prompt: "read logs",
    branch: "autonomous/test-read-logs",
    configSnapshot: {
      targetRepo: config.targetRepo,
      targetBranch: config.targetBranch,
      gates: config.gates,
      opencodeCommand: config.opencodeCommand,
      opencodeRunArgs: config.opencodeRunArgs,
      opencodeReviewArgs: config.opencodeReviewArgs,
      toolingComposeFile: config.toolingComposeFile,
      toolingService: config.toolingService,
    },
    logPath: join(config.logsDir, "tasks", "test-read-logs.log"),
  });
  await mkdir(join(config.logsDir, "tasks"), { recursive: true });
  await writeFile(task.logPath, `${JSON.stringify({ ts: "2026-06-13T10:01:00.000Z", message: "task.failed" })}\n`);
  await store.setActiveTask(task);

  const text = await orchestrator.statusText();

  assert.match(text, /State inconsistency/);
  assert.match(text, /State: running/);
});

test("/tasks and /logs latest work without an active task", async () => {
  const { orchestrator, store, config } = await fixture();
  const task = createTask({
    prompt: "latest task",
    branch: "autonomous/test-latest-task",
    configSnapshot: {
      targetRepo: config.targetRepo,
      targetBranch: config.targetBranch,
      gates: config.gates,
      opencodeCommand: config.opencodeCommand,
      opencodeRunArgs: config.opencodeRunArgs,
      opencodeReviewArgs: config.opencodeReviewArgs,
      toolingComposeFile: config.toolingComposeFile,
      toolingService: config.toolingService,
    },
    logPath: join(config.logsDir, "tasks", "test-latest-task.log"),
  });
  task.status = "archived";
  await mkdir(join(config.logsDir, "tasks"), { recursive: true });
  await writeFile(
    task.logPath,
    [
      JSON.stringify({ ts: "2026-06-13T10:02:00.000Z", message: "gate.failed" }),
      JSON.stringify({ ts: "2026-06-13T10:03:00.000Z", message: "task.archived" }),
      "",
    ].join("\n"),
  );
  await store.setActiveTask(task);
  await store.clearActiveTask();

  assert.match(await orchestrator.tasksText(), /task.archived/);
  assert.match(await orchestrator.logsText("latest 1"), /archived/);
});

test("/logs formats JSONL events into readable text", async () => {
  const { orchestrator, store, config } = await fixture();
  const task = createTask({
    prompt: "readable logs",
    branch: "autonomous/test-readable-logs",
    configSnapshot: {
      targetRepo: config.targetRepo,
      targetBranch: config.targetBranch,
      gates: config.gates,
      opencodeCommand: config.opencodeCommand,
      opencodeRunArgs: config.opencodeRunArgs,
      opencodeReviewArgs: config.opencodeReviewArgs,
      toolingComposeFile: config.toolingComposeFile,
      toolingService: config.toolingService,
    },
    logPath: join(config.logsDir, "tasks", "test-readable-logs.log"),
  });
  await mkdir(join(config.logsDir, "tasks"), { recursive: true });
  await writeFile(
    task.logPath,
    [
      JSON.stringify({
        ts: "2026-06-13T10:04:00.000Z",
        level: "info",
        message: "gate.start",
        gate: "lint",
        command: "pnpm lint",
      }),
      JSON.stringify({
        ts: "2026-06-13T10:04:01.000Z",
        level: "info",
        message: "subprocess.stdout",
        command: "sh",
        text: "src/app.ts: lint warning\nDone",
      }),
      "",
    ].join("\n"),
  );
  await store.setActiveTask(task);

  const text = await orchestrator.logsText("active 2");

  assert.match(text, /readable log tail/);
  assert.match(text, /\[10:04:00\] INFO\s+gate started/);
  assert.match(text, /gate: lint/);
  assert.match(text, /output:\n {4}\| src\/app\.ts: lint warning/);
  assert.doesNotMatch(text, /"message":"subprocess.stdout"/);
});

test("gate classifier identifies tooling infrastructure failures", () => {
  assert.equal(classifyGateFailure(result("sh: tsc: not found")).type, "infra_gate");
  assert.equal(classifyGateFailure(result("node_modules missing after install")).type, "infra_gate");
  assert.equal(classifyGateFailure(result("Cannot find module '/workspace/node_modules/astro'")).type, "infra_gate");
  assert.equal(classifyGateFailure(result("Biome couldn't find an ignore file")).type, "infra_gate");
  assert.equal(
    classifyGateFailure(result("src/app.ts(12,3): error TS2322: Type 'string' is not assignable")).type,
    "app_gate",
  );
});

function result(stderr: string) {
  return { code: 1, stdout: "", stderr };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nanoclaw-lite-test-"));
  const config = testConfig(root);
  const store = new StateStore(config);
  await store.init();
  const logger = memoryLogger();
  const orchestrator = new Orchestrator(config, store, logger);
  const bot = memoryBot();
  return { root, config, store, logger, orchestrator, bot };
}

function testConfig(root: string): RuntimeConfig {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_ALLOWED_CHAT_ID: "chat",
    TARGET_REPO: "https://github.com/example/polyglot.git",
    TARGET_BRANCH: "main",
    TARGET_GITHUB_TOKEN: "github-token",
    OPENCODE_API_KEY: "opencode-key",
    WORKSPACE_DIR: join(root, "workspace"),
    DATA_DIR: join(root, "data"),
    LOGS_DIR: join(root, "logs"),
    NANOCLAW_SKILLS_DIR: join(root, "skills"),
  });
}

function command(rawText: string): TelegramCommand {
  const [rawCommand, ...rest] = rawText.trim().split(/\s+/);
  return { chatId: "chat", command: rawCommand?.toLowerCase() || "", text: rest.join(" "), rawText };
}

function memoryBot(): TelegramSender & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    async send(_chatId: string, text: string): Promise<void> {
      messages.push(text);
    },
  };
}

function memoryLogger(): LoggerLike {
  return {
    withFile() {
      return this;
    },
    async info() {},
    async error() {},
  };
}
