"use client"

import { useCallback, useEffect, useState } from "react"
import { Producto, SesionCompra } from "@/lib/types"

interface UseSessionReturn {
  session: SesionCompra | null
  loading: boolean
  error: string | null
  addProduct: (product: Omit<Producto, "id" | "addedAt">) => Promise<void>
  updateQuantity: (productId: string, delta: number) => Promise<void>
  removeProduct: (productId: string) => Promise<void>
  close: () => Promise<void>
  pay: (amount: "65" | "35") => Promise<boolean>
  refresh: () => Promise<void>
}

export function useSession(sessionId: string | null): UseSessionReturn {
  const [session, setSession] = useState<SesionCompra | null>(null)
  const [loading, setLoading] = useState(Boolean(sessionId))
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!sessionId) return

    try {
      const response = await fetch(`/api/sessions?id=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      })
      if (response.status === 404) {
        setSession(null)
        setError(null)
        return
      }
      if (!response.ok) throw new Error("Unable to load the session")

      const data = (await response.json()) as { session: SesionCompra }
      setSession(data.session)
      setError(null)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load the session")
    } finally {
      setLoading(false)
    }
  }, [sessionId])

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
      body: JSON.stringify({ action, sessionId, ...data }),
    })
    const result = (await response.json()) as { session?: SesionCompra; error?: string }
    if (!response.ok || !result.session) {
      throw new Error(result.error || "Unable to update the session")
    }
    setSession(result.session)
  }, [sessionId])

  const addProduct = useCallback(async (product: Omit<Producto, "id" | "addedAt">) => {
    await mutate("addProduct", product)
  }, [mutate])

  const updateQuantity = useCallback(async (productId: string, delta: number) => {
    await mutate("updateQuantity", { productId, delta })
  }, [mutate])

  const removeProduct = useCallback(async (productId: string) => {
    await mutate("removeProduct", { productId })
  }, [mutate])

  const close = useCallback(async () => {
    await mutate("close", {})
  }, [mutate])

  const pay = useCallback(async (amount: "65" | "35"): Promise<boolean> => {
    try {
      await mutate("simulatePayment", { amount })
      return true
    } catch {
      return false
    }
  }, [mutate])

  return { session, loading, error, addProduct, updateQuantity, removeProduct, close, pay, refresh }
}
