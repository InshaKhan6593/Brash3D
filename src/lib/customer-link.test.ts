import { describe, expect, it } from "vitest"
import {
  CUSTOMER_ACCESS_PARAM,
  customerSessionPath,
  customerSessionUrl,
} from "@/lib/customer-link"

const SESSION = "9f2b7c10-0000-4000-8000-000000000001"
const TOKEN = "Yl8tdG9rZW4tZXhhbXBsZQ"

describe("customer session link", () => {
  it("carries the access token, which is what makes the link portable", () => {
    // The whole point: the customer's URL has to keep working in a browser
    // that holds no cookie -- a second device, or the same one a week later
    // after site data was cleared.
    expect(customerSessionPath(SESSION, TOKEN)).toBe(
      `/session/${SESSION}?${CUSTOMER_ACCESS_PARAM}=${TOKEN}`
    )
  })

  it("omits the query entirely when there is no token", () => {
    expect(customerSessionPath(SESSION)).toBe(`/session/${SESSION}`)
    expect(customerSessionPath(SESSION, null)).toBe(`/session/${SESSION}`)
  })

  it("starts extra params with ? when no token precedes them", () => {
    // Regression guard. Stripe's return URLs were built by appending
    // `&payment=processing` to this helper's output. With a token that reads
    // correctly; without one -- the final charge, which the Colombia team
    // opens and which carries no customer token -- it produced
    // `/session/<id>&payment=processing`: an ampersand inside the path, no
    // query at all, and a page that could not see its own payment state.
    const path = customerSessionPath(SESSION, null, { payment: "processing" })
    expect(path).toBe(`/session/${SESSION}?payment=processing`)
    expect(path).not.toContain("&payment")
  })

  it("joins a token and extra params with a single ampersand", () => {
    expect(customerSessionPath(SESSION, TOKEN, { payment: "cancelled" })).toBe(
      `/session/${SESSION}?${CUSTOMER_ACCESS_PARAM}=${TOKEN}&payment=cancelled`
    )
  })

  it("escapes a token so a URL-unsafe character cannot end the query", () => {
    const path = customerSessionPath(SESSION, "a+b/c=d&payment=paid")
    expect(path).toContain("a%2Bb%2Fc%3Dd%26payment%3Dpaid")
    // The forged parameter must not survive as a real one.
    expect(path.split("&")).toHaveLength(1)
  })

  it("resolves against the serving origin for Stripe and the seller's copy", () => {
    expect(customerSessionUrl("https://brash3-d.vercel.app", SESSION, TOKEN)).toBe(
      `https://brash3-d.vercel.app/session/${SESSION}?${CUSTOMER_ACCESS_PARAM}=${TOKEN}`
    )
  })
})
