"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "@/lib/i18n/locale"
import { messagesFor, type Messages } from "@/lib/i18n/messages"

interface LocaleContextValue {
  locale: Locale
  /** The dictionary for the active locale. Named `t` to keep call sites short. */
  t: Messages
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

/**
 * Holds the active language for the customer screens and the Colombia panel.
 *
 * The initial value comes from the server, which reads the cookie, so the first
 * paint is already in the right language and there is no flash of Spanish for
 * an English reader. Switching is client-side: the cookie is rewritten and the
 * context updates, so nothing re-fetches and no page reload is needed.
 *
 * `document.documentElement.lang` is updated alongside, because the server set
 * it from the cookie and would otherwise be stale until the next navigation.
 * Assistive technology reads that attribute to choose a voice.
 */
export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    // Not httpOnly by design: the toggle writes it here so switching costs no
    // round trip. The value carries no authority -- an unrecognised one falls
    // back to Spanish in `resolveLocale`.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
    document.documentElement.lang = next
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: messagesFor(locale), setLocale }),
    [locale, setLocale]
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * Falls back to Spanish rather than throwing when no provider is above it.
 *
 * The staff panels are English and are not wrapped, but they share components
 * with the customer screens -- `PurchaseHistoryTable` is on both. A throw here
 * would turn a shared component into a crash the first time it is reused.
 */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (context) return context
  return { locale: DEFAULT_LOCALE, t: messagesFor(DEFAULT_LOCALE), setLocale: () => {} }
}
