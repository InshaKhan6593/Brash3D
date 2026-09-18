import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { createBookingWithSession } from "@/lib/store/sessionStore"
import { cleanup, newFixtures, SELLER_ID, type Fixtures } from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

let slotOffset = 0

/**
 * A free slot far enough out that it cannot collide with real availability.
 *
 * Idempotent on the date/time key, so a row left behind by an earlier run is
 * reused and freed rather than colliding with the unique index.
 */
async function freeSlot(): Promise<string> {
  slotOffset += 1
  const result = await query<{ id: string }>(`
    INSERT INTO disponibilidad (vendedor_id, fecha, hora_inicio, hora_fin, disponible)
    VALUES ($1::uuid, current_date + ($2 * interval '1 day'), make_time($3, 0, 0), make_time($3 + 1, 0, 0), true)
    ON CONFLICT (vendedor_id, fecha, hora_inicio) DO UPDATE SET disponible = true
    RETURNING id::text
  `, [SELLER_ID, 700 + Math.floor(slotOffset / 6), 2 + (slotOffset % 6)])
  fixtures.slots.push(result.rows[0].id)
  return result.rows[0].id
}

function person(tag: string) {
  const id = randomUUID().slice(0, 10)
  return {
    nombre: `${tag} ${id}`,
    email: `referral-${tag}-${id}@example.test`,
    telefono: `+5791${id.replace(/\D/g, "0").slice(0, 8)}`,
    ciudad: "Bogota",
    pais: "Colombia",
  }
}

/** Books a slot, registering everything the booking creates for cleanup. */
async function book(customer: ReturnType<typeof person> & { referralCode?: string }) {
  const slotId = await freeSlot()
  const result = await createBookingWithSession(customer, slotId)
  fixtures.customers.push(result.session.clienteId)
  fixtures.bookings.push(result.booking.id)
  fixtures.sessions.push(result.session.id)
  return result
}

/** The reward a referrer has earned but not yet spent. */
async function pendingRewards(customerId: string): Promise<number> {
  const result = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM referidos_recompensas WHERE referidor_id = $1::uuid AND estado = 'pendiente'",
    [customerId]
  )
  return Number(result.rows[0].n)
}

/**
 * Grants a reward the way the Stripe webhook does.
 *
 * The real grant is reached only through `processSessionCheckoutEvent`, which
 * needs a checkout id and a signed event. The rules being pinned here are the
 * ones after that point -- who may spend a reward, on what, and how often --
 * so the row is written directly with the same values the webhook writes.
 */
async function grantReward(referrerId: string, referidoId: string, bookingId: string) {
  await query(`
    INSERT INTO referidos_recompensas (referidor_id, referido_id, reserva_aplicada_id, monto_recompensa, estado, fecha_expiracion)
    VALUES ($1::uuid, $2::uuid, $3::uuid, 20.00, 'pendiente', now() + interval '1 year')
    ON CONFLICT (referido_id) DO NOTHING
  `, [referrerId, referidoId, bookingId])
}

/**
 * The referral program gives away the 20 USD booking fee, and had no test in
 * the suite -- only HTTP smoke scripts that need a running server and Stripe.
 * These pin the rules that decide when money is not collected.
 */
describe("redeeming a referral reward", () => {
  it("confirms the booking with no fee and spends the reward", async () => {
    fixtures = newFixtures()
    const referrer = await book(person("referrer"))
    const referred = await book(person("referred"))
    await grantReward(referrer.session.clienteId, referred.session.clienteId, referred.booking.id)

    const free = await book(person("referrer-again"))
    // Same person books again: the customer row is matched on email/phone, so
    // this has to be the referrer booking a second time.
    expect(free.rewardApplied).toBe(false)

    const second = await book({ ...person("x"), email: referrer.booking.cliente.email, telefono: referrer.booking.cliente.telefono })
    expect(second.rewardApplied).toBe(true)
    expect(second.booking.montoReserva).toBe(0)
    expect(second.booking.estado).toBe("confirmada")
    expect(await pendingRewards(referrer.session.clienteId)).toBe(0)
  })

  it("does not spend the same reward twice", async () => {
    fixtures = newFixtures()
    const referrer = await book(person("referrer"))
    const referred = await book(person("referred"))
    await grantReward(referrer.session.clienteId, referred.session.clienteId, referred.booking.id)

    const identity = { email: referrer.booking.cliente.email, telefono: referrer.booking.cliente.telefono }
    const first = await book({ ...person("a"), ...identity })
    const second = await book({ ...person("b"), ...identity })

    expect(first.rewardApplied).toBe(true)
    // The second booking pays, because the one reward is already spent.
    expect(second.rewardApplied).toBe(false)
    expect(second.booking.montoReserva).toBe(20)
    expect(second.booking.estado).toBe("pendiente_pago")
  })

  it("leaves an expired reward unspent and charges for the booking", async () => {
    fixtures = newFixtures()
    const referrer = await book(person("referrer"))
    const referred = await book(person("referred"))
    await grantReward(referrer.session.clienteId, referred.session.clienteId, referred.booking.id)
    await query(
      "UPDATE referidos_recompensas SET fecha_expiracion = now() - interval '1 day' WHERE referidor_id = $1::uuid",
      [referrer.session.clienteId]
    )

    const next = await book({ ...person("c"), email: referrer.booking.cliente.email, telefono: referrer.booking.cliente.telefono })
    expect(next.rewardApplied).toBe(false)
    expect(next.booking.montoReserva).toBe(20)
  })

  // A free booking is confirmed outright, so it holds its slot permanently.
  // The expiry sweep only cancels `pendiente_pago`, but the row keeps whatever
  // hold it was created with -- worth pinning, because a confirmed booking
  // swept away as an expired hold would hand the customer's slot to someone
  // else and leave the reward spent.
  it("keeps a complimentary booking when expired holds are swept", async () => {
    fixtures = newFixtures()
    const referrer = await book(person("referrer"))
    const referred = await book(person("referred"))
    await grantReward(referrer.session.clienteId, referred.session.clienteId, referred.booking.id)
    const free = await book({ ...person("d"), email: referrer.booking.cliente.email, telefono: referrer.booking.cliente.telefono })
    expect(free.rewardApplied).toBe(true)

    await query("UPDATE reservas SET hold_expires_at = now() - interval '1 hour' WHERE id = $1::uuid", [free.booking.id])
    await query("UPDATE reservas SET estado = 'cancelada', cancellation_reason = 'hold_expired' WHERE estado = 'pendiente_pago' AND hold_expires_at <= now()")

    const after = await query<{ estado: string }>("SELECT estado::text FROM reservas WHERE id = $1::uuid", [free.booking.id])
    expect(after.rows[0].estado).toBe("confirmada")
  })
})

describe("who may be referred", () => {
  it("rejects a code that belongs to the person using it", async () => {
    fixtures = newFixtures()
    const referrer = await book(person("self"))
    const code = await query<{ codigo: string }>(
      "SELECT codigo_referido AS codigo FROM clientes WHERE id = $1::uuid",
      [referrer.session.clienteId]
    )

    await expect(book({
      ...person("self-again"),
      email: referrer.booking.cliente.email,
      telefono: referrer.booking.cliente.telefono,
      referralCode: code.rows[0].codigo,
    })).rejects.toThrow("REFERRAL_CODE_ONLY_FIRST_BOOKING")
  })

  it("rejects a code nobody owns", async () => {
    fixtures = newFixtures()
    await expect(book({ ...person("unknown"), referralCode: "NOPE-NOT-A-CODE" }))
      .rejects.toThrow("INVALID_REFERRAL_CODE")
  })

  it("records the referrer on a first booking", async () => {
    fixtures = newFixtures()
    const referrer = await book(person("owner"))
    const code = await query<{ codigo: string }>(
      "SELECT codigo_referido AS codigo FROM clientes WHERE id = $1::uuid",
      [referrer.session.clienteId]
    )

    const referred = await book({ ...person("newcomer"), referralCode: code.rows[0].codigo })
    const link = await query<{ referido_por_id: string | null }>(
      "SELECT referido_por_id::text FROM clientes WHERE id = $1::uuid",
      [referred.session.clienteId]
    )
    expect(link.rows[0].referido_por_id).toBe(referrer.session.clienteId)
  })
})
