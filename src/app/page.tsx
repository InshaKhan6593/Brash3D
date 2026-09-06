"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CalendarDays, CheckCircle2, Clock, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CustomerHeader } from "@/components/customer-header"
import { TimeSlot } from "@/lib/types"

interface BookingResult {
  booking: { id: string; fecha: string; hora: string }
  session: { id: string }
}

export default function Home() {
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedSlotId, setSelectedSlotId] = useState("")
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<BookingResult | null>(null)

  useEffect(() => {
    async function loadSlots() {
      try {
        const response = await fetch("/api/slots", { cache: "no-store" })
        if (!response.ok) throw new Error("Unable to load available times")
        const data = (await response.json()) as { slots: TimeSlot[] }
        setSlots(data.slots)
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load available times")
      } finally {
        setLoadingSlots(false)
      }
    }

    void loadSlots()
  }, [])

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

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError("")

    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.get("nombre"),
          email: form.get("email"),
          telefono: form.get("telefono"),
          ciudad: form.get("ciudad"),
          slotId: selectedSlotId,
        }),
      })
      const data = (await response.json()) as BookingResult & { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to complete the booking")
      setResult(data)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to complete the booking")
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="min-h-screen">
        <CustomerHeader />
        <main className="px-4 py-12">
        <Card className="mx-auto max-w-xl">
          <CardHeader className="text-center">
            <CheckCircle2 className="mx-auto mb-3 size-12" />
            <CardTitle>Booking confirmed</CardTitle>
            <CardDescription>
              Your $20 booking fee is simulated in this demo. Your live shopping session is ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-muted p-4 text-center text-sm">
              <p className="font-semibold">
                {new Date(result.booking.fecha).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })} at {result.booking.hora}
              </p>
              <p className="text-muted-foreground">A WhatsApp session link will be shared before the appointment.</p>
            </div>
            <Button asChild className="w-full" size="lg">
              <Link href={`/session/${result.session.id}`}>Open customer session</Link>
            </Button>
            <Button asChild className="w-full" variant="outline">
              <Link href={`/seller?sessionId=${result.session.id}`}>Open seller panel</Link>
            </Button>
            <p className="pt-2 text-center text-xs text-muted-foreground">
              Open the two links in separate tabs to test live cart synchronization.
            </p>
          </CardContent>
        </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <CustomerHeader />
      <main className="px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3 text-center">
          <ShoppingBag className="mx-auto size-10" />
          <h1 className="text-3xl font-bold tracking-tight">Book your live shopping session</h1>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            Choose a Miami outlet time, meet your personal shopper on WhatsApp, and watch your cart update live.
          </p>
        </header>

        <form onSubmit={submitBooking} className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarDays className="size-5" /> Choose date and time
              </CardTitle>
              <CardDescription>Pick a date first, then select one available Miami time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {loadingSlots && <p className="text-sm text-muted-foreground">Loading available times...</p>}
              {!loadingSlots && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="booking-date">Appointment date</Label>
                    <Input
                      id="booking-date"
                      type="date"
                      min={dates[0]}
                      max={dates[dates.length - 1]}
                      value={activeDate}
                      onChange={(event) => {
                        setSelectedDate(event.target.value)
                        setSelectedSlotId("")
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Bookings are open from today through the end of next month.</p>
                  </div>
                  <section className="space-y-3 pt-2">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-semibold">{new Date(`${activeDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
                      <span className="text-xs text-muted-foreground">{availableCount} available</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                    {activeSlots.map((slot) => (
                      <Button
                        key={slot.id}
                        type="button"
                        variant={selectedSlotId === slot.id ? "default" : "outline"}
                        disabled={!slot.available}
                        onClick={() => setSelectedSlotId(slot.id)}
                        className="h-auto justify-start px-4 py-3 text-left"
                      >
                        <span><span className="flex items-center gap-1 font-medium"><Clock className="size-3" />{slot.time}</span><span className="mt-1 block truncate text-xs opacity-75">{slot.outlet}{!slot.available && " · Booked"}</span></span>
                      </Button>
                    ))}
                    </div>
                  </section>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Your details</CardTitle>
              <CardDescription>The reservation fee is $20 USD.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedSlot && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-semibold">Selected appointment</p>
                  <p className="text-muted-foreground">
                    {new Date(`${selectedSlot.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}, {selectedSlot.time} · {selectedSlot.outlet}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="nombre">Full name</Label>
                <Input id="nombre" name="nombre" required placeholder="Camila Rodriguez" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required placeholder="camila@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">WhatsApp number</Label>
                <Input id="telefono" name="telefono" required placeholder="+57 300 123 4567" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ciudad">City</Label>
                <Input id="ciudad" name="ciudad" required placeholder="Bogota" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" size="lg" disabled={!selectedSlotId || submitting}>
                {submitting ? "Confirming..." : "Pay $20 and confirm booking"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Payment is simulated until Stripe credentials are connected.
              </p>
            </CardContent>
          </Card>
        </form>
        </div>
      </main>
    </div>
  )
}
