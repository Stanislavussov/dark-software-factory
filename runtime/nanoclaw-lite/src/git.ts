import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ProcessResult, shell } from "./process.js";
import type { LoggerLike, RuntimeConfig } from "./types.js";

export class GitClient {
  config: RuntimeConfig;
  logger: LoggerLike;
  askpassPath: string;

  constructor(config: RuntimeConfig, logger: LoggerLike) {
    this.config = config;
    this.logger = logger;
    this.askpassPath = join(config.dataDir, "git-askpass.sh");
  }

  async ensureRepo(options: { syncTargetBranch?: boolean } = {}): Promise<void> {
    const syncTargetBranch = options.syncTargetBranch ?? true;
    await mkdir(this.config.workspaceDir, { recursive: true });
    await this.writeAskpass();
    const exists = await shell("test -d .git", {
      cwd: this.config.targetRepoDir,
      timeoutMs: 10000,
      logger: this.logger,
    });
    if (exists.code !== 0) {
      await rm(this.config.targetRepoDir, { recursive: true, force: true });
      await this.git(
        `clone ${quote(this.config.targetRepo)} ${quote(this.config.targetRepoDir)}`,
        this.config.workspaceDir,
      );
    }
    await this.git(`remote set-url origin ${quote(this.config.targetRepo)}`);
    await this.git("fetch origin");
    if (!syncTargetBranch) return;
    await this.git(`checkout ${quote(this.config.targetBranch)}`);
    await this.git(`pull --ff-only origin ${quote(this.config.targetBranch)}`);
  }

  async createBranch(branch: string): Promise<void> {
    assertAutonomousBranch(branch);
    await this.git(`checkout -B ${quote(branch)} origin/${quote(this.config.targetBranch)}`);
  }

  async checkoutBranch(branch: string): Promise<void> {
    assertAutonomousBranch(branch);
    await this.git(`checkout ${quote(branch)}`);
  }

  async currentDiff(): Promise<string> {
    const base = `origin/${quote(this.config.targetBranch)}`;
    const committed = await this.git(`diff --patch --stat ${base}...HEAD`, this.config.targetRepoDir, true);
    const workingTree = await this.git("diff --patch --stat HEAD", this.config.targetRepoDir, true);
    const untrackedFiles = await this.git("ls-files --others --exclude-standard -z", this.config.targetRepoDir, true);
    const untrackedDiffs = await Promise.all(
      untrackedFiles.stdout
        .split("\0")
        .filter(Boolean)
        .map(async (file) => {
          const result = await this.git(
            `diff --no-index --patch --stat -- /dev/null ${quote(file)}`,
            this.config.targetRepoDir,
            true,
          );
          return result.stdout;
        }),
    );
    return [committed.stdout, workingTree.stdout, ...untrackedDiffs].filter(Boolean).join("\n");
  }

  async statusShort(): Promise<string> {
    const result = await this.git("status --short", this.config.targetRepoDir, true);
    return result.stdout.trim();
  }

  async commit(summary: string): Promise<string | null> {
    await this.git("add -A");
    const status = await this.statusShort();
    if (!status) return null;
    await this.git(`commit -m ${quote(`auto: ${summary.slice(0, 70)}`)}`);
    const hash = await this.git("rev-parse HEAD", this.config.targetRepoDir, true);
    return hash.stdout.trim();
  }

  async rebaseTarget(): Promise<ProcessResult> {
    await this.git("fetch origin");
    return this.git(`rebase origin/${quote(this.config.targetBranch)}`, this.config.targetRepoDir, true);
  }

  async pushAutonomous(branch: string): Promise<string> {
    assertAutonomousBranch(branch);
    const ref = `refs/heads/${branch}`;
    if (!ref.startsWith("refs/heads/autonomous/")) {
      throw new Error(`Refusing non-autonomous push target: ${ref}`);
    }
    await this.git(`push origin HEAD:${quote(ref)}`);
    const hash = await this.git("rev-parse HEAD", this.config.targetRepoDir, true);
    return hash.stdout.trim();
  }

  async discardBranch(branch: string): Promise<void> {
    assertAutonomousBranch(branch);
    await this.git("rebase --abort", this.config.targetRepoDir, true).catch(() => null);
    await this.git(`checkout ${quote(this.config.targetBranch)}`, this.config.targetRepoDir, true);
    await this.git("reset --hard", this.config.targetRepoDir, true);
    await this.git("clean -fd", this.config.targetRepoDir, true);
    await this.git(`branch -D ${quote(branch)}`, this.config.targetRepoDir, true).catch(() => null);
  }

  async writeAskpass(): Promise<void> {
    await mkdir(this.config.dataDir, { recursive: true });
    const script = [
      "#!/usr/bin/env sh",
      'case "$1" in',
      "  *Username*) printf '%s\\n' x-access-token ;;",
      "  *Password*) printf '%s\\n' \"$TARGET_GITHUB_TOKEN\" ;;",
      "  *) printf '\\n' ;;",
      "esac",
    ].join("\n");
    await writeFile(this.askpassPath, `${script}\n`, { mode: 0o700 });
    await chmod(this.askpassPath, 0o700);
  }

  async git(command: string, cwd = this.config.targetRepoDir, allowFailure = false): Promise<ProcessResult> {
    const result = await shell(`git ${command}`, {
      cwd,
      timeoutMs: this.config.gitTimeoutMs,
      logger: this.logger,
      env: {
        ...this.config.baseEnv,
        GIT_ASKPASS: this.askpassPath,
        GIT_TERMINAL_PROMPT: "0",
        TARGET_GITHUB_TOKEN: this.config.targetGithubToken,
      },
    });
    if (!allowFailure && result.code !== 0) {
      throw new Error(`git ${command} failed with code ${result.code}`);
    }
    return result;
  }
}

export function compareUrl(config: RuntimeConfig, branch: string): string {
  const match = config.targetRepo.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) return "";
  return `https://github.com/${match[1]}/${match[2]}/compare/${encodeURIComponent(config.targetBranch)}...${encodeURIComponent(branch)}`;
}

function assertAutonomousBranch(branch: string): void {
  if (!/^autonomous\/[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) {
    throw new Error(`Refusing unsafe branch name: ${branch}`);
  }
}

function quote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
