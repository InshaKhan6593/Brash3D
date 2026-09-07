"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { CalendarDays } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CustomerHeader } from "@/components/customer-header"
import { TimeSlot } from "@/lib/types"

interface BookingResult {
  checkoutUrl?: string
  rewardApplied?: boolean
  session?: { id: string }
}

export default function Home() {
  const router = useRouter()
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedSlotId, setSelectedSlotId] = useState("")
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

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
          referralCode: form.get("referralCode"),
          slotId: selectedSlotId,
        }),
      })
      const data = (await response.json()) as BookingResult & { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to complete the booking")
      if (data.rewardApplied && data.session?.id) {
        router.push(`/session/${encodeURIComponent(data.session.id)}?booking=reward`)
        return
      }
      if (!data.checkoutUrl) throw new Error("Unable to start secure checkout")
      window.location.assign(data.checkoutUrl)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to complete the booking")
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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Book your live shopping session</h1>
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
            Choose a time at Nike Sawgrass, meet your personal shopper on WhatsApp, and watch your cart update live.
          </p>
        </header>

        <form onSubmit={submitBooking} className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarDays className="size-5" /> Choose date and time
              </CardTitle>
              <CardDescription>Pick a date, then select one available Nike Sawgrass time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                      className="h-9"
                      value={activeDate}
                      onChange={(event) => {
                        setSelectedDate(event.target.value)
                        setSelectedSlotId("")
                      }}
                    />
                  </div>
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-semibold">{new Date(`${activeDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
                      <span className="text-xs text-muted-foreground">{availableCount} available</span>
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
                        <span className="text-[10px] font-normal opacity-70">{slot.available ? "Available" : "Booked"}</span>
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
              <CardTitle className="text-xl">Your details</CardTitle>
              <CardDescription>The reservation fee is $20 USD.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {selectedSlot && (
                <div className="rounded-md bg-muted p-3 text-sm sm:col-span-2 lg:col-span-1">
                  <p className="font-semibold">Selected appointment</p>
                  <p className="text-muted-foreground">
                    {new Date(`${selectedSlot.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}, {selectedSlot.time} · {selectedSlot.outlet}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="nombre">Full name</Label>
                <Input id="nombre" name="nombre" required placeholder="Camila Rodriguez" className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required placeholder="camila@example.com" className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">WhatsApp number</Label>
                <Input id="telefono" name="telefono" required placeholder="+57 300 123 4567" className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ciudad">City</Label>
                <Input id="ciudad" name="ciudad" required placeholder="Bogota" className="h-9" />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="referralCode">Referral code <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="referralCode" name="referralCode" maxLength={32} placeholder="BR3D-ABC123" className="h-9 uppercase" />
                <p className="text-xs text-muted-foreground">A valid reward covers this booking’s $20 fee.</p>
              </div>
              {error && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-1">{error}</p>}
              <Button className="w-full sm:col-span-2 lg:col-span-1" size="lg" disabled={!selectedSlotId || submitting}>
                {submitting ? "Opening secure checkout..." : "Pay $20 and reserve slot"}
              </Button>
              <p className="text-center text-xs text-muted-foreground sm:col-span-2 lg:col-span-1">
                Stripe securely processes your payment. The slot is held for 15 minutes.
              </p>
            </CardContent>
          </Card>
        </form>
        </div>
      </main>
    </div>
  )
}
