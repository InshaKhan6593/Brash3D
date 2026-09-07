import { NextResponse } from "next/server"
import { requestHasSameOrigin, requireStaff } from "@/lib/auth"
import { transaction } from "@/lib/db"
import { listBoxManifests } from "@/lib/store/shippingStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (staff.role === "seller" && !staff.sellerId) return NextResponse.json({ error: "Seller account is not linked" }, { status: 403 })
  return NextResponse.json({ boxes: await listBoxManifests(staff.role === "seller" ? staff.sellerId : undefined) })
}

export async function POST(request: Request) {
  if (!requestHasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (staff.role === "seller" && !staff.sellerId) return NextResponse.json({ error: "Seller account is not linked" }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const shipmentIds = Array.isArray(body.shipmentIds)
    ? [...new Set(body.shipmentIds.filter((id): id is string => typeof id === "string"))]
    : []
  const courier = typeof body.courier === "string" ? body.courier.trim() : ""
  const tracking = typeof body.tracking === "string" ? body.tracking.trim() : ""
  if (!shipmentIds.length || !courier || !tracking || courier.length > 255 || tracking.length > 100) {
    return NextResponse.json({ error: "Courier, tracking number, and at least one shipment are required" }, { status: 400 })
  }

  try {
    const box = await transaction(async (client) => {
      const number = `BR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO cajas_consolidadas(equipo_local_id,numero_caja,pais,courier,numero_guia,estado,fecha_empaquetado)
        VALUES('20000000-0000-4000-8000-000000000001',$1,'Colombia',$2,$3,'enviada',now()) RETURNING id::text
      `, [number, courier, tracking])
      const sellerRestriction = staff.role === "seller" ? "AND sc.vendedor_id = $5::uuid" : ""
      const parameters = staff.role === "seller"
        ? [inserted.rows[0].id, shipmentIds, tracking, courier, staff.sellerId]
        : [inserted.rows[0].id, shipmentIds, tracking, courier]
      const updated = await client.query(`
        UPDATE envios e SET caja_id=$1::uuid, estado='en_transito', tracking_number=$3,
          transportadora=$4, fecha_envio=COALESCE(fecha_envio,now())
        FROM sesiones_compra sc
        WHERE e.sesion_id=sc.id AND e.id=ANY($2::uuid[])
          AND e.estado='preparacion' AND e.caja_id IS NULL ${sellerRestriction}
      `, parameters)
      if (updated.rowCount !== shipmentIds.length) throw new Error("SHIPMENT_SELECTION_CHANGED")
      return { id: inserted.rows[0].id, number }
    })
    return NextResponse.json({ box })
  } catch (error) {
    if (error instanceof Error && error.message === "SHIPMENT_SELECTION_CHANGED") {
      return NextResponse.json({ error: "One or more shipments are unavailable or not assigned to this seller" }, { status: 409 })
    }
    throw error
  }
}
