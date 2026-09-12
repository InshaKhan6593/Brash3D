import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, requireStaff } from "@/lib/auth"
import { transaction } from "@/lib/db"
import { listSessions } from "@/lib/store/sessionStore"
import { getLocalTeam, listBoxManifests } from "@/lib/store/shippingStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function GETHandler() {
  const staff = await requireStaff(["admin", "local_team"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // A local-team account sees only the boxes addressed to its own team, and the
  // deliveries inside them. An admin oversees every destination. With one team
  // the two are the same set; with a second country they are not, and the
  // difference is one team reading another country's customer addresses and
  // phone numbers.
  const scopedTeamId = staff.role === "local_team" ? staff.localTeamId : undefined
  const [sessions, boxes, team] = await Promise.all([
    listSessions(),
    listBoxManifests(undefined, scopedTeamId),
    scopedTeamId ? getLocalTeam(scopedTeamId) : Promise.resolve(null),
  ])
  const visibleBoxes = boxes.filter((box) => box.status === "enviada" || box.status === "recibida")
  const visibleBoxIds = new Set(visibleBoxes.map((box) => box.id))
  return NextResponse.json({
    team,
    deliveries: sessions.filter((session) => session.estado === "completada"
      && session.montoPagadoInicial > 0
      && (session.envio?.estado === "recibido_equipo_local" || session.envio?.estado === "entregado")
      && (!scopedTeamId || (session.envio?.cajaId ? visibleBoxIds.has(session.envio.cajaId) : false))),
    boxes: visibleBoxes,
    incomingBoxes: visibleBoxes.filter((box) => box.status === "enviada"),
    receivedBoxes: visibleBoxes.filter((box) => box.status === "recibida"),
  })
}

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  const staff = await requireStaff(["admin", "local_team"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await readJsonBody(request)
  if (!body) return invalidBody()

  if (body.action === "receiveBox") {
    const boxId = typeof body.boxId === "string" ? body.boxId : ""
    const received = await transaction(async (client) => {
      const result = await client.query("UPDATE cajas_consolidadas SET estado='recibida', recibida_at=COALESCE(recibida_at,now()) WHERE id::text=$1 AND estado='enviada'", [boxId])
      if (!result.rowCount) return false
      await client.query("UPDATE envios SET estado='recibido_equipo_local' WHERE caja_id::text=$1 AND estado='en_transito'", [boxId])
      return true
    })
    return received ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Box is not awaiting receipt" }, { status: 409 })
  }

  if (body.action === "recordOfflinePayment") {
    const method = body.method === "efectivo" ? "efectivo" : body.method === "transferencia" ? "transferencia" : null
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
    if (!method) return NextResponse.json({ error: "Invalid payment method" }, { status: 400 })
    const completed = await transaction(async (client) => {
      const result = await client.query<{ amount: string }>(`
        UPDATE sesiones_compra sc
        SET monto_pagado_final = round(sc.total - round(sc.total * sc.porcentaje_inicial / 100, 2), 2)
        FROM envios e WHERE sc.id::text=$1 AND e.sesion_id=sc.id
          AND e.estado='recibido_equipo_local' AND sc.monto_pagado_inicial>0 AND sc.monto_pagado_final=0
          AND sc.porcentaje_inicial < 100
        RETURNING round(sc.total - round(sc.total * sc.porcentaje_inicial / 100, 2), 2)::text AS amount
      `, [sessionId])
      if (!result.rows[0]) return false
      await client.query(`UPDATE envios SET estado='entregado', metodo_pago_recibido=$2, asignacion_pago_final='fondo_local_colombia', monto_fondo_local=$3, fecha_entrega_real=now() WHERE sesion_id=$1::uuid`, [sessionId, method, result.rows[0].amount])
      await client.query(`INSERT INTO payment_logs(payment_intent_id,sesion_id,monto,tipo_pago,estado,metadata) VALUES($1,$2::uuid,$3,'session_final','succeeded',$4::jsonb)`, [`offline_${crypto.randomUUID()}`, sessionId, result.rows[0].amount, JSON.stringify({ method, recordedBy: staff.id })])
      return true
    })
    return completed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Delivery is not ready for final payment" }, { status: 409 })
  }

  if (body.action === "confirmDeliveryWithoutBalance") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
    const confirmed = await transaction(async (client) => {
      // Guarded on porcentaje_inicial = 100 so this can never close an order
      // that still owes money.
      const result = await client.query(`
        UPDATE envios e SET estado='entregado', fecha_entrega_real=now()
        FROM sesiones_compra sc
        WHERE e.sesion_id=sc.id AND sc.id::text=$1
          AND e.estado='recibido_equipo_local'
          AND sc.monto_pagado_inicial > 0
          AND sc.porcentaje_inicial >= 100
      `, [sessionId])
      return Boolean(result.rowCount)
    })
    return confirmed
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: "This delivery still has a balance to collect" }, { status: 409 })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}

export const GET = withErrorHandling("GET local-team", GETHandler)
export const POST = withErrorHandling("POST local-team", POSTHandler)
