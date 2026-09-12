"use client"

import { useEffect, useRef } from "react"
import { Check, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CopyToastState {
  /** Changes on every copy, so repeating one restarts the timer. */
  id: number
  tone: "ok" | "error"
  message: string
}

/** Builds a state with a fresh id, so two copies in a row both show. */
export function copyToast(tone: "ok" | "error", message: string): CopyToastState {
  return { id: Date.now(), tone, message }
}

/**
 * A brief confirmation that something was copied.
 *
 * Copying used to give no feedback at all, and the first fix for that was a
 * dialog showing the link with a Copy button. That confirmed the copy but put a
 * modal in the way of an action the operator performs constantly, mid-call,
 * and then made them dismiss it. This says the same thing and gets out of the
 * way.
 *
 * An error stays up three times as long: it means the clipboard was blocked and
 * nothing was copied, so the operator has to notice it and try again.
 */
export function CopyToast({ state, onDismiss }: { state: CopyToastState | null; onDismiss: () => void }) {
  // Held in a ref so an inline `onDismiss` at the call site does not restart
  // the timer on every render of the parent -- these panels poll every 1.5-5s.
  const dismiss = useRef(onDismiss)
  useEffect(() => { dismiss.current = onDismiss }, [onDismiss])

  useEffect(() => {
    if (!state) return
    const timer = window.setTimeout(() => dismiss.current(), state.tone === "error" ? 6000 : 2000)
    return () => window.clearTimeout(timer)
  }, [state])

  if (!state) return null

  return (
    <div
      // Announced without stealing focus, which a dialog does -- and stealing
      // focus is what made the old version interrupt the call.
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed bottom-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2",
        "rounded-lg border bg-background px-4 py-2.5 text-sm font-medium shadow-lg",
        state.tone === "error" && "border-destructive/50 text-destructive"
      )}
    >
      {state.tone === "ok"
        ? <Check aria-hidden className="size-4 shrink-0" />
        : <TriangleAlert aria-hidden className="size-4 shrink-0" />}
      <span>{state.message}</span>
    </div>
  )
}
