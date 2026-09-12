"use client"

import { useEffect, useRef, useState } from "react"
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js"

interface TokenResponse {
  enabled: boolean
  url?: string
  anonKey?: string
  token?: string
}

/**
 * Subscribes to one order's live changes, and reports whether it is connected.
 *
 * The browser opens this socket to Supabase directly. That is the detail that
 * makes Realtime work here at all: the app is deployed to Vercel, where a
 * serverless function cannot hold a long-lived connection, so anything that
 * kept the stream open on our side -- SSE, WebSockets, `LISTEN`/`NOTIFY` --
 * would pin an invocation per viewer and fight the transaction pooler. Nothing
 * is held on our side; Supabase holds it.
 *
 * `connected` is the caller's cue to slow its polling, not to stop it. A socket
 * can die quietly -- a sleeping phone, a captive portal, a dropped upgrade --
 * and the customer is watching a cart during a live call, so a slow poll stays
 * underneath as a backstop. Push is the optimisation; polling remains the floor.
 *
 * Everything degrades rather than breaks: no credentials configured, a failed
 * mint, or a refused subscription all leave `connected` false and the caller
 * polling exactly as it did before Realtime existed.
 */
export function useRealtimeSession(
  sessionId: string | null,
  accessToken: string | null,
  onChange: () => void
): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  // Held in a ref so a caller passing an inline function does not tear the
  // subscription down and rebuild it on every render.
  const changed = useRef(onChange)
  useEffect(() => { changed.current = onChange }, [onChange])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let client: SupabaseClient | null = null
    let channel: RealtimeChannel | null = null

    async function connect() {
      const query = new URLSearchParams({ sessionId: sessionId! })
      if (accessToken) query.set("access", accessToken)
      const response = await fetch(`/api/realtime/token?${query}`, { cache: "no-store" })
      if (!response.ok || cancelled) return

      const config = await response.json() as TokenResponse
      if (!config.enabled || !config.url || !config.anonKey || !config.token || cancelled) return

      client = createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 5 } },
      })
      // The signed claim, not the publishable key, is what the RLS policies
      // read. Without this the socket opens and sees nothing.
      await client.realtime.setAuth(config.token)

      const filter = `sesion_id=eq.${sessionId}`
      channel = client
        .channel(`order-${sessionId}`)
        // The three tables migration 018 grants, matching the specification's
        // section 7: the cart, the session totals, and the shipment.
        .on("postgres_changes", { event: "*", schema: "public", table: "productos_carrito", filter }, () => changed.current())
        .on("postgres_changes", { event: "*", schema: "public", table: "envios", filter }, () => changed.current())
        .on("postgres_changes", { event: "*", schema: "public", table: "sesiones_compra", filter: `id=eq.${sessionId}` }, () => changed.current())
        .subscribe((status) => {
          if (cancelled) return
          const live = status === "SUBSCRIBED"
          setConnected(live)
          // Re-read once on connect: anything that changed between the last
          // poll and the socket opening would otherwise go unnoticed.
          if (live) changed.current()
        })
    }

    void connect()

    return () => {
      cancelled = true
      setConnected(false)
      if (channel) void client?.removeChannel(channel)
      void client?.realtime.disconnect()
    }
  }, [accessToken, sessionId])

  return { connected }
}
