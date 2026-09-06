import { NextResponse } from "next/server"
import {
  createBooking,
  createSessionForBooking,
  getBooking,
} from "@/lib/store/sessionStore"
import { Cliente } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = await request.json()

  if (!body.nombre?.trim() || !body.email?.trim() || !body.telefono?.trim() || !body.slotId) {
    return NextResponse.json(
      { error: "Name, email, phone, and time slot are required" },
      { status: 400 }
    )
  }

  const cliente: Cliente = {
    id: `cli-${Date.now()}`,
    nombre: body.nombre.trim(),
    email: body.email.trim(),
    telefono: body.telefono.trim(),
    ciudad: body.ciudad?.trim(),
    pais: body.pais || "Colombia",
  }

  try {
    const booking = createBooking(cliente, body.slotId)
    const session = createSessionForBooking(booking, body.slotId)

    return NextResponse.json({ booking, session }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_NOT_AVAILABLE") {
      return NextResponse.json(
        { error: "That time slot is no longer available" },
        { status: 409 }
      )
    }
    throw error
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "Missing booking ID" }, { status: 400 })
  }

  const booking = getBooking(id)

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 })
  }

  return NextResponse.json({ booking })
}
