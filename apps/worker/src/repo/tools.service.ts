import { Injectable } from "@nestjs/common";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";

const MAX_FILE_BYTES = 200_000;
const MAX_GREP_RESULTS = 80;
const MAX_LIST_ENTRIES = 500;

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "vendor",
  "target",
  ".venv",
  "__pycache__",
]);

@Injectable()
export class ToolsService {
  async listDir(repoRoot: string, relPath: string): Promise<string> {
    const abs = this.safeJoin(repoRoot, relPath);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const lines: string[] = [];
    let count = 0;
    for (const e of entries) {
      if (count >= MAX_LIST_ENTRIES) {
        lines.push(`... (${entries.length - count} more entries truncated)`);
        break;
      }
      if (e.isDirectory() && IGNORE_DIRS.has(e.name)) continue;
      lines.push(e.isDirectory() ? `${e.name}/` : e.name);
      count++;
    }
    return lines.join("\n");
  }

  async readFile(
    repoRoot: string,
    relPath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<string> {
    const abs = this.safeJoin(repoRoot, relPath);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES * 4) {
      return `[file too large: ${stat.size} bytes — use start_line/end_line]`;
    }
    const content = await fs.readFile(abs, "utf8");
    const lines = content.split("\n");
    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(lines.length, endLine ?? lines.length);
    const slice = lines
      .slice(start - 1, end)
      .map((l, i) => `${start + i}\t${l}`)
      .join("\n");
    if (slice.length > MAX_FILE_BYTES) {
      return slice.slice(0, MAX_FILE_BYTES) + "\n[truncated]";
    }
    return slice;
  }

  async grep(
    repoRoot: string,
    pattern: string,
    pathGlob?: string,
  ): Promise<string> {
    const args = [
      "--line-number",
      "--no-heading",
      "--max-count",
      "5",
      "--max-columns",
      "300",
      "-S",
      pattern,
    ];
    if (pathGlob) {
      args.push("-g", pathGlob);
    }
    for (const d of IGNORE_DIRS) {
      args.push("-g", `!${d}/`);
    }
    args.push(".");

    return new Promise((resolve) => {
      const proc = spawn("rg", args, { cwd: repoRoot });
      let out = "";
      let err = "";
      proc.stdout.on("data", (b) => {
        out += b.toString();
      });
      proc.stderr.on("data", (b) => {
        err += b.toString();
      });
      proc.on("close", (code) => {
        if (code !== 0 && code !== 1) {
          resolve(`[grep error: ${err.trim() || `exit ${code}`}]`);
          return;
        }
        const lines = out.split("\n").filter(Boolean);
        const truncated =
          lines.length > MAX_GREP_RESULTS
            ? lines.slice(0, MAX_GREP_RESULTS).join("\n") +
              `\n[truncated, ${lines.length - MAX_GREP_RESULTS} more matches]`
            : lines.join("\n");
        resolve(truncated || "[no matches]");
      });
      proc.on("error", () => resolve("[grep unavailable: install ripgrep]"));
    });
  }

  async fileExists(repoRoot: string, relPath: string): Promise<boolean> {
    try {
      await fs.access(this.safeJoin(repoRoot, relPath));
      return true;
    } catch {
      return false;
    }
  }

  private safeJoin(root: string, rel: string): string {
    const normalized = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const abs = path.resolve(root, normalized);
    if (!abs.startsWith(path.resolve(root))) {
      throw new Error(`path escapes repo root: ${rel}`);
    }
    return abs;
  }
}
