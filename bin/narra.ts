#!/usr/bin/env node
import { parseArgs } from "../src/cli/args.js";
import { run } from "../src/cli/index.js";

run(parseArgs(process.argv.slice(2))).then((code) => process.exit(code), (err) => {
  console.error(`narra: ${(err as Error).message}`);
  process.exit(10);
});
