import "server-only"

import type { QueryResultRow } from "pg"
import { query } from "@/lib/db"
import { outstandingBalance } from "@/lib/payment-split"
import { listSessions } from "@/lib/store/sessionStore"
import { DEFAULT_COUNTRY } from "@/lib/countries"
import type { BoxSettlement, ConsolidatedBoxManifest, SesionCompra } from "@/lib/types"

interface BoxRow extends QueryResultRow {
  id: string
  numero_caja: string
  equipo_local_id: string
  pais: string
  courier: string | null
  numero_guia: string | null
  estado: string
  created_at: Date
  recibida_at: Date | null
}

// Section 13 of the specification: Stripe collections become US LLC revenue,
// while cash and bank transfers stay in Colombia as the local team's operating
// fund. This is a reporting split only — no funds move between the entities.
export function settlementFor(sessions: SesionCompra[]): BoxSettlement {
  return sessions.reduce<BoxSettlement>((totals, session) => {
    const balance = outstandingBalance(session.total, session.porcentajeInicial, session.montoPagadoFinal)
    const collected = session.montoPagadoFinal
    const method = session.envio?.metodoPagoRecibido

    totals.collected += collected
    totals.pending += balance
    if (collected > 0) totals.deliveredCount += 1
    else totals.pendingCount += 1

    if (method === "stripe") totals.viaStripe += collected
    if (method === "efectivo") {
      totals.cash += collected
      totals.localFund += collected
    }
    if (method === "transferencia") {
      totals.transfer += collected
      totals.localFund += collected
    }
    return totals
  }, {
    collected: 0,
    viaStripe: 0,
    localFund: 0,
    cash: 0,
    transfer: 0,
    pending: 0,
    deliveredCount: 0,
    pendingCount: 0,
  })
}

/**
  * `localTeamId` scopes the result to one destination team. With a single team
  * every box is that team's, so it changes nothing today; the moment a second
  * country exists it is what stops one country's team reading another country's
  * customers, their addresses and their phone numbers.
  */
export async function listBoxManifests(sellerId?: string, localTeamId?: string): Promise<ConsolidatedBoxManifest[]> {
  const [sessions, boxes] = await Promise.all([
    listSessions(),
    query<BoxRow>(`
      SELECT id::text, numero_caja, equipo_local_id::text, pais, courier, numero_guia, estado, created_at, recibida_at
      FROM cajas_consolidadas
      WHERE $1::uuid IS NULL OR equipo_local_id = $1::uuid
      ORDER BY created_at DESC LIMIT 30
    `, [localTeamId ?? null]),
  ])
  const visibleSessions = sellerId ? sessions.filter((session) => session.vendedorId === sellerId) : sessions

  return boxes.rows.map((box) => {
    const boxSessions = visibleSessions.filter((session) => session.envio?.cajaId === box.id)
    const packages = boxSessions.map((session) => ({
      sessionId: session.id,
      labelCode: session.envio?.labelCode || "",
      customerName: session.cliente.nombre,
      phone: session.cliente.telefono,
      deliveryAddress: session.envio?.deliveryAddress || session.deliveryAddress || "",
      deliveryCity: session.envio?.deliveryCity || session.deliveryCity || "",
      remainingBalance: outstandingBalance(session.total, session.porcentajeInicial, session.montoPagadoFinal),
      collectedAmount: session.montoPagadoFinal,
      paymentMethod: session.envio?.metodoPagoRecibido,
      requiresLocalInvoice: Boolean(session.requiresLocalInvoice),
      products: session.productos.map((product) => ({ name: product.nombre, quantity: product.cantidad, price: product.precio })),
    }))
    return {
      id: box.id,
      number: box.numero_caja,
      teamId: box.equipo_local_id,
      country: box.pais,
      courier: box.courier || undefined,
      trackingNumber: box.numero_guia || undefined,
      status: box.estado,
      createdAt: new Date(box.created_at),
      receivedAt: box.recibida_at ? new Date(box.recibida_at) : undefined,
      customerCount: packages.length,
      productLines: packages.reduce((sum, item) => sum + item.products.length, 0),
      totalUnits: packages.reduce((sum, item) => sum + item.products.reduce((units, product) => units + product.quantity, 0), 0),
      settlement: settlementFor(boxSessions),
      packages,
    }
  }).filter((box) => !sellerId || box.packages.length > 0)
}

export interface LocalTeam {
  id: string
  name: string
  city?: string
  country: string
}

/**
 * The destination team a `local_team` staff account belongs to. Its country
 * decides the wording and formatting of that team's panel, so the screen reads
 * its identity from the database rather than assuming Colombia.
 */
export async function getLocalTeam(id: string): Promise<LocalTeam | null> {
  const result = await query<{ id: string; nombre: string; ciudad: string | null; pais: string | null }>(
    "SELECT id::text, nombre, ciudad, pais FROM equipos_locales WHERE id = $1::uuid",
    [id]
  )
  const row = result.rows[0]
  return row ? { id: row.id, name: row.nombre, city: row.ciudad || undefined, country: row.pais || DEFAULT_COUNTRY.name } : null
}

/** The team a consolidated box must be addressed to for a given country. */
export async function localTeamForCountry(country: string): Promise<LocalTeam | null> {
  const result = await query<{ id: string; nombre: string; ciudad: string | null; pais: string | null }>(
    "SELECT id::text, nombre, ciudad, pais FROM equipos_locales WHERE lower(pais) = lower($1) ORDER BY created_at LIMIT 1",
    [country]
  )
  const row = result.rows[0]
  return row ? { id: row.id, name: row.nombre, city: row.ciudad || undefined, country: row.pais || DEFAULT_COUNTRY.name } : null
}
