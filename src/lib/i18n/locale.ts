/**
 * The language the customer screens and the Colombia panel are rendered in.
 *
 * Spanish is the default because the buyers are Colombian and the client's
 * approved designs are Spanish. English exists because the people running the
 * business are in Miami: without it, nobody on the USA side can read the
 * screens their own customers are looking at.
 *
 * Browser translation is not an option here. The root layout sets
 * `translate="no"` deliberately -- Chrome rewrites text nodes in place, React
 * still holds the nodes it rendered, and the next re-render throws
 * `NotFoundError` from `removeChild`, replacing the page *after* the action
 * that triggered the render has already committed. A successful write looks
 * like a failure. So the translation has to be ours.
 */
export type Locale = "es" | "en"

export const LOCALES: readonly Locale[] = ["es", "en"]

/** Spanish, matching the client's designs and the Colombian buyer audience. */
export const DEFAULT_LOCALE: Locale = "es"

/**
 * Readable by the server, for `<html lang>`, and writable by the client.
 *
 * Not `httpOnly`: the toggle sets it from the browser so switching language
 * needs no round trip. It carries no authority -- the worst a tampered value
 * can do is fall back to Spanish.
 */
export const LOCALE_COOKIE = "brash3d_locale"

/** A year: a returning customer should not have to pick their language again. */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/** Anything unrecognised is Spanish, which is what every existing visitor sees. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/**
 * The locale to format dates and numbers in.
 *
 * Spanish uses the destination country's locale, so a second country formats
 * its own dates without these call sites changing. English is US, matching the
 * seller dashboard the same person is reading alongside it.
 */
export function intlLocale(locale: Locale, countryLocale: string): string {
  return locale === "es" ? countryLocale : "en-US"
}
