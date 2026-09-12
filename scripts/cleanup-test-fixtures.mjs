/**
 * Removes the records created by `scripts/seed-test-fixtures.mjs` and the
 * contract smoke test, so a demo database can be handed over without synthetic
 * orders in it.
 *
 * Scope is deliberately narrow. It deletes only what the fixture scripts
 * *created*, identified by the customer email markers they stamp:
 *
 *     fixture+<timestamp>@brash3d.test
 *     spare+<timestamp>@brash3d.test
 *
 * Everything hanging off those customers goes with them — bookings, sessions,
 * cart lines, shipments, payment logs, notifications — and the slots they held
 * are released. Consolidated boxes are removed only once they hold no shipments
 * at all, so a box that ever carried a real order is left alone.
 *
 * WHAT IT CANNOT UNDO
 * The seeder also advanced some *pre-existing* demo orders through the workflow,
 * writing payment rows against them. Those customers are real demo data, so
 * their orders are reported rather than deleted — reverting a part-paid order to
 * "booked" is not a safe automatic operation. The report names each one so the
 * decision is yours.
 *
 * Usage:
 *   node scripts/cleanup-test-fixtures.mjs            # dry run, changes nothing
 *   node scripts/cleanup-test-fixtures.mjs --apply    # perform the deletion
 *
 * The dry run is the default on purpose: this points at whatever DATABASE_URL
 * resolves to, which in this project is a hosted Supabase database.
 */

import { readFileSync } from "node:fs"
import pg from "pg"

const APPLY = process.argv.includes("--apply")

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()])
)

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, "utf8") } : undefined,
})

const FIXTURE_CUSTOMERS = `
  SELECT id FROM clientes
  WHERE email LIKE 'fixture+%@brash3d.test' OR email LIKE 'spare+%@brash3d.test'
`

async function main() {
  const host = (env.DATABASE_URL || "").replace(/\/\/[^@]*@/, "//***@")
  console.log(`Database: ${host}`)
  console.log(APPLY ? "Mode: APPLY — records will be deleted\n" : "Mode: dry run — nothing will be changed\n")

  const client = await pool.connect()
  try {
    const { rows: customers } = await client.query(`
      SELECT c.id::text, c.nombre, c.email,
        (SELECT count(*)::int FROM reservas r WHERE r.cliente_id = c.id) AS bookings,
        (SELECT count(*)::int FROM sesiones_compra sc WHERE sc.cliente_id = c.id) AS sessions
      FROM clientes c WHERE c.id IN (${FIXTURE_CUSTOMERS}) ORDER BY c.created_at
    `)

    if (!customers.length) {
      console.log("No fixture customers found — nothing to clean up.")
    } else {
      console.log("Fixture customers to remove, with everything belonging to them:")
      console.table(customers)
    }

    const { rows: counts } = await client.query(`
      WITH fixture_customers AS (${FIXTURE_CUSTOMERS}),
      fixture_sessions AS (SELECT id FROM sesiones_compra WHERE cliente_id IN (SELECT id FROM fixture_customers)),
      fixture_bookings AS (SELECT id, disponibilidad_id FROM reservas WHERE cliente_id IN (SELECT id FROM fixture_customers))
      SELECT
        (SELECT count(*)::int FROM productos_carrito WHERE sesion_id IN (SELECT id FROM fixture_sessions)) AS cart_lines,
        (SELECT count(*)::int FROM envios WHERE sesion_id IN (SELECT id FROM fixture_sessions)) AS shipments,
        (SELECT count(*)::int FROM payment_logs WHERE sesion_id IN (SELECT id FROM fixture_sessions)
            OR reserva_id IN (SELECT id FROM fixture_bookings)) AS payment_logs,
        (SELECT count(*)::int FROM staff_notifications WHERE reserva_id IN (SELECT id FROM fixture_bookings)) AS notifications,
        (SELECT count(*)::int FROM customer_session_access WHERE session_id IN (SELECT id FROM fixture_sessions)) AS access_tokens,
        (SELECT count(*)::int FROM fixture_sessions) AS sessions,
        (SELECT count(*)::int FROM fixture_bookings) AS bookings,
        (SELECT count(*)::int FROM fixture_bookings WHERE disponibilidad_id IS NOT NULL) AS slots_to_release
    `)
    console.log("Dependent records:")
    console.table(counts)

    // Orders the seeder advanced that belong to genuine demo customers. These
    // are reported, never deleted — see the header.
    const { rows: touched } = await client.query(`
      SELECT sc.id::text AS session, c.nombre AS customer, sc.estado,
        sc.total::text AS total, sc.monto_pagado_inicial::text AS paid_initial,
        COALESCE(e.estado::text, '-') AS shipment
      FROM sesiones_compra sc
      JOIN clientes c ON c.id = sc.cliente_id
      LEFT JOIN envios e ON e.sesion_id = sc.id
      WHERE sc.payment_intent_inicial_id LIKE 'pi_fixture_%'
        AND sc.cliente_id NOT IN (${FIXTURE_CUSTOMERS})
      ORDER BY c.nombre
    `)

    if (!APPLY) {
      if (touched.length) {
        console.log("\nNOT removable — pre-existing demo orders the seeder advanced.")
        console.log("They carry synthetic payment rows but belong to real demo customers:")
        console.table(touched)
        console.log("Decide per order: leave as a worked example, or reset the demo data wholesale.")
      }
      console.log("\nDry run complete. Re-run with --apply to delete the fixture records above.")
      return
    }

    await client.query("BEGIN")
    const removed = {}
    const run = async (label, sql) => {
      const result = await client.query(sql)
      removed[label] = result.rowCount
    }

    // Children first: most foreign keys are NO ACTION, so nothing cascades for
    // us. customer_session_access, session_audit_events and staff_notifications
    // do cascade, but deleting them explicitly keeps the count honest.
    const scope = `
      WITH fixture_customers AS (${FIXTURE_CUSTOMERS})
      SELECT id FROM sesiones_compra WHERE cliente_id IN (SELECT id FROM fixture_customers)
    `
    const bookingScope = `
      WITH fixture_customers AS (${FIXTURE_CUSTOMERS})
      SELECT id FROM reservas WHERE cliente_id IN (SELECT id FROM fixture_customers)
    `

    await run("cart lines", `DELETE FROM productos_carrito WHERE sesion_id IN (${scope})`)
    await run("payment logs", `DELETE FROM payment_logs WHERE sesion_id IN (${scope}) OR reserva_id IN (${bookingScope})`)
    await run("shipments", `DELETE FROM envios WHERE sesion_id IN (${scope})`)
    await run("access tokens", `DELETE FROM customer_session_access WHERE session_id IN (${scope})`)
    await run("audit events", `DELETE FROM session_audit_events WHERE session_id IN (${scope})`)
    await run("referral rewards", `
      DELETE FROM referidos_recompensas
      WHERE referidor_id IN (${FIXTURE_CUSTOMERS}) OR referido_id IN (${FIXTURE_CUSTOMERS})
         OR reserva_aplicada_id IN (${bookingScope}) OR reserva_recompensa_usada_id IN (${bookingScope})
    `)
    await run("notifications", `DELETE FROM staff_notifications WHERE reserva_id IN (${bookingScope})`)
    await run("sessions", `DELETE FROM sesiones_compra WHERE cliente_id IN (${FIXTURE_CUSTOMERS})`)

    // Release the slots before the bookings that hold them disappear.
    await run("slots released", `
      UPDATE disponibilidad SET disponible = true
      WHERE id IN (SELECT disponibilidad_id FROM reservas
                   WHERE cliente_id IN (${FIXTURE_CUSTOMERS}) AND disponibilidad_id IS NOT NULL)
    `)
    await run("bookings", `DELETE FROM reservas WHERE cliente_id IN (${FIXTURE_CUSTOMERS})`)
    await run("customers", `DELETE FROM clientes WHERE id IN (${FIXTURE_CUSTOMERS})`)

    // Only boxes that are now completely empty. A box that ever carried a real
    // order still has that shipment and is left untouched.
    await run("empty boxes", `
      DELETE FROM cajas_consolidadas cc
      WHERE NOT EXISTS (SELECT 1 FROM envios e WHERE e.caja_id = cc.id)
        AND cc.courier IN ('DHL Express', 'FedEx International')
    `)

    await client.query("COMMIT")
    console.log("Deleted:")
    console.table(removed)

    if (touched.length) {
      console.log("\nStill present — pre-existing demo orders the seeder advanced:")
      console.table(touched)
      console.log("These were not touched: they belong to real demo customers.")
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(async (error) => {
  console.error("\nCleanup failed:", error.message)
  await pool.end().catch(() => {})
  process.exit(1)
})
