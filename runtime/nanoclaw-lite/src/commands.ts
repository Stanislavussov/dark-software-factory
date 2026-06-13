import type { TaskStatus } from "./types.js";

export type CommandClass = "read_only" | "mutating" | "destructive";

export type CommandIntent = {
  name: string;
  aliases: string[];
  class: CommandClass;
  allowedStates: Array<TaskStatus | "recovery_lock">;
  confirmation: "none" | "required";
  nextAction: string;
  description: string;
};

const ALL_STATES: Array<TaskStatus | "recovery_lock"> = [
  "idle",
  "running",
  "failed",
  "ready_for_push",
  "pushed",
  "discarded",
  "archived",
  "recovery_lock",
];

export const COMMANDS: CommandIntent[] = [
  readOnly("/help", [], "Show available commands."),
  readOnly("/status", [], "Show what is happening now and allowed next actions."),
  readOnly("/tasks", [], "Show recent task history."),
  readOnly("/logs", [], "Show a formatted task log tail."),
  readOnly("/inspect", [], "Show runtime diagnostics."),
  readOnly("/failure", [], "Show structured failure diagnosis."),
  readOnly("/review", [], "Show review findings."),
  readOnly("/doctor", [], "Run non-mutating runtime health checks."),
  {
    name: "/run",
    aliases: [],
    class: "mutating",
    allowedStates: ["idle", "pushed", "discarded", "archived"],
    confirmation: "none",
    nextAction: "/run <implementation task>",
    description: "Start an implementation task.",
  },
  {
    name: "/fix",
    aliases: [],
    class: "mutating",
    allowedStates: ["failed"],
    confirmation: "none",
    nextAction: "/fix [operator note]",
    description: "Retry an app-gate or review failure.",
  },
  {
    name: "/push",
    aliases: [],
    class: "mutating",
    allowedStates: ["ready_for_push"],
    confirmation: "none",
    nextAction: "/push",
    description: "Rebase, re-run gates and review, then push the autonomous branch.",
  },
  {
    name: "/cancel",
    aliases: [],
    class: "mutating",
    allowedStates: ["running"],
    confirmation: "none",
    nextAction: "/cancel",
    description: "Cancel the current run or fix task.",
  },
  {
    name: "/discard",
    aliases: [],
    class: "destructive",
    allowedStates: ["failed", "ready_for_push", "recovery_lock"],
    confirmation: "required",
    nextAction: "/discard confirm",
    description: "Delete local autonomous work after branch checks pass.",
  },
  {
    name: "/archive",
    aliases: [],
    class: "mutating",
    allowedStates: ["failed", "ready_for_push", "recovery_lock"],
    confirmation: "none",
    nextAction: "/archive",
    description: "Clear task blockage without deleting repo work.",
  },
];

const COMMAND_BY_NAME = new Map(
  COMMANDS.flatMap((command) => [command.name, ...command.aliases].map((name) => [name, command])),
);

const IMPLEMENTATION_VERBS = new Set([
  "add",
  "build",
  "change",
  "create",
  "fix",
  "harden",
  "implement",
  "improve",
  "integrate",
  "migrate",
  "refactor",
  "remove",
  "rename",
  "support",
  "update",
  "wire",
]);

const BARE_CONTROL_COMMANDS = new Set([
  "archive",
  "cancel",
  "discard",
  "doctor",
  "failure",
  "health",
  "inspect",
  "log",
  "logs",
  "push",
  "restart",
  "review",
  "status",
]);

const REQUEST_VERBS = new Set([
  "check",
  "describe",
  "display",
  "fetch",
  "get",
  "print",
  "read",
  "send",
  "show",
  "tail",
  "tell",
  "view",
]);

const CONTROL_OBJECTS = new Set([
  "deployment",
  "deploy",
  "doctor",
  "failure",
  "health",
  "log",
  "logs",
  "review",
  "state",
  "status",
]);

const POLITE_FILLER = new Set(["a", "an", "can", "could", "current", "latest", "me", "now", "please", "the", "you"]);

export function resolveCommand(command: string): CommandIntent | null {
  return COMMAND_BY_NAME.get(command.toLowerCase()) || null;
}

export function helpText(): string {
  return [
    "Commands:",
    ...COMMANDS.map((command) => {
      const suffix = command.class === "read_only" ? "read-only" : command.class;
      return `${command.name} - ${suffix}; ${command.description}`;
    }),
    "",
    "Free text is ignored. Use /run <implementation task> for code changes.",
  ].join("\n");
}

export function unknownTextSuggestion(rawText: string): string {
  const text = rawText.trim();
  if (!text?.startsWith("/")) {
    return "Free text is ignored. Use /logs latest for logs, /status for state, or /run <implementation task> for code changes.";
  }
  return "Unknown command. Use /help. For logs use /logs latest; for code changes use /run <implementation task>.";
}

export function runPromptRejection(prompt: string): string | null {
  if (!isControlPlaneRequest(prompt)) return null;
  return [
    "/run only accepts implementation tasks.",
    "Use /logs latest, /status, /doctor, /inspect, /cancel, /push, /discard, or /archive for control-plane actions.",
  ].join("\n");
}

function isControlPlaneRequest(prompt: string): boolean {
  const tokens = tokenize(prompt);
  if (tokens.length === 0) return false;
  const words = tokens.map((token) => token.replace(/^\//, ""));
  const meaningful = words.filter((token) => !POLITE_FILLER.has(token));
  const first = meaningful[0] || words[0] || "";
  if (IMPLEMENTATION_VERBS.has(first)) return false;
  if (first === "make" && !hasControlObject(words)) return false;
  if (tokens.some((token) => token.startsWith("/") && resolveCommand(token))) return true;
  if (BARE_CONTROL_COMMANDS.has(first)) return true;
  if (["push", "discard", "archive", "cancel", "restart"].some((verb) => words.includes(verb))) return true;
  if (REQUEST_VERBS.has(first) && hasControlObject(words)) return true;
  if (words[0] === "what" && words.includes("is") && hasControlObject(words)) return true;
  if (words[0] === "whats" && hasControlObject(words)) return true;
  return words.includes("tell") && words.includes("me") && hasControlObject(words);
}

function hasControlObject(words: string[]): boolean {
  return words.some((word) => CONTROL_OBJECTS.has(word));
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/what's/g, "whats")
      .match(/\/?[a-z0-9_-]+/g) ?? []
  );
}

function readOnly(name: string, aliases: string[], description: string): CommandIntent {
  return {
    name,
    aliases,
    class: "read_only",
    allowedStates: ALL_STATES,
    confirmation: "none",
    nextAction: name,
    description,
  };
}
