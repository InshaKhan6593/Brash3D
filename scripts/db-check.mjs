/**
 * Read-only verification of whatever database DATABASE_URL points at.
 *
 * `/api/health` answers the same first question — can the app reach the
 * database — but only from inside a running deployment, and only that one
 * question. Three things matter on a hosted database that do not matter on the
 * Docker container, because nothing local fails loudly when they are wrong:
 *
 *   1. TLS. A managed provider refuses a plaintext connection, and Supabase
 *      signs its certificates with a private root, so a missing CA fails with
 *      SELF_SIGNED_CERT_IN_CHAIN — a message that points at the certificate
 *      rather than at the configuration that omitted it.
 *   2. Migrations. On a persistent host `npm run db:migrate` runs as a
 *      pre-deploy step; on a serverless one somebody runs it by hand, so the
 *      code can ship ahead of the schema it needs. This reports a migration on
 *      disk that the database has never applied, and a file edited after it was
 *      applied, which is the drift `migrate.mjs` refuses to run through.
 *   3. Row level security. Supabase serves PostgREST over the `public` schema
 *      to anyone holding the publishable key, whether or not this application
 *      uses supabase-js. RLS with no policies is what closes that endpoint
 *      (migration 015), and a new table added without it is exposed silently.
 *
 * Nothing here writes. Exits non-zero when a check fails, so it can gate a
 * deploy.
 */

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

const failures = []
const warnings = []

function report(ok, label, detail) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

const target = (() => {
  try {
    const url = new URL(connectionString)
    return { host: url.hostname, port: url.port || "5432", user: url.username }
  } catch {
    return { host: "(unparseable DATABASE_URL)", port: "", user: "" }
  }
})()

const ssl = sslConfig(connectionString)
console.log(`target    ${target.user}@${target.host}:${target.port}`)
console.log(`tls       ${ssl === false ? "disabled (local host)" : `verify=${ssl.rejectUnauthorized}, pinned CA=${ssl.ca ? "yes" : "no (system store)"}`}`)
console.log("")

const pool = new pg.Pool({ connectionString, ssl, max: 1, connectionTimeoutMillis: 15_000 })

try {
  const startedAt = Date.now()
  const server = await pool.query("SELECT version(), current_user, current_database()")
  report(true, "connection", `${Date.now() - startedAt} ms, as ${server.rows[0].current_user}`)
  console.log(`      ${server.rows[0].version.split(" on ")[0]}`)

  // Supabase's poolers multiplex, so the port decides whether a connection is
  // held for a session or only for a transaction. Neither is wrong, but the
  // pool size that suits one is wrong for the other.
  if (target.host.includes("pooler.supabase.com")) {
    const mode = target.port === "6543" ? "transaction" : "session"
    const poolMax = Number(process.env.DATABASE_POOL_MAX || 10)
    report(true, "supabase pooler", `${mode} mode (port ${target.port}), DATABASE_POOL_MAX=${poolMax}`)
    if (mode === "transaction" && poolMax > 1) {
      warnings.push(`Transaction pooler with DATABASE_POOL_MAX=${poolMax}. Serverless instances each open their own pool; use 1.`)
    }
    if (mode === "session" && poolMax === 1) {
      warnings.push("Session pooler with DATABASE_POOL_MAX=1. A long-running host can afford more; 10 is the documented value.")
    }
  }

  const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
  const recorded = new Map(
    (await pool.query("SELECT filename, checksum FROM schema_migrations")).rows.map((row) => [row.filename, row.checksum])
  )

  const pending = []
  const changed = []
  for (const filename of files) {
    const checksum = createHash("sha256").update(await readFile(path.join(migrationsDirectory, filename), "utf8")).digest("hex")
    const applied = recorded.get(filename)
    if (!applied) pending.push(filename)
    else if (applied !== checksum) changed.push(filename)
  }

  report(pending.length === 0, "migrations applied", pending.length ? `${pending.length} pending: ${pending.join(", ")} — run npm run db:migrate` : `all ${files.length}`)
  report(changed.length === 0, "migrations unchanged", changed.length ? `edited after being applied: ${changed.join(", ")}` : "checksums match")

  // schema_migrations rows with no file behind them mean the database is ahead
  // of this checkout — a deploy from a branch that has since been rewritten.
  const orphaned = [...recorded.keys()].filter((filename) => !files.includes(filename))
  if (orphaned.length) warnings.push(`Applied migrations with no file in this checkout: ${orphaned.join(", ")}`)

  const tables = await pool.query(`
    SELECT c.relname,
           c.relrowsecurity,
           (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  `)
  const unprotected = tables.rows.filter((row) => !row.relrowsecurity).map((row) => row.relname)
  report(
    unprotected.length === 0,
    "row level security",
    unprotected.length
      ? `not enabled on ${unprotected.join(", ")} — a new table needs ALTER TABLE ... ENABLE ROW LEVEL SECURITY in its own migration`
      : `enabled on all ${tables.rowCount} public tables`
  )

  // RLS is the control; these grants are the defence in depth behind it. A
  // grant reappearing means something re-ran Supabase's default privileges.
  const grants = await pool.query(`
    SELECT table_name, grantee, string_agg(DISTINCT privilege_type, ',') AS privileges
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
     GROUP BY 1, 2 ORDER BY 1, 2
  `)
  report(
    grants.rowCount === 0,
    "anon privileges revoked",
    grants.rowCount ? grants.rows.map((row) => `${row.grantee} has ${row.privileges} on ${row.table_name}`).join("; ") : "anon and authenticated hold nothing"
  )

  const policied = tables.rows.filter((row) => row.policies > 0)
  if (policied.length) {
    console.log(`      ${policied.length} table(s) carry RLS policies: ${policied.map((row) => `${row.relname}(${row.policies})`).join(", ")}`)
  }

  const roundTrip = Date.now()
  await pool.query("SELECT 1")
  console.log(`\nround trip  ${Date.now() - roundTrip} ms from here`)
} catch (error) {
  report(false, "connection", error.message)
  if (error.code === "SELF_SIGNED_CERT_IN_CHAIN") {
    console.log("      Supabase's root is not in the system trust store. Set DATABASE_SSL_CA_FILE=certs/supabase-root-2021.crt,")
    console.log("      or DATABASE_SSL_CA with that file's contents on a host that takes only environment values.")
  }
} finally {
  await pool.end()
}

if (warnings.length) {
  console.log("")
  for (const warning of warnings) console.log(`warn  ${warning}`)
}

console.log("")
if (failures.length) {
  console.log(`${failures.length} check(s) failed: ${failures.join(", ")}`)
  process.exit(1)
}
console.log("All database checks passed.")
