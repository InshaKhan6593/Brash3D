import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { requireStaff, verifyCustomerAccess } from "@/lib/auth"
import { getCustomerIdForSession, getCustomerPurchaseHistory } from "@/lib/store/sessionStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function GETHandler(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get("sessionId")
  const requestedCustomerId = searchParams.get("customerId")

  if (sessionId) {
    if (!await verifyCustomerAccess(sessionId, null)) {
      return NextResponse.json({ error: "History not found" }, { status: 404 })
    }
    const customerId = await getCustomerIdForSession(sessionId)
    if (!customerId) return NextResponse.json({ error: "History not found" }, { status: 404 })
    const history = await getCustomerPurchaseHistory(customerId)
    if (!history) return NextResponse.json({ error: "History not found" }, { status: 404 })
    return NextResponse.json({ history })
  }

  if (!requestedCustomerId) {
    return NextResponse.json({ error: "Missing session or customer ID" }, { status: 400 })
  }
  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (staff.role === "seller" && !staff.sellerId) {
    return NextResponse.json({ error: "Seller account is not assigned to an outlet" }, { status: 403 })
  }

  const history = await getCustomerPurchaseHistory(
    requestedCustomerId,
    staff.role === "seller" ? staff.sellerId : undefined
  )
  if (!history) return NextResponse.json({ error: "History not found" }, { status: 404 })
  return NextResponse.json({ history })
}

export const GET = withErrorHandling("GET customer-history", GETHandler)
