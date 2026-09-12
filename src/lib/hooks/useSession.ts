"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { EnvioEstado, Producto, SesionCompra } from "@/lib/types"

/**
 * A network or server failure while reading the session, as a marker.
 *
 * The customer page renders in the reader's chosen language and the seller
 * panel in English, so the hook cannot pick the wording -- and a sentence
 * stored in state would not follow a later language change anyway.
 */
export const SESSION_LOAD_FAILED = "SESSION_LOAD_FAILED"

interface UseSessionReturn {
  session: SesionCompra | null
  loading: boolean
  error: string | null
  addProduct: (product: Omit<Producto, "id" | "addedAt">) => Promise<void>
  updateQuantity: (productId: string, delta: number) => Promise<void>
  removeProduct: (productId: string) => Promise<void>
  close: (initialPercentage: number) => Promise<void>
  reopenForCorrection: () => Promise<void>
  start: () => Promise<void>
  updateDeliveryStatus: (status: EnvioEstado) => Promise<void>
  /** Resolves to null when the checkout opened, or the reason it did not. */
  pay: (delivery: { address: string; city: string }) => Promise<string | null>
  refresh: () => Promise<void>
  /**
   * The token this hook is authenticating with, once known.
   *
   * When the page was opened without one -- the browser that made the booking,
   * which holds only the cookie -- the recovery call below returns the token
   * and the page puts it in the address bar, so the URL the customer is left
   * looking at is portable like every other customer link.
   */
  recoveredToken: string | null
}

/**
 * `recoverToken` is opt-in because only the customer page has a cookie to
 * recover from. The seller panel calls this hook too, and left on by default it
 * would fire a guaranteed 404 against the recovery endpoint every time a seller
 * opened a session -- pure noise in the request log.
 */
export function useSession(
  sessionId: string | null,
  accessToken?: string | null,
  options?: { recoverToken?: boolean }
): UseSessionReturn {
  const [session, setSession] = useState<SesionCompra | null>(null)
  const [loading, setLoading] = useState(Boolean(sessionId))
  const [error, setError] = useState<string | null>(null)
  const [recoveredToken, setRecoveredToken] = useState<string | null>(null)
  // Whichever token the request should carry: the one from the URL, or the one
  // the cookie-backed recovery handed back.
  const activeToken = accessToken || recoveredToken
  // The recovery endpoint is worth at most one call per mount, and `refresh`
  // polls every 1.5s. A ref rather than state: nothing renders from it.
  const recoveryAttempted = useRef(false)
  const recoverToken = options?.recoverToken === true

  const refresh = useCallback(async () => {
    if (!sessionId) return

    try {
      const accessQuery = activeToken ? `&access=${encodeURIComponent(activeToken)}` : ""
      const response = await fetch(`/api/sessions?id=${encodeURIComponent(sessionId)}${accessQuery}`, {
        cache: "no-store",
      })
      // Recover the token from the cookie whenever the URL did not carry one.
      //
      // This runs on a 404 *and* on a success, which is the difference that
      // matters. A 404 means the cookie is the legacy one scoped below
      // /session/{id}: it reaches the recovery endpoint and nothing else, so
      // the retry below is what loads the page at all. A success means the
      // cookie works fine -- the browser that made the booking -- and without
      // recovering the token here that customer would keep a tokenless URL,
      // which is exactly the link that cannot be moved to another device.
      if (recoverToken && !activeToken && !recoveryAttempted.current) {
        recoveryAttempted.current = true
        const recovery = await fetch(`/session/${encodeURIComponent(sessionId)}/access`, {
          cache: "no-store",
        })
        if (recovery.ok) {
          const { accessToken: recovered } = (await recovery.json()) as { accessToken?: string }
          if (recovered) setRecoveredToken(recovered)
          if (response.status === 404) {
            // The widened cookie now reaches /api/sessions.
            const retried = await fetch(`/api/sessions?id=${encodeURIComponent(sessionId)}`, {
              cache: "no-store",
            })
            if (retried.ok) {
              const data = (await retried.json()) as { session: SesionCompra }
              setSession(data.session)
              setError(null)
              return
            }
          }
        }
      }
      if (response.status === 404) {
        setSession(null)
        setError(null)
        return
      }
      if (!response.ok) throw new Error(SESSION_LOAD_FAILED)

      const data = (await response.json()) as { session: SesionCompra }
      setSession(data.session)
      setError(null)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : SESSION_LOAD_FAILED)
    } finally {
      setLoading(false)
    }
  }, [activeToken, recoverToken, sessionId])

  useEffect(() => {
    if (!sessionId) return

    const initialLoad = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), 1500)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [refresh, sessionId])

  const mutate = useCallback(async (action: string, data: Record<string, unknown>) => {
    if (!sessionId) throw new Error("Missing session ID")

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sessionId, accessToken: activeToken, ...data }),
    })
    const result = (await response.json()) as { session?: SesionCompra; error?: string }
    if (!response.ok || !result.session) {
      throw new Error(result.error || "Unable to update the session")
    }
    setSession(result.session)
  }, [activeToken, sessionId])

  const addProduct = useCallback(async (product: Omit<Producto, "id" | "addedAt">) => {
    await mutate("addProduct", product)
  }, [mutate])

  const updateQuantity = useCallback(async (productId: string, delta: number) => {
    await mutate("updateQuantity", { productId, delta })
  }, [mutate])

  const removeProduct = useCallback(async (productId: string) => {
    await mutate("removeProduct", { productId })
  }, [mutate])

  const close = useCallback(async (initialPercentage: number) => {
    await mutate("close", { initialPercentage })
  }, [mutate])

  const reopenForCorrection = useCallback(async () => {
    await mutate("reopenForCorrection", {})
  }, [mutate])

  const start = useCallback(async () => {
    await mutate("start", {})
  }, [mutate])

  const updateDeliveryStatus = useCallback(async (status: EnvioEstado) => {
    await mutate("updateDeliveryStatus", { status })
  }, [mutate])

  /**
   * Returns null on success (the browser is already navigating to Stripe), or
   * the reason it failed. It used to return a bare boolean, which left the page
   * blaming the delivery address for every failure — including a Stripe outage
   * or an invoice that was not ready, where the address was perfectly fine and
   * re-typing it could never help.
   */
  const pay = useCallback(async (delivery: { address: string; city: string }): Promise<string | null> => {
    if (!sessionId) return "PAYMENT_NO_SESSION"
    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sent explicitly so a customer paying from a second device is
        // authorized by the token in their URL, not by a cookie they may not
        // have. The route falls back to the cookie when this is absent.
        body: JSON.stringify({ sessionId, stage: "inicial", accessToken: activeToken, ...delivery }),
      })
      const result = await response.json() as { checkoutUrl?: string; error?: string; code?: string }
      if (!response.ok || !result.checkoutUrl) {
        // The code translates; the Spanish sentence is the fallback for a
        // failure that has no code yet.
        return result.code || result.error || "PAYMENT_FAILED"
      }
      window.location.assign(result.checkoutUrl)
      return null
    } catch {
      return "PAYMENT_NETWORK_ERROR"
    }
  }, [activeToken, sessionId])

  return { session, loading, error, addProduct, updateQuantity, removeProduct, close, reopenForCorrection, start, updateDeliveryStatus, pay, refresh, recoveredToken }
}
