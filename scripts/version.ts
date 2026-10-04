import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Bump = "patch" | "minor" | "major";
const releaseHeader = /^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}\r?$/m;

/** Our SemVer subset is also valid for Chrome's numeric update version. */
export function parseVersion(value: unknown): number[] {
  if (typeof value !== "string" || value.trim() !== value || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Use major.minor.patch, with no leading zeros or prerelease suffixes.");
  }
  const parts = value.split(".").map(Number);
  if (parts.some(part => part > 65535) || parts.every(part => part === 0)) {
    throw new Error("Chrome version components must be 0–65535, and cannot all be zero.");
  }
  return parts;
}

export function nextVersion(current: string, bump: Bump): string {
  const parts = parseVersion(current);
  const index = ["major", "minor", "patch"].indexOf(bump);
  if (index < 0) throw new Error("Choose patch, minor, or major.");
  parts[index]!++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  const version = parts.join(".");
  parseVersion(version);
  return version;
}

async function metadata(root: string) {
  const [packageText, changelog] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "CHANGELOG.md"), "utf8"),
  ]);
  const pkg = JSON.parse(packageText) as Record<string, unknown>;
  parseVersion(pkg.version);
  const version = pkg.version as string;
  const latestRelease = releaseHeader.exec(changelog);
  if (latestRelease?.[1] !== version) {
    throw new Error(`The latest dated CHANGELOG.md entry must match package.json (${version}).`);
  }
  const unreleased = [...changelog.matchAll(/^## \[Unreleased\]\r?$/gm)];
  if (unreleased.length !== 1 || unreleased[0]!.index! >= latestRelease.index) {
    throw new Error("CHANGELOG.md needs exactly one ## [Unreleased] section before the dated releases.");
  }
  const unreleasedEnd = unreleased[0]!.index! + unreleased[0]![0].length;
  return { pkg, packageText, changelog, version, unreleasedEnd };
}

export async function readProjectVersion(root: string): Promise<string> {
  return (await metadata(root)).version;
}

export async function updateVersion(root: string, bump: Bump, options: { dryRun?: boolean; date?: string } = {}): Promise<{ previous: string; version: string }> {
  const current = await metadata(root);
  const version = nextVersion(current.version, bump);
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Use a valid YYYY-MM-DD release date.");
  const headingEnd = current.unreleasedEnd;
  const remaining = current.changelog.slice(headingEnd);
  const nextHeading = remaining.search(/^## /m);
  if (nextHeading < 0) throw new Error("The Unreleased section must precede the dated releases.");
  const notes = remaining.slice(0, nextHeading).trim();
  if (!notes.replace(/<!--[\s\S]*?-->/g, "").replace(/^### .*$/gm, "").trim()) {
    throw new Error("Add release notes under ## [Unreleased] before bumping the version.");
  }
  const changelog = `${current.changelog.slice(0, headingEnd)}\n\n## [${version}] - ${date}\n\n${notes}\n\n${remaining.slice(nextHeading)}`;
  const result = { previous: current.version, version };
  if (options.dryRun) return result;

  // Validate everything before writing; replace each file atomically and roll
  // back completed writes on an ordinary I/O failure. Builds check consistency.
  const changes = [
    { path: resolve(root, "CHANGELOG.md"), before: current.changelog, after: changelog },
    { path: resolve(root, "package.json"), before: current.packageText, after: JSON.stringify({ ...current.pkg, version }, null, 2) + "\n" },
  ];
  const applied: typeof changes = [];
  try {
    for (const change of changes) {
      await replaceFile(change.path, change.after);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) await replaceFile(change.path, change.before);
    throw error;
  }
  return result;
}

async function replaceFile(path: string, text: string): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (import.meta.main) {
  try {
    const [action, ...flags] = process.argv.slice(2);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    if (flags.some(flag => flag !== "--dry-run") || !["check", "patch", "minor", "major"].includes(action ?? "")) {
      throw new Error("Usage: bun run scripts/version.ts check|patch|minor|major [--dry-run]");
    }
    if (action === "check") console.log(`Version ${await readProjectVersion(root)}: package and changelog agree.`);
    else {
      const dryRun = flags.includes("--dry-run");
      const result = await updateVersion(root, action as Bump, { dryRun });
      console.log(`${dryRun ? "Would bump" : "Bumped"} ${result.previous} → ${result.version}${dryRun ? " (no files changed)" : "; changelog updated"}.`);
      if (!dryRun) console.log("Rebuild with bun run reload for development or bun run build for release. No commit, tag, or upload was created.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
