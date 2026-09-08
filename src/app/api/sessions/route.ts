import { NextResponse } from "next/server"
import { requestHasSameOrigin, requireStaff, verifyCustomerAccess } from "@/lib/auth"
import {
  getSession,
  listSessions,
  addProductToSession,
  updateProductQuantity,
  removeProductFromSession,
  closeSession,
  reopenSessionForCorrection,
  rotateCustomerAccess,
  startSession,
  updateDeliveryStatus,
} from "@/lib/store/sessionStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const body = await request.json()
  const { action, ...data } = body

  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (action === "createCustomerAccess") {
    const session = await getSession(data.sessionId)
    if (!session || (staff.role === "seller" && session.vendedorId !== staff.sellerId)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
    const accessToken = await rotateCustomerAccess(data.sessionId)
    return NextResponse.json({ accessToken })
  }

  const targetSession = await getSession(data.sessionId)
  if (!targetSession || (staff.role === "seller" && targetSession.vendedorId !== staff.sellerId)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  if (action === "addProduct") {
    if (!data.sessionId || !data.nombre?.trim() || !Number.isFinite(Number(data.precio)) || Number(data.precio) <= 0) {
      return NextResponse.json({ error: "A valid session, product name, and price are required" }, { status: 400 })
    }

    const session = await addProductToSession(data.sessionId, {
      nombre: data.nombre.trim(),
      sku: typeof data.sku === "string" ? data.sku.replace(/^sku[\s:#-]*/i, "").trim() : undefined,
      precio: Number(data.precio),
      cantidad: Math.max(1, Number(data.cantidad) || 1),
      notas: data.notas,
      urlImagen: data.urlImagen,
    })

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "start") {
    const session = await startSession(data.sessionId)
    if (!session) {
      return NextResponse.json(
        { error: "Only a confirmed session that has not started can be started" },
        { status: 409 }
      )
    }
    return NextResponse.json({ session })
  }

  if (action === "updateQuantity") {
    const delta = Number(data.delta)
    if (!Number.isInteger(delta) || Math.abs(delta) !== 1) {
      return NextResponse.json({ error: "Quantity change must be 1 or -1" }, { status: 400 })
    }
    const session = await updateProductQuantity(data.sessionId, data.productId, delta)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "removeProduct") {
    const session = await removeProductFromSession(data.sessionId, data.productId)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "close") {
    const session = await closeSession(data.sessionId)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "reopenForCorrection") {
    if (staff.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can reopen a closed session" }, { status: 403 })
    }
    const session = await reopenSessionForCorrection(data.sessionId, staff.id)
    if (!session) {
      return NextResponse.json({ error: "Only a closed, unpaid session without a shipment or active checkout can be reopened" }, { status: 409 })
    }
    return NextResponse.json({ session })
  }

  if (action === "updateDeliveryStatus") {
    // Per the client workflow, seller/admin creates the individual shipment.
    // USA operations handles consolidation; receipt, delivery, and final payment
    // belong to the Colombia local-team API.
    const allowed = ["preparacion"]
    if (!allowed.includes(data.status)) {
      return NextResponse.json({ error: "Invalid delivery status" }, { status: 400 })
    }
    const session = await updateDeliveryStatus(data.sessionId, data.status)
    if (!session) {
      return NextResponse.json(
        { error: "Complete the current delivery step after the 65% payment is confirmed" },
        { status: 409 }
      )
    }
    return NextResponse.json({ session })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    const staff = await requireStaff(["admin", "seller"])
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sessions = await listSessions()
    return NextResponse.json({
      sessions: staff.role === "seller"
        ? sessions.filter((session) => session.vendedorId === staff.sellerId)
        : sessions,
    })
  }

  const session = await getSession(id)

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const staff = await requireStaff(["admin", "seller"])
  const staffCanAccess = Boolean(
    staff && (staff.role === "admin" || session.vendedorId === staff.sellerId)
  )
  const customerCanAccess = await verifyCustomerAccess(id, searchParams.get("access"))
  if (!staffCanAccess && !customerCanAccess) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  return NextResponse.json({ session })
}
