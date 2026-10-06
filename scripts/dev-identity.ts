import { isAbsolute, resolve } from "node:path";

export interface DevIdentity {
  sourceRoot: string;
  outputDir: string;
}

export interface DevVersion extends DevIdentity {
  buildId: string;
}

/** Resolve both sides identically even when reload is invoked from another cwd. */
export function devIdentity(sourceRoot: string, configuredOutput?: string): DevIdentity {
  if (configuredOutput !== undefined && !configuredOutput.trim()) {
    throw new Error("PLANNOTATOR_EXTENSION_DEV_OUTDIR must name an output directory.");
  }
  const root = resolve(sourceRoot);
  return { sourceRoot: root, outputDir: resolve(root, configuredOutput ?? "dist") };
}

/** Never rebuild an unidentified watcher, or one belonging to another checkout. */
export function parseDevVersion(value: unknown, expected: DevIdentity): DevVersion {
  if (!value || typeof value !== "object") throw new Error("Invalid Threadlane dev watcher response.");
  const record = value as Record<string, unknown>;
  if (typeof record.buildId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(record.buildId)) {
    throw new Error("Invalid Threadlane dev build ID.");
  }
  if (typeof record.sourceRoot !== "string" || !isAbsolute(record.sourceRoot) ||
      typeof record.outputDir !== "string" || !isAbsolute(record.outputDir)) {
    throw new Error("The dev watcher does not identify its source and output directories; refusing to rebuild an unverified watcher.");
  }
  const actual = devIdentity(record.sourceRoot, record.outputDir);
  if (actual.sourceRoot !== expected.sourceRoot) {
    throw new Error(`The dev watcher uses source ${actual.sourceRoot}, expected ${expected.sourceRoot}; refusing to rebuild another checkout.`);
  }
  if (actual.outputDir !== expected.outputDir) {
    throw new Error(`The dev watcher writes ${actual.outputDir}, expected ${expected.outputDir}; refusing to rebuild another installation.`);
  }
  return { buildId: record.buildId, ...actual };
}
