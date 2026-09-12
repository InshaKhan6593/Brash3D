/**
 * Empties the transactional data and keeps the configuration.
 *
 * Use this to hand someone a clean system: no customers, bookings, sessions,
 * shipments, boxes or payment records, but the staff accounts, the seller and
 * local-team rows they point at, and the weekly opening-hours template all
 * survive. Availability is deleted too and regenerates from that template the
 * next time anyone reads the slot list, so the booking page refills itself.
 *
 * Dry run by default, because `DATABASE_URL` points at a hosted database and
 * this is not recoverable. `--apply` performs the deletion, inside one
 * transaction, so a failure part-way leaves the database as it was.
 *
 *   node scripts/reset-demo-data.mjs            # report only
 *   node scripts/reset-demo-data.mjs --apply    # delete
 */

import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import nextEnv from "@next/env"
import pg from "pg"
import { sslConfig } from "../src/lib/db-ssl.mjs"

const { loadEnvConfig } = nextEnv
const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
loadEnvConfig(appDirectory)

const apply = process.argv.includes("--apply")
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5440/brash3d"

// Emptied. Ordered so a child is always removed before its parent.
const CLEARED = [
  "payment_logs",
  "productos_carrito",
  "customer_session_access",
  "session_audit_events",
  "staff_notifications",
  "envios",
  "cajas_consolidadas",
  "sesiones_compra",
  "referidos_recompensas",
  "reservas",
  "clientes",
  "disponibilidad",
  "stripe_webhook_events",
  "request_rate_limits",
  "staff_sessions",
]

// Kept: this is configuration, not history. `staff_users` holds the logins;
// `vendedores` and `equipos_locales` are the rows a seller and a local-team
// login must match; `horarios_plantilla` and `excepciones_calendario` decide
// which hours exist, and availability is regenerated from them.
const KEPT = ["staff_users", "vendedores", "equipos_locales", "horarios_plantilla", "excepciones_calendario", "schema_migrations"]

const client = new pg.Client({ connectionString, ssl: sslConfig(connectionString), connectionTimeoutMillis: 15_000 })
await client.connect()

async function count(table) {
  return (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n
}

try {
  console.log(`target   ${new URL(connectionString).hostname}`)
  console.log(apply ? "mode     APPLY — rows will be deleted\n" : "mode     dry run — nothing will be changed (pass --apply to delete)\n")

  console.log("to be emptied:")
  let total = 0
  for (const table of CLEARED) {
    const n = await count(table)
    total += n
    console.log(`  ${table.padEnd(26)} ${String(n).padStart(5)}`)
  }
  console.log(`  ${"".padEnd(26)} ${String(total).padStart(5)} rows total\n`)

  console.log("kept:")
  for (const table of KEPT) {
    console.log(`  ${table.padEnd(26)} ${String(await count(table)).padStart(5)}`)
  }

  if (!apply) {
    console.log("\nDry run. Nothing was changed.")
  } else {
    await client.query("BEGIN")
    // The reward a booking consumed is deleted below it, so drop the reference
    // before its target rather than relying on delete order alone.
    await client.query("UPDATE reservas SET recompensa_referido_id = NULL WHERE recompensa_referido_id IS NOT NULL")
    for (const table of CLEARED) {
      const result = await client.query(`DELETE FROM ${table}`)
      console.log(`\ndeleted ${String(result.rowCount).padStart(5)} from ${table}`)
    }
    await client.query("COMMIT")

    console.log("\nremaining:")
    for (const table of [...CLEARED, ...KEPT]) {
      console.log(`  ${table.padEnd(26)} ${String(await count(table)).padStart(5)}`)
    }
    console.log("\nDone. Availability regenerates from the weekly template the next time the slot list is read.")
  }
} catch (error) {
  if (apply) await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
