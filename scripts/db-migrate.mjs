// Applies supabase/migrations/*.sql to the disposable local database, once each, in order.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const dir = "supabase/migrations";
const named = /^(\d{14})_([a-z0-9_]+)\.sql$/;

function psql(sql, extra = []) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      ...extra,
    ],
    { input: sql, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || "psql failed");
  }
  return result.stdout;
}

psql(
  "create schema if not exists supabase_migrations;" +
    "create table if not exists supabase_migrations.schema_migrations (version text primary key, name text not null);"
);
const applied = new Set(
  psql("select version from supabase_migrations.schema_migrations;")
    .split(/\r?\n/)
    .filter(Boolean)
);

for (const file of readdirSync(dir).sort()) {
  const match = named.exec(file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- names come from the fixed migrations directory.
  const sql = readFileSync(`${dir}/${file}`, "utf8");
  if (!match || !sql.startsWith("-- Title: ")) {
    throw new Error(
      `${file}: needs <timestamp>_<descriptive_title>.sql and a "-- Title:" first line`
    );
  }
  const [, version, name] = match;
  if (applied.has(version)) continue;
  psql(
    `${sql}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');`,
    ["--single-transaction"]
  );
  console.log(`applied ${file}`);
}
// The local API caches the schema; tell it about new tables.
psql("notify pgrst, 'reload schema';");
