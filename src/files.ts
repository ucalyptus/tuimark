import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MARKDOWN = /\.(md|markdown|mdx)$/i;
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const SKIP_DIRS: Record<string, true> = { node_modules: true, target: true, dist: true, build: true, vendor: true };

/** Markdown files under `root`, relative and sorted; respects .gitignore inside a git repo. */
export function listMarkdown(root: string): string[] {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md", "*.markdown", "*.mdx"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 },
    );
    const files = [...new Set(out.split("\0").filter((file) => file && fs.existsSync(path.join(root, file))))];
    return sortFiles(files.slice(0, MAX_FILES));
  } catch {
    return sortFiles(walk(root));
  }
}

function walk(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS[entry.name]) visit(full, depth + 1);
      } else if (MARKDOWN.test(entry.name)) {
        found.push(path.relative(root, full));
      }
    }
  };
  visit(root, 0);
  return found;
}

/** Top-level files first, then by directory, README first within a directory. */
function sortFiles(files: string[]): string[] {
  const key = (file: string) => {
    const dir = path.dirname(file);
    const readme = /^readme\./i.test(path.basename(file)) ? "0" : "1";
    return `${dir === "." ? "0" : `1${dir.toLowerCase()}`}\0${readme}${path.basename(file).toLowerCase()}`;
  };
  return files.sort((a, b) => key(a).localeCompare(key(b)));
}
