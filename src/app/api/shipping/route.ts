import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, requireStaff } from "@/lib/auth"
import { transaction } from "@/lib/db"
import { listBoxManifests } from "@/lib/store/shippingStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function GETHandler() {
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (staff.role === "seller" && !staff.sellerId) return NextResponse.json({ error: "Seller account is not linked" }, { status: 403 })
  return NextResponse.json({ boxes: await listBoxManifests(staff.role === "seller" ? staff.sellerId : undefined) })
}

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (staff.role === "seller" && !staff.sellerId) return NextResponse.json({ error: "Seller account is not linked" }, { status: 403 })

  const body = await readJsonBody(request)
  if (!body) return invalidBody()
  const action = typeof body.action === "string" ? body.action : "createBox"
  const shipmentIds = Array.isArray(body.shipmentIds)
    ? [...new Set(body.shipmentIds.filter((id): id is string => typeof id === "string"))]
    : []
  const boxId = typeof body.boxId === "string" ? body.boxId.trim() : ""
  const courier = typeof body.courier === "string" ? body.courier.trim() : ""
  const tracking = typeof body.tracking === "string" ? body.tracking.trim() : ""

  try {
    if (action === "createBox") {
      if (!shipmentIds.length || !courier || !tracking || courier.length > 255 || tracking.length > 100) {
        return NextResponse.json({ error: "Courier, tracking number, and at least one shipment are required" }, { status: 400 })
      }
      const box = await transaction(async (client) => {
        const number = `BR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
        const inserted = await client.query<{ id: string }>(`
          INSERT INTO cajas_consolidadas(equipo_local_id,numero_caja,pais,courier,numero_guia,estado)
          VALUES('20000000-0000-4000-8000-000000000001',$1,'Colombia',$2,$3,'pendiente') RETURNING id::text
        `, [number, courier, tracking])
        const sellerRestriction = staff.role === "seller" ? "AND sc.vendedor_id = $5::uuid" : ""
        const parameters = staff.role === "seller"
          ? [inserted.rows[0].id, shipmentIds, tracking, courier, staff.sellerId]
          : [inserted.rows[0].id, shipmentIds, tracking, courier]
        const updated = await client.query(`
          UPDATE envios e SET caja_id=$1::uuid, tracking_number=$3, transportadora=$4
          FROM sesiones_compra sc
          WHERE e.sesion_id=sc.id AND e.id=ANY($2::uuid[])
            AND e.estado='preparacion' AND e.caja_id IS NULL ${sellerRestriction}
        `, parameters)
        if (updated.rowCount !== shipmentIds.length) throw new Error("SHIPMENT_SELECTION_CHANGED")
        return { id: inserted.rows[0].id, number }
      })
      return NextResponse.json({ box })
    }

    if (action === "assignShipments") {
      if (!boxId || !shipmentIds.length) return NextResponse.json({ error: "A box and at least one shipment are required" }, { status: 400 })
      const box = await transaction(async (client) => {
        const sellerBoxRestriction = staff.role === "seller"
          ? `AND EXISTS (
              SELECT 1 FROM envios owned_envios
              JOIN sesiones_compra owned_sessions ON owned_sessions.id=owned_envios.sesion_id
              WHERE owned_envios.caja_id=cc.id AND owned_sessions.vendedor_id=$2::uuid
            )`
          : ""
        const boxParameters = staff.role === "seller" ? [boxId, staff.sellerId] : [boxId]
        const existing = await client.query<{ id: string; tracking: string | null; courier: string | null }>(`
          SELECT cc.id::text, cc.numero_guia AS tracking, cc.courier
          FROM cajas_consolidadas cc
          WHERE cc.id::text=$1 AND cc.estado='pendiente' ${sellerBoxRestriction}
          FOR UPDATE
        `, boxParameters)
        if (!existing.rowCount) throw new Error("BOX_UNAVAILABLE")
        const updated = await client.query(`
          UPDATE envios e SET caja_id=$1::uuid, tracking_number=$3, transportadora=$4
          FROM sesiones_compra sc
          WHERE e.sesion_id=sc.id AND e.id=ANY($2::uuid[])
            AND e.estado='preparacion' AND e.caja_id IS NULL
            ${staff.role === "seller" ? "AND sc.vendedor_id = $5::uuid" : ""}
        `, staff.role === "seller"
          ? [boxId, shipmentIds, existing.rows[0].tracking, existing.rows[0].courier, staff.sellerId]
          : [boxId, shipmentIds, existing.rows[0].tracking, existing.rows[0].courier])
        if (updated.rowCount !== shipmentIds.length) throw new Error("SHIPMENT_SELECTION_CHANGED")
        return { id: existing.rows[0].id }
      })
      return NextResponse.json({ box })
    }

    if (action === "dispatchBox") {
      if (!boxId) return NextResponse.json({ error: "A dispatch box is required" }, { status: 400 })
      const box = await transaction(async (client) => {
        const sellerBoxRestriction = staff.role === "seller"
          ? `AND EXISTS (
              SELECT 1 FROM envios owned_envios
              JOIN sesiones_compra owned_sessions ON owned_sessions.id=owned_envios.sesion_id
              WHERE owned_envios.caja_id=cc.id AND owned_sessions.vendedor_id=$2::uuid
            )`
          : ""
        const boxParameters = staff.role === "seller" ? [boxId, staff.sellerId] : [boxId]
        const existing = await client.query<{ id: string }>(`
          SELECT cc.id::text
          FROM cajas_consolidadas cc
          WHERE cc.id::text=$1 AND cc.estado='pendiente' ${sellerBoxRestriction}
          FOR UPDATE
        `, boxParameters)
        if (!existing.rowCount) throw new Error("BOX_UNAVAILABLE")
        const shipmentCount = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM envios WHERE caja_id=$1::uuid AND estado='preparacion'", [boxId])
        if (Number(shipmentCount.rows[0].count) === 0) throw new Error("BOX_UNAVAILABLE")
        await client.query("UPDATE cajas_consolidadas SET estado='enviada', fecha_empaquetado=COALESCE(fecha_empaquetado,now()) WHERE id=$1::uuid", [boxId])
        await client.query("UPDATE envios SET estado='en_transito', fecha_envio=COALESCE(fecha_envio,now()) WHERE caja_id=$1::uuid AND estado='preparacion'", [boxId])
        return { id: boxId }
      })
      return NextResponse.json({ box })
    }

    return NextResponse.json({ error: "Unsupported shipping action" }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message === "SHIPMENT_SELECTION_CHANGED") {
      return NextResponse.json({ error: "One or more shipments are unavailable or not assigned to this seller" }, { status: 409 })
    }
    if (error instanceof Error && error.message === "BOX_UNAVAILABLE") {
      return NextResponse.json({ error: "This box is unavailable, already shipped, or not assigned to this seller" }, { status: 409 })
    }
    throw error
  }
}

export const GET = withErrorHandling("GET shipping", GETHandler)
export const POST = withErrorHandling("POST shipping", POSTHandler)
