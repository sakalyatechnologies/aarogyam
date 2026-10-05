/**
 * Runs SQL as the schema owner through `psql`, the tool `scripts/dev-db.sh` already needs, so the
 * suite adds no database driver. Values travel as psql variables (`:'name'`), never spliced
 * into the SQL text.
 */
import { execFile } from "node:child_process";

import { OWNER_DB_URL } from "./stack.ts";

/** Runs `sql` with `vars` and returns the last line of output parsed as JSON. */
export function ownerQuery(sql: string, vars: Readonly<Record<string, string>> = {}): Promise<unknown> {
  const args = [OWNER_DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(vars)) {
    args.push("-v", `${name}=${value}`);
  }
  args.push("-f", "-");
  return new Promise((resolve, reject) => {
    const child = execFile("psql", args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`psql failed: ${stderr.trim() || error.message}`));
        return;
      }
      const last = stdout.trim().split("\n").at(-1) ?? "";
      try {
        const parsed: unknown = JSON.parse(last);
        resolve(parsed);
      } catch {
        reject(new Error(`psql printed no JSON: ${last.slice(0, 200)}`));
      }
    });
    child.stdin?.end(sql);
  });
}

/** Reads a string field from parsed JSON, failing loudly when it is missing. */
export function text(value: unknown, key: string): string {
  if (typeof value === "object" && value !== null && key in value) {
    const field: unknown = Reflect.get(value, key);
    if (typeof field === "string") {
      return field;
    }
  }
  throw new Error(`expected a string ${key} in ${JSON.stringify(value).slice(0, 200)}`);
}
