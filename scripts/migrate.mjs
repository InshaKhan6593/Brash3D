import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import nextEnv from "@next/env"
import pg from "pg"
import { sslConfig } from "../src/lib/db-ssl.mjs"

const { loadEnvConfig } = nextEnv

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
loadEnvConfig(appDirectory)

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5440/brash3d"
const migrationsDirectory = path.resolve(appDirectory, "supabase", "migrations")
const pool = new pg.Pool({
  connectionString,
  ssl: sslConfig(connectionString),
  max: 1,
  connectionTimeoutMillis: 5000,
})

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  // A fresh Supabase project already ships a `supabase_realtime` publication, so
  // migration 001's CREATE PUBLICATION would fail before anything else could run.
  // Only drop it when the database is genuinely empty; an existing database keeps
  // its publication, its data, and every recorded checksum untouched.
  const untouched = await pool.query(`
    SELECT to_regclass('public.clientes') IS NULL
      AND NOT EXISTS (SELECT 1 FROM schema_migrations) AS empty
  `)
  if (untouched.rows[0]?.empty) {
    const publication = await pool.query(
      "SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'"
    )
    if (publication.rowCount) {
      await pool.query("DROP PUBLICATION supabase_realtime")
      console.log("Dropped the provider's pre-created supabase_realtime publication so 001 can define it")
    }
  }

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()

  const existing = await pool.query("SELECT filename, checksum FROM schema_migrations")
  const applied = new Map(existing.rows.map((row) => [row.filename, row.checksum]))

  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8")
    const checksum = createHash("sha256").update(sql).digest("hex")
    const recordedChecksum = applied.get(filename)

    if (recordedChecksum) {
      if (recordedChecksum !== checksum) throw new Error(`Applied migration changed: ${filename}`)
      console.log(`Already applied: ${filename}`)
      continue
    }

    // The original Docker volume predates migration tracking. Baseline its initial schema.
    if (filename === "001_initial_schema.sql") {
      const baseline = await pool.query("SELECT to_regclass('public.clientes') AS table_name")
      if (baseline.rows[0]?.table_name) {
        await pool.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [filename, checksum]
        )
        console.log(`Baselined existing schema: ${filename}`)
        continue
      }
    }

    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(sql)
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [filename, checksum]
      )
      await client.query("COMMIT")
      console.log(`Applied: ${filename}`)
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }
} finally {
  await pool.end()
}
