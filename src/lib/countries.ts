/**
 * Everything that differs between destination countries, in one place.
 *
 * The business runs from Miami and delivers to Colombia. The client has said
 * the destination may become "colombia or any latin america country", so the
 * parts that vary by country are read from this registry rather than written
 * into the screens: the city suggestions, the locale used to format dates and
 * numbers, the country's name as it appears in Spanish copy, and whether a
 * local tax invoice is offered at all.
 *
 * Colombia is deliberately the only entry. Adding a second country is an entry
 * here plus a row in `equipos_locales` and a staff login for that team -- not a
 * hunt through the components for the word "Colombia". Until the client names
 * one, inventing entries would only encode guesses about cities, tax entities
 * and who collects the cash.
 *
 * The key is the `pais` value stored on `clientes`, `equipos_locales` and
 * `cajas_consolidadas`, matched loosely so "colombia" and "Colombia" agree.
 * Anything unrecognised falls back to Colombia, which is what every existing
 * row says.
 */

export type CountryConfig = {
  /** Matches the `pais` column, and is the name shown in Spanish copy. */
  readonly name: string
  /** ISO 3166-1 alpha-2, for future courier and address integrations. */
  readonly code: string
  /** Drives `toLocaleDateString`, `toLocaleString` and `Intl.NumberFormat`. */
  readonly locale: string
  /** Adjective used in Spanish copy: "otro municipio colombiano". */
  readonly adjective: string
  /** Suggestions for the delivery-city field. Free text is still accepted. */
  readonly cities: readonly string[]
  /**
   * Placeholders. The city list is alphabetical, so its first entry is not a
   * recognisable example; these are chosen, not derived.
   */
  readonly exampleCity: string
  readonly examplePhone: string
  /**
   * The local tax invoice, when the business has an entity that can issue one.
   * Brash3D SAS is Colombian, so the offer is Colombia's alone until the client
   * says what the equivalent is elsewhere. `null` hides the option entirely.
   */
  readonly localInvoice: { readonly entity: string; readonly reason: string } | null
}

const COLOMBIA: CountryConfig = {
  name: "Colombia",
  code: "CO",
  locale: "es-CO",
  adjective: "colombiano",
  cities: [
    "Armenia", "Barrancabermeja", "Barranquilla", "Bello", "Bogotá", "Bucaramanga",
    "Buenaventura", "Buga", "Cali", "Cartagena", "Cartago", "Chía", "Cúcuta",
    "Dosquebradas", "Duitama", "Envigado", "Facatativá", "Florencia", "Floridablanca",
    "Fusagasugá", "Girardot", "Ibagué", "Ipiales", "Itagüí", "Jamundí", "Leticia",
    "Manizales", "Medellín", "Montería", "Neiva", "Palmira", "Pasto", "Pereira",
    "Piedecuesta", "Popayán", "Quibdó", "Riohacha", "Rionegro", "San Andrés",
    "Santa Marta", "Sincelejo", "Soacha", "Sogamoso", "Soledad", "Tuluá", "Tunja",
    "Valledupar", "Villavicencio", "Yopal", "Zipaquirá",
  ],
  exampleCity: "Bogotá",
  examplePhone: "+57 300 123 4567",
  localInvoice: {
    entity: "Brash3D SAS (Colombia)",
    reason: "Marca esta casilla solo si necesitas deducir la compra en Colombia. El equipo la emite manualmente.",
  },
}

export const COUNTRIES: readonly CountryConfig[] = [COLOMBIA]

/** The country every existing customer, team and box is recorded under. */
export const DEFAULT_COUNTRY = COLOMBIA

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
}

/**
 * Resolves a stored `pais` value to its configuration.
 *
 * Falls back rather than throwing: a country typed into a customer record by
 * hand must not be able to break the screen that displays it.
 */
export function countryFor(pais: string | null | undefined): CountryConfig {
  if (!pais) return DEFAULT_COUNTRY
  const wanted = normalize(pais)
  return COUNTRIES.find((country) => normalize(country.name) === wanted || country.code.toLowerCase() === wanted)
    ?? DEFAULT_COUNTRY
}

/** The locale to format a customer's dates and numbers in. */
export function localeFor(pais: string | null | undefined): string {
  return countryFor(pais).locale
}
