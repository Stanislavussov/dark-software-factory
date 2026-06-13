import { request } from "node:https";
import type { LoggerLike, RuntimeConfig, TelegramCommand } from "./types.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat?: { id?: string | number };
    text?: string;
  };
};

type TelegramApiResponse = {
  ok: boolean;
  description?: string;
  result?: TelegramUpdate[];
};

export class TelegramBot {
  config: RuntimeConfig;
  logger: LoggerLike;
  handler: (message: TelegramCommand) => Promise<unknown>;
  offset: number;
  running: boolean;

  constructor(config: RuntimeConfig, logger: LoggerLike, handler: (message: TelegramCommand) => Promise<unknown>) {
    this.config = config;
    this.logger = logger;
    this.handler = handler;
    this.offset = 0;
    this.running = false;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.logger.info("telegram.start");
    while (this.running) {
      try {
        const updates = await this.api("getUpdates", {
          timeout: 25,
          offset: this.offset,
          allowed_updates: ["message"],
        });
        for (const update of updates.result || []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          void this.handleUpdate(update);
        }
      } catch (error) {
        await this.logger.error("telegram.poll_error", { error: errorMessage(error) });
        await delay(3000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.chat?.id || typeof message.text !== "string") return;
    const chatId = String(message.chat.id);
    if (chatId !== this.config.telegramAllowedChatId) {
      await this.logger.info("telegram.ignored_chat", { chatId });
      return;
    }
    const [command, ...rest] = message.text.trim().split(/\s+/);
    try {
      await this.handler({ chatId, command: command.toLowerCase(), text: rest.join(" "), rawText: message.text });
    } catch (error) {
      await this.logger.error("telegram.handler_error", { error: errorMessage(error) });
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    const chunks = chunk(text, 3800);
    for (const part of chunks) {
      await this.sendChunk(chatId, part);
    }
  }

  async sendChunk(chatId: string, text: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.api("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
        return;
      } catch (error) {
        await this.logger.error("telegram.send_error", { attempt: attempt + 1, error: errorMessage(error) });
        if (attempt < 2) await delay(250 * 2 ** attempt);
      }
    }
  }

  api(method: string, body: Record<string, unknown>): Promise<TelegramApiResponse> {
    const payload = JSON.stringify(body);
    return new Promise<TelegramApiResponse>((resolve, reject) => {
      const req = request(
        {
          method: "POST",
          hostname: "api.telegram.org",
          path: `/bot${this.config.telegramBotToken}/${method}`,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data || "{}");
              if (!parsed.ok) reject(new Error(parsed.description || `Telegram ${method} failed`));
              else resolve(parsed);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }
}

function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
