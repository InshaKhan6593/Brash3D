import assert from "node:assert/strict"
import process from "node:process"
import nextEnv from "@next/env"
import pg from "pg"
import { sslConfig } from "../src/lib/db-ssl.mjs"

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const action = process.argv[2]
assert.ok(["setup", "cleanup"].includes(action), "Usage: node scripts/testsprite-referral-fixture.mjs <setup|cleanup>")

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig() })
const referrerEmail = "testsprite-referral-fixture@local.test"
const referredEmail = "testsprite-referred-fixture@local.test"
const referralCode = "BR3D-TESTSPRITE-FIXTURE"

async function cleanup(client) {
  const customers = await client.query(`
    SELECT id::text FROM clientes WHERE email IN ($1, $2)
  `, [referrerEmail, referredEmail])
  const customerIds = customers.rows.map((row) => row.id)
  if (!customerIds.length) return

  const bookings = await client.query(`
    SELECT id::text, disponibilidad_id::text AS slot_id
    FROM reservas WHERE cliente_id = ANY($1::uuid[])
  `, [customerIds])
  const bookingIds = bookings.rows.map((row) => row.id)
  const sessions = bookingIds.length ? await client.query(`
    SELECT id::text FROM sesiones_compra WHERE reserva_id = ANY($1::uuid[])
  `, [bookingIds]) : { rows: [] }
  const sessionIds = sessions.rows.map((row) => row.id)

  if (sessionIds.length) {
    await client.query("DELETE FROM customer_session_access WHERE session_id = ANY($1::uuid[])", [sessionIds])
    await client.query("DELETE FROM payment_logs WHERE sesion_id = ANY($1::uuid[])", [sessionIds])
    await client.query("DELETE FROM productos_carrito WHERE sesion_id = ANY($1::uuid[])", [sessionIds])
    await client.query("DELETE FROM sesiones_compra WHERE id = ANY($1::uuid[])", [sessionIds])
  }
  if (bookingIds.length) {
    await client.query("DELETE FROM staff_notifications WHERE reserva_id = ANY($1::uuid[])", [bookingIds])
    await client.query("UPDATE reservas SET recompensa_referido_id = NULL WHERE id = ANY($1::uuid[])", [bookingIds])
  }
  await client.query("DELETE FROM referidos_recompensas WHERE referidor_id = ANY($1::uuid[]) OR referido_id = ANY($1::uuid[])", [customerIds])
  if (bookingIds.length) await client.query("DELETE FROM reservas WHERE id = ANY($1::uuid[])", [bookingIds])
  if (bookings.rows.length) await client.query("UPDATE disponibilidad SET disponible = true WHERE id = ANY($1::uuid[])", [bookings.rows.map((row) => row.slot_id)])
  await client.query("DELETE FROM clientes WHERE id = ANY($1::uuid[])", [customerIds])
}

const client = await pool.connect()
try {
  await client.query("BEGIN")
  await cleanup(client)
  if (action === "setup") {
    const slots = await client.query(`
      SELECT d.id::text, d.vendedor_id::text AS seller_id
      FROM disponibilidad d JOIN vendedores v ON v.id = d.vendedor_id AND v.activo = true
      WHERE d.disponible = true AND d.fecha >= current_date
      ORDER BY d.fecha, d.hora_inicio LIMIT 2
    `)
    assert.equal(slots.rows.length, 2, "Need two available local slots for the TestSprite referral fixture")
    const referrer = await client.query(`
      INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido)
      VALUES ('TestSprite Referral Customer', $1, '+15550001111', 'Bogota', 'Colombia', $2)
      RETURNING id::text
    `, [referrerEmail, referralCode])
    const referred = await client.query(`
      INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido, referido_por_id)
      VALUES ('TestSprite Referred Customer', $1, '+15550002222', 'Medellin', 'Colombia', 'BR3D-TESTSPRITE-REFERRED', $2::uuid)
      RETURNING id::text
    `, [referredEmail, referrer.rows[0].id])
    const historyBooking = await client.query(`
      INSERT INTO reservas (cliente_id, disponibilidad_id, fecha_hora, estado, monto_reserva, confirmed_at)
      VALUES ($1::uuid, $2::uuid, now() - interval '7 days', 'confirmada', 20, now() - interval '7 days')
      RETURNING id::text
    `, [referrer.rows[0].id, slots.rows[0].id])
    const historySession = await client.query(`
      INSERT INTO sesiones_compra (reserva_id, vendedor_id, cliente_id, estado, total)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'completada', 129.99)
      RETURNING id::text
    `, [historyBooking.rows[0].id, slots.rows[0].seller_id, referrer.rows[0].id])
    await client.query(`
      INSERT INTO productos_carrito (sesion_id, nombre_producto, precio_unitario, cantidad, precio_total)
      VALUES ($1::uuid, 'TestSprite historical purchase', 129.99, 1, 129.99)
    `, [historySession.rows[0].id])
    const referredBooking = await client.query(`
      INSERT INTO reservas (cliente_id, disponibilidad_id, fecha_hora, estado, monto_reserva, confirmed_at)
      VALUES ($1::uuid, $2::uuid, now() - interval '1 day', 'confirmada', 20, now() - interval '1 day')
      RETURNING id::text
    `, [referred.rows[0].id, slots.rows[1].id])
    await client.query(`
      INSERT INTO referidos_recompensas (referidor_id, referido_id, reserva_aplicada_id, monto_recompensa, estado, fecha_expiracion)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 20, 'pendiente', now() + interval '1 day')
    `, [referrer.rows[0].id, referred.rows[0].id, referredBooking.rows[0].id])
    await client.query("UPDATE disponibilidad SET disponible = false WHERE id = ANY($1::uuid[])", [[slots.rows[0].id, slots.rows[1].id]])
    console.log(JSON.stringify({ email: referrerEmail, name: "TestSprite Referral Customer", phone: "+15550001111", city: "Bogota", referralCode }, null, 2))
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  client.release()
  await pool.end()
}
