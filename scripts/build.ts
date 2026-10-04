import { buildExtension, parseBuildArguments } from "./build-lib";

await buildExtension(parseBuildArguments(process.argv.slice(2)));
