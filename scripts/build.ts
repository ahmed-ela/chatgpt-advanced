import { buildExtension } from "./build-lib";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--outdir" || !args[1])) {
  throw new Error("Usage: bun run build [--outdir <directory>]");
}
await buildExtension({ outdir: args[1] });
