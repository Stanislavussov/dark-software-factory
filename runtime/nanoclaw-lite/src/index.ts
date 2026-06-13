#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { Orchestrator } from "./orchestrator.js";
import { StateStore } from "./state.js";
import { TelegramBot } from "./telegram.js";

function usage(): string {
  return `Usage: nanoclaw-lite [--help|--version]

Telegram-only OpenCode runtime for Polyglot autonomous branches.`;
}

async function main(): Promise<void> {
  const arg = process.argv[2] || "";
  if (arg === "--help" || arg === "-h" || arg === "help") {
    console.log(usage());
    return;
  }
  if (arg === "--version" || arg === "-v" || arg === "version") {
    console.log("0.1.0");
    return;
  }

  const config = loadConfig(process.env);
  const logger = new Logger();
  const store = new StateStore(config);
  await store.init();
  const orchestrator = new Orchestrator(config, store, logger);
  let bot: TelegramBot;
  bot = new TelegramBot(config, logger, (message) => orchestrator.handle(bot, message));
  await orchestrator.recoverOnStartup(bot, config.telegramAllowedChatId);

  process.on("SIGTERM", () => bot.stop());
  process.on("SIGINT", () => bot.stop());
  await bot.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
