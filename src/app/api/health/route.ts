import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function GETHandler() {
  try {
    await query("SELECT 1")
    return NextResponse.json({ status: "ok", database: "connected" })
  } catch {
    return NextResponse.json(
      { status: "error", database: "unavailable" },
      { status: 503 }
    )
  }
}

export const GET = withErrorHandling("GET health", GETHandler)
