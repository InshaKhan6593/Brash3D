import { describe, expect, it } from "vitest"
import { returnPathFor } from "@/lib/login-return"

describe("where a staff member lands after signing in", () => {
  it("returns a seller to the live session the email linked to", () => {
    expect(returnPathFor("seller", "/seller?sessionId=abc")).toBe("/seller?sessionId=abc")
  })

  it("falls back to the role's home without a destination", () => {
    expect(returnPathFor("seller", undefined)).toBe("/seller")
    expect(returnPathFor("local_team", undefined)).toBe("/local-team")
  })

  it("never sends anyone off the site", () => {
    for (const next of ["https://evil.example", "//evil.example/seller", "/\\evil.example", "javascript:alert(1)"]) {
      expect(returnPathFor("admin", next)).toBe("/seller")
    }
  })

  it("only opens a screen the role may use", () => {
    expect(returnPathFor("local_team", "/seller?sessionId=abc")).toBe("/local-team")
    expect(returnPathFor("seller", "/local-team")).toBe("/seller")
    expect(returnPathFor("admin", "/local-team")).toBe("/local-team")
    expect(returnPathFor("seller", "/api/sessions")).toBe("/seller")
  })
})
