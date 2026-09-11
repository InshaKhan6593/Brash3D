import { describe, expect, it } from "vitest"
import { bearerTokenMatches } from "@/lib/api"

function request(authorization?: string): Request {
  return new Request("https://example.test/api/maintenance", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  })
}

describe("bearerTokenMatches", () => {
  it("accepts the matching token", () => {
    expect(bearerTokenMatches(request("Bearer s3cret-value"), "s3cret-value")).toBe(true)
  })

  it("rejects a different token of the same length", () => {
    expect(bearerTokenMatches(request("Bearer s3cret-valve"), "s3cret-value")).toBe(false)
  })

  // timingSafeEqual throws on differing lengths, which would surface as a 500
  // on the guarded route instead of a 401.
  it("rejects a shorter and a longer token without throwing", () => {
    expect(bearerTokenMatches(request("Bearer short"), "s3cret-value")).toBe(false)
    expect(bearerTokenMatches(request("Bearer s3cret-value-and-more"), "s3cret-value")).toBe(false)
  })

  it("rejects a missing header", () => {
    expect(bearerTokenMatches(request(), "s3cret-value")).toBe(false)
  })

  it("rejects the right token sent without the Bearer scheme", () => {
    expect(bearerTokenMatches(request("s3cret-value"), "s3cret-value")).toBe(false)
  })

  it("rejects an empty token", () => {
    expect(bearerTokenMatches(request("Bearer "), "s3cret-value")).toBe(false)
  })

  // A forgotten environment variable must leave the route closed, never open.
  it("never matches when no secret is configured", () => {
    expect(bearerTokenMatches(request("Bearer anything"), undefined)).toBe(false)
    expect(bearerTokenMatches(request("Bearer anything"), "")).toBe(false)
    expect(bearerTokenMatches(request("Bearer "), "")).toBe(false)
  })
})
