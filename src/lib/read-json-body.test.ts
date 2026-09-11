import { describe, expect, it } from "vitest"
import { readJsonBody } from "@/lib/api"

function post(body: string): Request {
  return new Request("https://example.test/api/anything", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
}

/**
 * Every route used to hand-roll `try { await request.json() } catch { 400 }`.
 * That only catches a *parse* failure — and `null`, `true`, `123` and `"str"`
 * are all valid JSON, so parsing succeeded and the next property access threw
 * a TypeError. Three routes answered 500 to a one-byte body, including the
 * public booking endpoint and the customer payment endpoint.
 *
 * This helper is what the routes use now, so these are the cases that must
 * never reach handler code as anything but null.
 */
describe("readJsonBody", () => {
  it("returns the object for a normal JSON body", async () => {
    expect(await readJsonBody(post('{"action":"saveWeek","id":3}'))).toEqual({ action: "saveWeek", id: 3 })
  })

  it("accepts an empty object", async () => {
    expect(await readJsonBody(post("{}"))).toEqual({})
  })

  // The regression: each of these parses cleanly and is not an object.
  it("rejects JSON that parses but is not an object", async () => {
    for (const body of ["null", "true", "false", "123", "0", '"str"', '""']) {
      expect(await readJsonBody(post(body))).toBeNull()
    }
  })

  // An array has properties, so `body.action` would be undefined rather than
  // throwing — but it is still not a request body any handler expects.
  it("rejects an array", async () => {
    expect(await readJsonBody(post("[]"))).toBeNull()
    expect(await readJsonBody(post('[{"action":"saveWeek"}]'))).toBeNull()
  })

  it("rejects malformed JSON", async () => {
    for (const body of ["not json", '{"a":', "{,}", ""]) {
      expect(await readJsonBody(post(body))).toBeNull()
    }
  })

  it("never throws, whatever the body", async () => {
    const bodies = ["null", "[]", "not json", "", '"x"', "{}", "1e400", '{"a":"\\ud800"}']
    for (const body of bodies) {
      await expect(readJsonBody(post(body))).resolves.not.toThrow()
    }
  })
})
