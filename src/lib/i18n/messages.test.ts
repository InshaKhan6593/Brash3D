import { describe, expect, it } from "vitest"
import { CHECKOUT_ERROR } from "@/lib/checkout-errors"
import { COUNTRIES } from "@/lib/countries"
import { LOCALES } from "@/lib/i18n/locale"
import { MESSAGES } from "@/lib/i18n/messages"

/** Every leaf path in a nested message object, as "a.b.c". */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key)
  )
}

/** The kind of each leaf, so a string never silently replaces a function. */
function shapes(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value !== "object" || value === null) return { [prefix]: typeof value }
  return Object.assign({}, ...Object.entries(value).map(([key, child]) =>
    shapes(child, prefix ? `${prefix}.${key}` : key)
  ))
}

describe("translations", () => {
  it("defines the same keys in every language", () => {
    // A missing key is a crash, not a fallback: the page reads `t.session.x`
    // directly. TypeScript catches this for a literal access, but not for the
    // dynamic ones -- `t.localTeam.filters[value]`, `t.session.payErrors[code]`.
    const spanish = paths(MESSAGES.es).sort()
    for (const locale of LOCALES) {
      expect(paths(MESSAGES[locale]).sort(), `locale ${locale}`).toEqual(spanish)
    }
  })

  it("keeps each entry the same kind in every language", () => {
    // A function in one language and a plain string in the other renders as
    // "function () {...}" on the side that expected to call it.
    const spanish = shapes(MESSAGES.es)
    for (const locale of LOCALES) {
      expect(shapes(MESSAGES[locale]), `locale ${locale}`).toEqual(spanish)
    }
  })

  it("translates every checkout error code the API can send", () => {
    // The page falls back to the server's Spanish sentence for an unknown
    // code, so a gap here is invisible until an English reader hits it.
    for (const code of Object.values(CHECKOUT_ERROR)) {
      for (const locale of LOCALES) {
        const copy = MESSAGES[locale].session.payErrors as Record<string, string>
        expect(copy[code], `${code} in ${locale}`).toBeTypeOf("string")
        expect(copy[code], `${code} in ${locale}`).not.toBe("")
      }
    }
  })

  it("leaves no language without copy for a configured country", () => {
    for (const country of COUNTRIES) {
      for (const locale of LOCALES) {
        expect(country.adjective[locale], `${country.name} adjective`).toBeTruthy()
        if (country.localInvoice) {
          expect(country.localInvoice.reason[locale], `${country.name} invoice reason`).toBeTruthy()
        }
      }
    }
  })

  it("never leaves the Spanish copy identical to the English", () => {
    // Catches an entry pasted into both languages and never translated. The
    // exceptions are genuinely the same in both: brand names, the language
    // names in the switcher, and separators.
    const allowed = new Set([
      "language.es", "language.en",
      "booking.namePlaceholder",
      "session.outlet", "session.invoiceTotal",
    ])
    const spanish = shapes(MESSAGES.es)
    const untranslated = Object.keys(spanish)
      .filter((key) => spanish[key] === "string" && !allowed.has(key))
      .filter((key) => {
        const read = (locale: "es" | "en") => key.split(".").reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part], MESSAGES[locale]
        )
        return read("es") === read("en")
      })
    expect(untranslated).toEqual([])
  })
})
