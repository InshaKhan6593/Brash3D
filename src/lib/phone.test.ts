import { describe, expect, it } from "vitest"
import { DEFAULT_COUNTRY } from "@/lib/countries"
import { isSendable, toE164 } from "@/lib/phone"

const CO = DEFAULT_COUNTRY

describe("normalising a customer's WhatsApp number", () => {
  // The case that made a real production booking arrive with no message: the
  // number was stored exactly as typed, and Meta was handed something that is
  // not a number anywhere.
  it("puts the country code in front of a Colombian mobile typed the local way", () => {
    expect(toE164("300 123 4567", CO)).toBe("573001234567")
    expect(toE164("3001234567", CO)).toBe("573001234567")
  })

  it("drops the trunk prefix, which exists only for dialling inside the country", () => {
    expect(toE164("0300 123 4567", CO)).toBe("573001234567")
  })

  it("accepts a number already written internationally, however it is punctuated", () => {
    expect(toE164("+57 300 123 4567", CO)).toBe("573001234567")
    expect(toE164("+57-300-123-4567", CO)).toBe("573001234567")
    expect(toE164("(+57) 300 1234567", CO)).toBe("573001234567")
    expect(toE164("573001234567", CO)).toBe("573001234567")
    expect(toE164("0057 300 123 4567", CO)).toBe("573001234567")
  })

  // A customer outside the destination country states their own country code,
  // and it is taken at face value. This is the path a tester on a foreign
  // handset has to use, and the only input that carries no ambiguity.
  it("takes a foreign number at face value when it carries a country code", () => {
    expect(toE164("+92 324 145 2724", CO)).toBe("923241452724")
    expect(toE164("+1 305 555 0142", CO)).toBe("13055550142")
  })

  // The refusals matter more than the conversions. Prefixing a dial code onto
  // something that merely looks national is how an order link reaches a
  // stranger holding that number somewhere else.
  it("refuses a number it cannot resolve rather than guessing one", () => {
    expect(toE164("", CO)).toBeNull()
    expect(toE164("   ", CO)).toBeNull()
    expect(toE164("no tengo", CO)).toBeNull()
    expect(toE164("12345", CO)).toBeNull()
    // Ten digits, but not a mobile: Colombian landlines begin 60 and no
    // WhatsApp message will ever arrive at one.
    expect(toE164("6012345678", CO)).toBeNull()
    // Right shape, wrong length.
    expect(toE164("30012345678", CO)).toBeNull()
    expect(toE164("300123456", CO)).toBeNull()
  })

  it("refuses an international number that is too long to be one", () => {
    expect(toE164("+5730012345678901234", CO)).toBeNull()
    expect(toE164("+1234", CO)).toBeNull()
  })
})

describe("the guard in front of Meta", () => {
  // Bookings taken before normalisation existed still hold whatever was typed.
  it("rejects a national number that would reach nobody", () => {
    expect(isSendable("03241452724")).toBe(false)
    expect(isSendable("12345")).toBe(false)
    expect(isSendable("")).toBe(false)
  })

  it("passes a normalised number", () => {
    expect(isSendable("573001234567")).toBe(true)
    expect(isSendable("923241452724")).toBe(true)
  })
})
