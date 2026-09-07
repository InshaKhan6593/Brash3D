import "server-only"

import type { QueryResultRow } from "pg"
import { query } from "@/lib/db"
import { listSessions } from "@/lib/store/sessionStore"
import type { ConsolidatedBoxManifest } from "@/lib/types"

interface BoxRow extends QueryResultRow {
  id: string
  numero_caja: string
  pais: string
  courier: string | null
  numero_guia: string | null
  estado: string
  created_at: Date
  recibida_at: Date | null
}

export async function listBoxManifests(sellerId?: string): Promise<ConsolidatedBoxManifest[]> {
  const [sessions, boxes] = await Promise.all([
    listSessions(),
    query<BoxRow>(`
      SELECT id::text, numero_caja, pais, courier, numero_guia, estado, created_at, recibida_at
      FROM cajas_consolidadas ORDER BY created_at DESC LIMIT 30
    `),
  ])
  const visibleSessions = sellerId ? sessions.filter((session) => session.vendedorId === sellerId) : sessions

  return boxes.rows.map((box) => {
    const packages = visibleSessions
      .filter((session) => session.envio?.cajaId === box.id)
      .map((session) => ({
        sessionId: session.id,
        labelCode: session.envio?.labelCode || "",
        customerName: session.cliente.nombre,
        phone: session.cliente.telefono,
        deliveryAddress: session.envio?.deliveryAddress || session.deliveryAddress || "",
        deliveryCity: session.envio?.deliveryCity || session.deliveryCity || "",
        remainingBalance: Math.max(0, session.total * 0.35 - session.montoPagado35),
        products: session.productos.map((product) => ({ name: product.nombre, quantity: product.cantidad, price: product.precio })),
      }))
    return {
      id: box.id,
      number: box.numero_caja,
      country: box.pais,
      courier: box.courier || undefined,
      trackingNumber: box.numero_guia || undefined,
      status: box.estado,
      createdAt: new Date(box.created_at),
      receivedAt: box.recibida_at ? new Date(box.recibida_at) : undefined,
      customerCount: packages.length,
      productLines: packages.reduce((sum, item) => sum + item.products.length, 0),
      totalUnits: packages.reduce((sum, item) => sum + item.products.reduce((units, product) => units + product.quantity, 0), 0),
      packages,
    }
  }).filter((box) => !sellerId || box.packages.length > 0)
}
