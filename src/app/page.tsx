"use client"

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { CalendarDays, Clock3 } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CustomerHeader } from "@/components/customer-header"
import { DEFAULT_COUNTRY } from "@/lib/countries"
import { intlLocale } from "@/lib/i18n/locale"
import { useLocale } from "@/lib/i18n/provider"
import { formatAppointment } from "@/lib/appointment"
import { CUSTOMER_ACCESS_PARAM, customerSessionPath } from "@/lib/customer-link"
import { TimeSlot } from "@/lib/types"

/**
 * The booking this browser sent to Stripe and has not seen paid.
 *
 * Booking holds the slot for 15 minutes. A customer who comes back here from
 * Stripe without paying -- the browser's Back button, or Stripe's own back
 * arrow -- used to find their slot looking free (Back restores the page as it
 * was before the hold) and then refused when they tried again, because their
 * own hold was blocking it. Remembering which order went to Stripe lets this
 * page ask the server about it and offer to resume or release.
 *
 * Only the order's id and its link are kept. Whether the hold is still live,
 * and the Stripe link to resume it, always come from the server.
 */
const PENDING_BOOKING_KEY = "brash3d:pending-booking"

interface PendingBooking {
  sessionId: string
  sessionUrl: string
}

function readPendingBooking(): PendingBooking | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_BOOKING_KEY) || "null") as Partial<PendingBooking> | null
    return value?.sessionId && value.sessionUrl ? { sessionId: value.sessionId, sessionUrl: value.sessionUrl } : null
  } catch {
    return null
  }
}

function writePendingBooking(value: PendingBooking | null) {
  try {
    if (value) window.localStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(PENDING_BOOKING_KEY)
  } catch { /* private mode: the banner simply does not appear */ }
}

function accessTokenOf(sessionUrl: string): string | null {
  return new URL(sessionUrl, window.location.origin).searchParams.get(CUSTOMER_ACCESS_PARAM)
}

type HoldView =
  | { status: "pending"; pending: PendingBooking; holdExpiresAt: string; startsAt: string; checkoutUrl: string | null }
  | { status: "processing" | "confirmed"; pending: PendingBooking }

type ReleaseOutcome = "released" | "processing" | "confirmed" | "failed"

async function releaseHold(pending: PendingBooking): Promise<ReleaseOutcome> {
  try {
    const response = await fetch("/api/bookings/hold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: pending.sessionId, accessToken: accessTokenOf(pending.sessionUrl) }),
    })
    if (response.status === 404) return "released"
    if (!response.ok) return "failed"
    const data = await response.json() as { status: ReleaseOutcome }
    return data.status
  } catch {
    return "failed"
  }
}

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`
}

interface BookingResult {
  checkoutUrl?: string
  rewardApplied?: boolean
  session?: { id: string }
  /** The durable customer link, token included. */
  sessionUrl?: string
}

export default function Home() {
  const router = useRouter()
  const { locale, t } = useLocale()
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedSlotId, setSelectedSlotId] = useState("")
  const [requiresLocalInvoice, setRequiresLocalInvoice] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [hold, setHold] = useState<HoldView | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [releasedNotice, setReleasedNotice] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const checkoutCancelled = useRef<boolean | null>(null)
  const dateLocale = intlLocale(locale, DEFAULT_COUNTRY.locale)

  const loadSlots = useCallback(async () => {
    try {
      const response = await fetch("/api/slots", { cache: "no-store" })
      if (!response.ok) throw new Error("SLOTS_LOAD_FAILED")
      const data = (await response.json()) as { slots: TimeSlot[] }
      setSlots(data.slots)
    } catch {
      // Set as a marker rather than a sentence: the language can change after
      // this runs, and a stored Spanish string would not follow the toggle.
      setError("SLOTS_LOAD_FAILED")
    } finally {
      setLoadingSlots(false)
    }
  }, [])

  const release = useCallback(async (pending: PendingBooking): Promise<ReleaseOutcome> => {
    const outcome = await releaseHold(pending)
    if (outcome === "released") {
      writePendingBooking(null)
      setHold(null)
      await loadSlots()
    } else if (outcome === "processing" || outcome === "confirmed") {
      setHold({ status: outcome, pending })
    }
    return outcome
  }, [loadSlots])

  /**
   * Asks the server about the booking this browser last sent to Stripe.
   *
   * `cancelled` is Stripe's own back arrow (the checkout's cancel URL): the
   * customer has said they are not paying, so the slot is released at once
   * rather than left held for the rest of the 15 minutes.
   */
  const checkHold = useCallback(async (cancelled: boolean) => {
    const pending = readPendingBooking()
    if (!pending) return
    try {
      const token = accessTokenOf(pending.sessionUrl)
      const response = await fetch(
        `/api/bookings/hold?sessionId=${encodeURIComponent(pending.sessionId)}${token ? `&access=${encodeURIComponent(token)}` : ""}`,
        { cache: "no-store" }
      )
      if (!response.ok) {
        writePendingBooking(null)
        setHold(null)
        return
      }
      const data = await response.json() as { status: HoldView["status"] | "released"; holdExpiresAt?: string; startsAt?: string; checkoutUrl?: string | null }
      if (data.status === "released") {
        writePendingBooking(null)
        setHold(null)
        return
      }
      if (data.status === "pending" && cancelled) {
        if (await release(pending) === "released") setReleasedNotice(true)
        return
      }
      if (data.status === "pending") {
        setHold({ status: "pending", pending, holdExpiresAt: data.holdExpiresAt!, startsAt: data.startsAt!, checkoutUrl: data.checkoutUrl ?? null })
        return
      }
      // Paid. The notice is shown once; after that the order page is the record.
      if (data.status === "confirmed") writePendingBooking(null)
      setHold({ status: data.status, pending })
    } catch {
      // Unreachable server: the page still works, the banner just waits.
    }
  }, [release])

  useEffect(() => {
    // Read once per page load and kept, because the address bar is cleaned
    // straight after -- so a reload does not release a second time -- and a
    // re-run of this effect would otherwise no longer see it.
    if (checkoutCancelled.current === null) {
      checkoutCancelled.current = new URLSearchParams(window.location.search).get("checkout") === "cancelled"
      if (checkoutCancelled.current) window.history.replaceState(null, "", "/")
    }
    const cancelled = checkoutCancelled.current
    const initialLoad = window.setTimeout(() => {
      void loadSlots()
      void checkHold(cancelled)
    }, 0)

    // Back from Stripe usually restores this page from the browser's cache, as
    // it was before the booking -- slots included -- without running anything
    // above. Refreshed here so the grid and the banner are the real state.
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return
      setSubmitting(false)
      void loadSlots()
      void checkHold(false)
    }
    window.addEventListener("pageshow", onPageShow)
    return () => {
      window.clearTimeout(initialLoad)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [checkHold, loadSlots])

  // The countdown, and the moment the hold lapses: the banner goes and the
  // grid is re-read, since the slot is free again.
  const holdExpiresAt = hold?.status === "pending" ? new Date(hold.holdExpiresAt).getTime() : null
  useEffect(() => {
    if (holdExpiresAt === null) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= holdExpiresAt) {
        writePendingBooking(null)
        setHold(null)
        void loadSlots()
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [holdExpiresAt, loadSlots])

  async function pickAnotherTime() {
    if (hold?.status !== "pending") return
    setReleasing(true)
    setError("")
    if (await release(hold.pending) === "failed") setError("RELEASE_FAILED")
    setReleasing(false)
  }

  const slotsByDate = useMemo(() => {
    return slots.reduce<Record<string, TimeSlot[]>>((groups, slot) => {
      groups[slot.date] ??= []
      groups[slot.date].push(slot)
      return groups
    }, {})
  }, [slots])

  const dates = Object.keys(slotsByDate)
  const activeDate = selectedDate || dates[0] || ""
  const activeSlots = slotsByDate[activeDate] || []
  const availableCount = activeSlots.filter((slot) => slot.available).length
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId)

  // The API answers in Spanish for the customer, so a server message is shown
  // as-is; only our own markers are translated here.
  const errorMessage = error === "SLOTS_LOAD_FAILED"
    ? t.booking.loadError
    : error === "PHONE_INVALID"
      ? t.booking.phoneError
    : error === "BOOKING_FAILED"
      ? t.booking.bookingError
      : error === "CHECKOUT_FAILED"
        ? t.booking.checkoutError
      : error === "RELEASE_FAILED"
        ? t.booking.releaseError
        : error

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    setReleasedNotice(false)

    const form = new FormData(event.currentTarget)
    // Booking again while an earlier hold is live means the customer has moved
    // on from it -- possibly to the very same slot, which their own hold would
    // otherwise block. Released first, so the new booking can have it.
    if (hold?.status === "pending") {
      const outcome = await release(hold.pending)
      if (outcome !== "released") {
        if (outcome === "failed") setError("RELEASE_FAILED")
        setSubmitting(false)
        return
      }
    }
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.get("nombre"),
          email: form.get("email"),
          telefono: form.get("telefono"),
          ciudad: form.get("ciudad"),
          referralCode: form.get("referralCode"),
          requiresLocalInvoice,
          slotId: selectedSlotId,
        }),
      })
      const data = (await response.json()) as BookingResult & { error?: string; code?: string }
      // The code is preferred over the sentence so the page can translate it,
      // the same shape the checkout route already uses. The Spanish sentence
      // remains the fallback for anything unrecognised.
      if (!response.ok) throw new Error(data.code || data.error || "BOOKING_FAILED")
      if (data.rewardApplied && data.session?.id) {
        // Prefer the tokenised link the API returns, so the customer lands on a
        // URL that still opens their order from another browser next week.
        router.push(data.sessionUrl
          ? `${data.sessionUrl}&booking=reward`
          : customerSessionPath(data.session.id, null, { booking: "reward" }))
        return
      }
      if (!data.checkoutUrl) throw new Error("CHECKOUT_FAILED")
      if (data.session?.id && data.sessionUrl) writePendingBooking({ sessionId: data.session.id, sessionUrl: data.sessionUrl })
      window.location.assign(data.checkoutUrl)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "BOOKING_FAILED")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <CustomerHeader />
      <main className="px-4 py-4 sm:py-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.booking.title}</h1>
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
            {t.booking.subtitle}
          </p>
        </header>

        {hold?.status === "pending" && (
          <Card className="border-primary/50" role="status" aria-live="polite">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">{t.booking.pendingTitle}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.booking.pendingBody(
                      formatAppointment(new Date(hold.startsAt), dateLocale, DEFAULT_COUNTRY.timeZone),
                      formatRemaining(new Date(hold.holdExpiresAt).getTime() - now)
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
                {hold.checkoutUrl && <Button type="button" onClick={() => window.location.assign(hold.checkoutUrl!)}>{t.booking.continuePayment}</Button>}
                <Button type="button" variant="outline" disabled={releasing} onClick={() => void pickAnotherTime()}>
                  {releasing ? t.booking.releasing : t.booking.pickAnother}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {(hold?.status === "processing" || hold?.status === "confirmed") && (
          <Card role="status">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{hold.status === "processing" ? t.booking.processingTitle : t.booking.confirmedTitle}</p>
                {hold.status === "processing" && <p className="text-sm text-muted-foreground">{t.booking.processingBody}</p>}
              </div>
              <Button asChild className="sm:shrink-0"><Link href={hold.pending.sessionUrl}>{t.booking.viewOrder}</Link></Button>
            </CardContent>
          </Card>
        )}
        {releasedNotice && <p role="status" className="rounded-md bg-muted px-4 py-3 text-sm">{t.booking.releasedNotice}</p>}

        <form onSubmit={submitBooking} className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarDays className="size-5" /> {t.booking.pickSlot}
              </CardTitle>
              <CardDescription>{t.booking.pickSlotHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingSlots && <p className="text-sm text-muted-foreground">{t.booking.loadingSlots}</p>}
              {!loadingSlots && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="booking-date">{t.booking.dateLabel}</Label>
                    <Input
                      id="booking-date"
                      type="date"
                      min={dates[0]}
                      max={dates[dates.length - 1]}
                      className="h-9"
                      value={activeDate}
                      onChange={(event) => {
                        setSelectedDate(event.target.value)
                        setSelectedSlotId("")
                      }}
                    />
                  </div>
                  <section id="horarios" className="scroll-mt-20 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-medium text-muted-foreground first-letter:uppercase">{new Date(`${activeDate}T12:00:00`).toLocaleDateString(dateLocale, { weekday: "long" })}</h2>
                      <span className="text-xs text-muted-foreground">{t.booking.slotsAvailable(availableCount)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {activeSlots.map((slot) => (
                      <Button
                        key={slot.id}
                        type="button"
                        variant={selectedSlotId === slot.id ? "default" : "outline"}
                        disabled={!slot.available}
                        onClick={() => setSelectedSlotId(slot.id)}
                        className="h-12 flex-col justify-center gap-0 px-2 leading-tight"
                      >
                        <span>{slot.time}</span>
                        {!slot.available && <span className="text-[10px] font-normal opacity-70">{t.booking.taken}</span>}
                      </Button>
                    ))}
                    </div>
                  </section>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">{t.booking.yourDetails}</CardTitle>
              <CardDescription>{t.booking.fixedFee}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {selectedSlot && (
                <div className="rounded-md bg-muted p-3 text-sm sm:col-span-2 lg:col-span-1">
                  <p className="font-semibold">{t.booking.selectedAppointment}</p>
                  <p className="text-muted-foreground">
                    {formatAppointment(new Date(selectedSlot.startsAt), dateLocale, DEFAULT_COUNTRY.timeZone)} · {selectedSlot.outlet}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="nombre">{t.booking.name}</Label>
                <Input id="nombre" name="nombre" required placeholder={t.booking.namePlaceholder} className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t.booking.email}</Label>
                <Input id="email" name="email" type="email" required placeholder={t.booking.emailPlaceholder} className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">{t.booking.whatsapp}</Label>
                <Input id="telefono" name="telefono" required placeholder={DEFAULT_COUNTRY.examplePhone} className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ciudad">{t.booking.city}</Label>
                <Input id="ciudad" name="ciudad" required placeholder={DEFAULT_COUNTRY.exampleCity} className="h-9" />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="referralCode">{t.booking.referral} <span className="text-muted-foreground">{t.booking.referralOptional}</span></Label>
                <Input id="referralCode" name="referralCode" maxLength={32} placeholder="BR3D-ABC123" className="h-9 uppercase" />
                <p className="text-xs text-muted-foreground">{t.booking.referralHint}</p>
              </div>
              {DEFAULT_COUNTRY.localInvoice && <div className="flex items-start gap-2.5 rounded-md border p-3 sm:col-span-2 lg:col-span-1">
                <Checkbox
                  id="requiresLocalInvoice"
                  checked={requiresLocalInvoice}
                  onCheckedChange={(checked) => setRequiresLocalInvoice(checked === true)}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <Label htmlFor="requiresLocalInvoice" className="font-normal leading-snug">
                    {t.booking.localInvoiceLabel(DEFAULT_COUNTRY.localInvoice.entity)}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {DEFAULT_COUNTRY.localInvoice.reason[locale]}
                  </p>
                </div>
              </div>}
              {errorMessage && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-1">{errorMessage}</p>}
              {!selectedSlotId && (
                <button
                  type="button"
                  onClick={() => document.getElementById("horarios")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className="w-full rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted sm:col-span-2 lg:col-span-1"
                >
                  {t.booking.pickSlotFirst} <span className="font-medium underline">{t.booking.seeSlots}</span>
                </button>
              )}
              <Button className="w-full sm:col-span-2 lg:col-span-1" size="lg" disabled={!selectedSlotId || submitting}>
                {submitting ? t.booking.opening : t.booking.payAndBook}
              </Button>
              <p className="text-center text-xs text-muted-foreground sm:col-span-2 lg:col-span-1">
                {t.booking.stripeNote}
              </p>
            </CardContent>
          </Card>
        </form>
        </div>
      </main>
    </div>
  )
}
