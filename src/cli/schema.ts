import type { Args } from "./args.js";
import { SCHEMAS, jsonSchema } from "../schemas.js";

export async function schema(args: Args): Promise<number> {
  const name = args.pos[0];
  if (!name) { console.log(JSON.stringify(Object.fromEntries(Object.keys(SCHEMAS).map((k) => [k, jsonSchema(k as keyof typeof SCHEMAS)])), null, 2)); return 0; }
  if (!(name in SCHEMAS)) { console.error(`unknown schema "${name}" (${Object.keys(SCHEMAS).join(", ")})`); return 10; }
  console.log(JSON.stringify(jsonSchema(name as keyof typeof SCHEMAS), null, 2));
  return 0;
}
