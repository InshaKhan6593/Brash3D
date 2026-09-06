import { NextResponse } from "next/server"
import {
  createSession,
  getSession,
  listSessions,
  addProductToSession,
  updateProductQuantity,
  removeProductFromSession,
  closeSession,
  simulatePayment
} from "@/lib/store/sessionStore"
import { Vendedor, Cliente } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = await request.json()
  const { action, ...data } = body

  if (action === "create") {
    const vendedor: Vendedor = {
      id: `ven-${Date.now()}`,
      nombre: data.vendedorNombre || "Maria Garcia",
      email: data.vendedorEmail || "maria@brash3d.com",
      tiendaAsignada: data.tienda,
    }

    const cliente: Cliente = {
      id: data.clienteId || `cli-${Date.now()}`,
      nombre: data.clienteNombre || "Customer",
      email: data.clienteEmail || "",
      telefono: data.clienteTelefono || "",
      pais: "Colombia",
    }

    const session = createSession(data.reservaId || `res-${Date.now()}`, vendedor, cliente)
    return NextResponse.json({ session })
  }

  if (action === "addProduct") {
    if (!data.sessionId || !data.nombre?.trim() || !Number.isFinite(Number(data.precio)) || Number(data.precio) <= 0) {
      return NextResponse.json({ error: "A valid session, product name, and price are required" }, { status: 400 })
    }

    const session = addProductToSession(data.sessionId, {
      nombre: data.nombre.trim(),
      sku: data.sku,
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

  if (action === "updateQuantity") {
    const session = updateProductQuantity(data.sessionId, data.productId, data.delta)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "removeProduct") {
    const session = removeProductFromSession(data.sessionId, data.productId)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "close") {
    const session = closeSession(data.sessionId)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "simulatePayment") {
    const success = simulatePayment(data.sessionId, data.amount)

    if (!success) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const session = getSession(data.sessionId)
    return NextResponse.json({ success: true, session })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ sessions: listSessions() })
  }

  const session = getSession(id)

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  return NextResponse.json({ session })
}
