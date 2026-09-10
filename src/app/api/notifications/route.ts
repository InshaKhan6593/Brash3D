import { NextResponse } from "next/server"
import { invalidBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, requireStaff } from "@/lib/auth"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function GETHandler() {
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await query<{
    id: string
    title: string
    message: string
    reservation_id: string | null
    read_at: Date | null
    created_at: Date
  }>(`
    SELECT id::text, title, message, reserva_id::text AS reservation_id,
      read_at, created_at
    FROM staff_notifications
    WHERE ($1::uuid IS NULL OR seller_id = $1::uuid)
    ORDER BY created_at DESC
    LIMIT 20
  `, [staff.role === "seller" ? staff.sellerId : null])

  return NextResponse.json({
    notifications: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      message: row.message,
      reservationId: row.reservation_id,
      read: Boolean(row.read_at),
      createdAt: row.created_at,
    })),
  })
}

async function PATCHHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  let body
  try {
    body = await request.json()
  } catch {
    return invalidBody()
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Missing notification ID" }, { status: 400 })
  }

  const result = await query(`
    UPDATE staff_notifications
    SET read_at = COALESCE(read_at, now())
    WHERE id::text = $1
      AND ($2::uuid IS NULL OR seller_id = $2::uuid)
  `, [body.id, staff.role === "seller" ? staff.sellerId : null])
  if (!result.rowCount) return NextResponse.json({ error: "Notification not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}

async function DELETEHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { id?: unknown; all?: unknown }
  const sellerId = staff.role === "seller" ? staff.sellerId : null

  if (typeof body.id === "string" && body.id) {
    const result = await query(`
      DELETE FROM staff_notifications
      WHERE id::text = $1
        AND ($2::uuid IS NULL OR seller_id = $2::uuid)
    `, [body.id, sellerId])
    if (!result.rowCount) return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    return NextResponse.json({ success: true, cleared: 1 })
  }

  if (body.all !== true) {
    return NextResponse.json({ error: "Provide a notification ID or set all to true" }, { status: 400 })
  }

  const result = await query(`
    DELETE FROM staff_notifications
    WHERE ($1::uuid IS NULL OR seller_id = $1::uuid)
  `, [sellerId])
  return NextResponse.json({ success: true, cleared: result.rowCount || 0 })
}

export const GET = withErrorHandling("GET notifications", GETHandler)
export const PATCH = withErrorHandling("PATCH notifications", PATCHHandler)
export const DELETE = withErrorHandling("DELETE notifications", DELETEHandler)
