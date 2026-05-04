import { Injectable } from "@nestjs/common";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { simpleGit } from "simple-git";
import { createHash } from "node:crypto";

@Injectable()
export class RepoService {
  private readonly cacheDir = path.resolve(
    process.env.REPO_CACHE_DIR ?? "./.repo-cache",
  );

  async cloneIfNeeded(repoUrl: string): Promise<string> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const slug = this.slug(repoUrl);
    const dest = path.join(this.cacheDir, slug);

    try {
      await fs.access(path.join(dest, ".git"));
      return dest;
    } catch {
      // not cloned yet
    }

    const git = simpleGit();
    await git.clone(repoUrl, dest, ["--depth", "1"]);
    return dest;
  }

  private slug(repoUrl: string): string {
    const hash = createHash("sha1").update(repoUrl).digest("hex").slice(0, 10);
    const tail = repoUrl
      .replace(/\.git$/, "")
      .split("/")
      .slice(-2)
      .join("-")
      .replace(/[^a-zA-Z0-9-_]/g, "_");
    return `${tail}-${hash}`;
  }
}
