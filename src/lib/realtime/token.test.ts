import { decodeJwt, jwtVerify } from "jose"
import { afterEach, describe, expect, it } from "vitest"
import { SESSION_CLAIM } from "@/lib/realtime/config"
import { mintRealtimeToken } from "@/lib/realtime/token"

const SECRET = "test-jwt-secret-long-enough-for-hs256-signing"
const SESSION = "9f2b7c10-0000-4000-8000-000000000001"

afterEach(() => {
  delete process.env.SUPABASE_JWT_SECRET
})

describe("realtime token", () => {
  it("returns null when no secret is configured", async () => {
    // The property the live deployment depends on: Realtime is optional, and
    // an unset or removed secret must degrade to polling rather than throw on
    // the customer's order page.
    expect(await mintRealtimeToken(SESSION)).toBeNull()
  })

  it("scopes the token to exactly one session", async () => {
    // The claim is the whole security boundary. A subscription filter is
    // chosen by the browser; this is not.
    process.env.SUPABASE_JWT_SECRET = SECRET
    const minted = await mintRealtimeToken(SESSION)

    const claims = decodeJwt(minted!.token)
    expect(claims[SESSION_CLAIM]).toBe(SESSION)
    expect(claims.role).toBe("authenticated")
  })

  it("signs with the project secret, so a forged token will not verify", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const minted = await mintRealtimeToken(SESSION)
    const encode = (value: string) => new TextEncoder().encode(value)

    await expect(jwtVerify(minted!.token, encode(SECRET))).resolves.toBeTruthy()
    await expect(jwtVerify(minted!.token, encode("a-different-secret-entirely"))).rejects.toThrow()
  })

  it("expires, so a leaked token stops working", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const minted = await mintRealtimeToken(SESSION)

    const claims = decodeJwt(minted!.token)
    const lifetime = (claims.exp ?? 0) - (claims.iat ?? 0)
    expect(lifetime).toBe(minted!.expiresIn)
    expect(lifetime).toBeGreaterThan(0)
    expect(lifetime).toBeLessThanOrEqual(60 * 60)
  })

  it("carries the audience Supabase expects", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const claims = decodeJwt((await mintRealtimeToken(SESSION))!.token)
    expect(claims.aud).toBe("authenticated")
    expect(claims.sub).toBe(SESSION)
  })
})
