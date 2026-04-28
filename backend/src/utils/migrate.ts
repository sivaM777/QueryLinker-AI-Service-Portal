import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { pool } from "../config/db.js";

type AppliedMigrationRow = { filename: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.resolve(__dirname, "../../migrations");

const ensureMigrationsTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );
};

const getApplied = async () => {
  const res = await pool.query<AppliedMigrationRow>("SELECT filename FROM schema_migrations");
  return new Set(res.rows.map((r) => r.filename));
};

const applyMigration = async (filename: string, sql: string) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log(`Applied migration: ${filename}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const run = async () => {
  await ensureMigrationsTable();

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = await getApplied();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await applyMigration(file, sql);
  }

  await pool.end();
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed", err);
  process.exit(1);
});
