import { describe, expect, it } from "vitest"
import { assertRange, parseHour } from "@/lib/store/scheduleStore"

// A slot is a whole hour, and the database enforces that with a CHECK
// constraint. Validating here turns what would surface as a constraint
// violation into a message the admin can act on.
describe("parseHour", () => {
  it("accepts whole hours across the day", () => {
    expect(parseHour("00:00", "Opening time")).toBe("00:00")
    expect(parseHour("09:00", "Opening time")).toBe("09:00")
    expect(parseHour("19:00", "Closing time")).toBe("19:00")
    expect(parseHour("24:00", "Closing time")).toBe("24:00")
  })

  it("rejects part hours", () => {
    expect(() => parseHour("09:30", "Opening time")).toThrow(/whole hour/)
    expect(() => parseHour("09:01", "Opening time")).toThrow(/whole hour/)
  })

  it("rejects hours outside a day", () => {
    expect(() => parseHour("25:00", "Opening time")).toThrow()
    expect(() => parseHour("-1:00", "Opening time")).toThrow()
  })

  it("rejects values that are not an hour string at all", () => {
    expect(() => parseHour("", "Opening time")).toThrow()
    expect(() => parseHour("9:00", "Opening time")).toThrow() // unpadded
    expect(() => parseHour(900, "Opening time")).toThrow()
    expect(() => parseHour(null, "Opening time")).toThrow()
  })

  it("names the offending field so the admin knows which input to fix", () => {
    expect(() => parseHour("09:30", "Closing time")).toThrow(/^Closing time/)
  })
})

describe("assertRange", () => {
  it("accepts a closing time after the opening time", () => {
    expect(() => assertRange("09:00", "19:00")).not.toThrow()
    expect(() => assertRange("09:00", "10:00")).not.toThrow()
  })

  // Either would generate a day with no slots, or a negative range.
  it("rejects a closing time equal to or before the opening time", () => {
    expect(() => assertRange("09:00", "09:00")).toThrow(/later than/)
    expect(() => assertRange("19:00", "09:00")).toThrow(/later than/)
  })
})
