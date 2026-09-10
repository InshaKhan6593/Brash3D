import "server-only"

import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>

/**
 * Wraps a route handler so an unexpected throw is logged with its stack and
 * answered with a generic 500, instead of surfacing as an opaque failure that
 * nobody finds out about.
 */
export function withErrorHandling<A extends unknown[]>(
  name: string,
  handler: Handler<A>
): Handler<A> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (error) {
      logger.error(`${name} failed`, { route: name, error })
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      )
    }
  }
}

/**
 * Reads a JSON body without letting a malformed payload become a 500. Returns
 * null when the body is unusable; the caller answers with its own 400.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

export function invalidBody(): NextResponse {
  return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
}
