import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, requireStaff } from "@/lib/auth"
import {
  bookingsOutsideSchedule,
  deleteException,
  getSellerSchedule,
  listSellersForSchedule,
  saveException,
  saveWeeklyTemplate,
} from "@/lib/store/scheduleStore"
import { pruneUnscheduledSlots } from "@/lib/store/sessionStore"
import type { WeekdaySchedule } from "@/lib/types"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Opening hours, admin only.
 *
 * A seller could reasonably be trusted to read their own schedule, but changing
 * it moves every customer's bookable slot, so both reads and writes are held to
 * admin here rather than inventing a split the panel does not surface.
 */

/** Resolves the seller whose schedule is being read or edited. */
async function resolveSeller(requested: string | null): Promise<string | null> {
  const sellers = await listSellersForSchedule()
  if (!sellers.length) return null
  if (!requested) return sellers[0].id
  return sellers.some((seller) => seller.id === requested) ? requested : null
}

async function GETHandler(request: Request) {
  const staff = await requireStaff(["admin"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sellers = await listSellersForSchedule()
  const requested = new URL(request.url).searchParams.get("sellerId")
  const sellerId = await resolveSeller(requested)
  if (!sellerId) {
    return NextResponse.json({ sellers, schedule: null, stranded: [] })
  }

  const [schedule, stranded] = await Promise.all([
    getSellerSchedule(sellerId),
    bookingsOutsideSchedule(sellerId),
  ])
  return NextResponse.json({ sellers, schedule, stranded })
}

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const staff = await requireStaff(["admin"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await readJsonBody(request)
  if (!body) return invalidBody()

  const action = typeof body.action === "string" ? body.action : ""
  const sellerId = await resolveSeller(typeof body.sellerId === "string" ? body.sellerId : null)
  if (!sellerId) return NextResponse.json({ error: "No active seller to schedule" }, { status: 400 })

  try {
    if (action === "saveWeek") {
      if (!Array.isArray(body.semana)) {
        return NextResponse.json({ error: "A weekly schedule is required" }, { status: 400 })
      }
      await saveWeeklyTemplate(sellerId, body.semana as WeekdaySchedule[])
    } else if (action === "saveException") {
      await saveException({
        vendedorId: sellerId,
        fecha: typeof body.fecha === "string" ? body.fecha : "",
        abierto: body.abierto === true,
        horaApertura: typeof body.horaApertura === "string" ? body.horaApertura : null,
        horaCierre: typeof body.horaCierre === "string" ? body.horaCierre : null,
        motivo: typeof body.motivo === "string" ? body.motivo : null,
      })
    } else if (action === "deleteException") {
      if (typeof body.id !== "string" || !body.id) {
        return NextResponse.json({ error: "An exception id is required" }, { status: 400 })
      }
      await deleteException(sellerId, body.id)
    } else {
      return NextResponse.json({ error: "Unknown schedule action" }, { status: 400 })
    }
  } catch (error) {
    // Validation in the store throws with a message written for the admin, so
    // it is surfaced rather than swallowed into a generic 500.
    const message = error instanceof Error ? error.message : "Could not save the schedule"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // The schedule just changed, so drop slots it no longer covers. This is the
  // only moment that can happen, which is why the booking page no longer pays
  // for the check on every read.
  await pruneUnscheduledSlots()

  const [schedule, stranded] = await Promise.all([
    getSellerSchedule(sellerId),
    bookingsOutsideSchedule(sellerId),
  ])
  return NextResponse.json({ ok: true, schedule, stranded })
}

export const GET = withErrorHandling("GET schedule", GETHandler)
export const POST = withErrorHandling("POST schedule", POSTHandler)
