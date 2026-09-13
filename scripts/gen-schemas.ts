/** Writes schemas/*.json from the zod definitions so agents and other languages can read them without running narra. */
import { mkdirSync, writeFileSync } from "node:fs";
import { SCHEMAS, jsonSchema } from "../src/schemas.js";
mkdirSync("schemas", { recursive: true });
for (const k of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) writeFileSync(`schemas/${k}.json`, JSON.stringify(jsonSchema(k), null, 2) + "\n");
console.log(`schemas: ${Object.keys(SCHEMAS).join(", ")}`);
