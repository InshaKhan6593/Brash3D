import type { CountryConfig } from "@/lib/countries"

/**
 * Turning what a customer types into the one format WhatsApp will accept.
 *
 * Meta addresses a recipient in E.164 — country code followed by the national
 * number, no `+`, no spaces, no trunk prefix — and it has no notion of a local
 * number. A Colombian who types `300 123 4567`, exactly as they would into
 * their own phone, produces `3001234567`, which is not a number anywhere. The
 * send is accepted by our own code, rejected or misrouted by Meta, and the
 * customer simply never hears from us. The booking confirms, the page looks
 * right, and nothing says otherwise.
 *
 * So the number is normalised once, at the booking form, and stored in the
 * shape it has to be sent in. Everything downstream — the confirmation, the
 * product echo, the Colombia team's one-tap link — reads it from there.
 *
 * Guessing is kept narrow on purpose. Prefixing a dial code onto a number that
 * merely looks national is how an order link reaches a stranger who happens to
 * hold that number in another country, so a number that does not match the
 * country's own mobile format is refused rather than repaired. A customer
 * abroad — a tester, or a Colombian buyer using a foreign handset — writes it
 * with a `+` and country code, which is always taken at face value.
 */

/** E.164 allows at most 15 digits, and no real number is shorter than 8. */
const MIN_E164 = 8
const MAX_E164 = 15

export type PhoneCountry = Pick<CountryConfig, "dialCode" | "mobilePattern">

/**
 * The number as WhatsApp needs it: digits only, country code first, no `+`.
 *
 * Returns null when the input cannot be resolved to one confidently. The caller
 * refuses the booking rather than storing something unreachable.
 */
export function toE164(raw: string, country: PhoneCountry): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // An explicit `+` is the customer stating the country themselves. Taken as
  // given: it is the only input that carries no ambiguity, and second-guessing
  // it would break every customer who is not in the destination country.
  const explicitlyInternational = trimmed.startsWith("+") || trimmed.startsWith("00")
  const digits = trimmed.replace(/\D/g, "")
  if (!digits) return null

  if (explicitlyInternational) {
    // `00` is the other way of writing `+`, and it is how the rest of the world
    // dials out. Only ever stripped when it opened the string.
    const international = trimmed.startsWith("00") ? digits.replace(/^00/, "") : digits
    return plausible(international) ? international : null
  }

  // A national number carries a trunk prefix that exists only for dialling
  // inside the country. E.164 has no room for it.
  const national = digits.replace(/^0+/, "")
  if (!national) return null

  // Already international, just written without the `+` — common when a number
  // is copied out of a contacts app.
  if (national.startsWith(country.dialCode)) {
    const rest = national.slice(country.dialCode.length)
    if (country.mobilePattern.test(rest)) return national
  }

  if (country.mobilePattern.test(national)) return `${country.dialCode}${national}`

  return null
}

function plausible(digits: string): boolean {
  return digits.length >= MIN_E164 && digits.length <= MAX_E164
}

/**
 * A last line of defence before a number is handed to Meta.
 *
 * Rows written before normalisation existed still hold whatever was typed.
 * Sending one of those reaches nobody, but it also spends a template and can
 * earn the business number a quality complaint if the digits happen to belong
 * to someone else. This does not repair such a number — there is no safe way to
 * — it only refuses the obviously unsendable ones.
 */
export function isSendable(digits: string): boolean {
  return plausible(digits) && !digits.startsWith("0")
}
