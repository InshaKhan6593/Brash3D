"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { CalendarDays } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CustomerHeader } from "@/components/customer-header"
import { DEFAULT_COUNTRY } from "@/lib/countries"
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
  const [requiresLocalInvoice, setRequiresLocalInvoice] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    async function loadSlots() {
      try {
        const response = await fetch("/api/slots", { cache: "no-store" })
        if (!response.ok) throw new Error("No pudimos cargar los horarios disponibles")
        const data = (await response.json()) as { slots: TimeSlot[] }
        setSlots(data.slots)
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "No pudimos cargar los horarios disponibles")
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
          requiresLocalInvoice,
          slotId: selectedSlotId,
        }),
      })
      const data = (await response.json()) as BookingResult & { error?: string }
      if (!response.ok) throw new Error(data.error || "No pudimos completar la reserva")
      if (data.rewardApplied && data.session?.id) {
        router.push(`/session/${encodeURIComponent(data.session.id)}?booking=reward`)
        return
      }
      if (!data.checkoutUrl) throw new Error("No pudimos abrir el pago seguro")
      window.location.assign(data.checkoutUrl)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No pudimos completar la reserva")
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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reserva tu sesión de compra en vivo</h1>
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
            Elige un horario en Nike Sawgrass, conéctate con tu comprador personal por WhatsApp y mira tu carrito actualizarse en vivo.
          </p>
        </header>

        <form onSubmit={submitBooking} className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarDays className="size-5" /> Elige fecha y hora
              </CardTitle>
              <CardDescription>Selecciona una fecha y luego un horario disponible en Nike Sawgrass.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingSlots && <p className="text-sm text-muted-foreground">Cargando horarios disponibles...</p>}
              {!loadingSlots && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="booking-date">Fecha de la cita</Label>
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
                      <h2 className="text-sm font-medium text-muted-foreground first-letter:uppercase">{new Date(`${activeDate}T12:00:00`).toLocaleDateString(DEFAULT_COUNTRY.locale, { weekday: "long" })}</h2>
                      <span className="text-xs text-muted-foreground">{availableCount} horario{availableCount === 1 ? "" : "s"} disponible{availableCount === 1 ? "" : "s"}</span>
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
                        {!slot.available && <span className="text-[10px] font-normal opacity-70">Reservado</span>}
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
              <CardTitle className="text-xl">Tus datos</CardTitle>
              <CardDescription>La reserva tiene un costo fijo de 20 USD.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {selectedSlot && (
                <div className="rounded-md bg-muted p-3 text-sm sm:col-span-2 lg:col-span-1">
                  <p className="font-semibold">Cita seleccionada</p>
                  <p className="text-muted-foreground">
                    {new Date(`${selectedSlot.date}T12:00:00`).toLocaleDateString(DEFAULT_COUNTRY.locale, { month: "long", day: "numeric" })}, {selectedSlot.time} · {selectedSlot.outlet}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre completo</Label>
                <Input id="nombre" name="nombre" required placeholder="Camila Rodríguez" className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input id="email" name="email" type="email" required placeholder="camila@ejemplo.com" className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Número de WhatsApp</Label>
                <Input id="telefono" name="telefono" required placeholder={DEFAULT_COUNTRY.examplePhone} className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ciudad">Ciudad</Label>
                <Input id="ciudad" name="ciudad" required placeholder={DEFAULT_COUNTRY.exampleCity} className="h-9" />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="referralCode">Código de referido <span className="text-muted-foreground">(opcional)</span></Label>
                <Input id="referralCode" name="referralCode" maxLength={32} placeholder="BR3D-ABC123" className="h-9 uppercase" />
                <p className="text-xs text-muted-foreground">Una recompensa válida cubre los 20 USD de esta reserva.</p>
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
                    Necesito factura local de {DEFAULT_COUNTRY.localInvoice.entity}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {DEFAULT_COUNTRY.localInvoice.reason}
                  </p>
                </div>
              </div>}
              {error && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-1">{error}</p>}
              {!selectedSlotId && (
                <button
                  type="button"
                  onClick={() => document.getElementById("horarios")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className="w-full rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted sm:col-span-2 lg:col-span-1"
                >
                  Primero elige un horario disponible arriba. <span className="font-medium underline">Ver horarios</span>
                </button>
              )}
              <Button className="w-full sm:col-span-2 lg:col-span-1" size="lg" disabled={!selectedSlotId || submitting}>
                {submitting ? "Abriendo pago seguro..." : "Pagar 20 USD y reservar"}
              </Button>
              <p className="text-center text-xs text-muted-foreground sm:col-span-2 lg:col-span-1">
                Stripe procesa tu pago de forma segura. El horario queda apartado 15 minutos.
              </p>
            </CardContent>
          </Card>
        </form>
        </div>
      </main>
    </div>
  )
}
