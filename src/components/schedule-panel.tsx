"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CalendarOff, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ScheduleException, SellerSchedule, WeekdaySchedule } from "@/lib/types"

/** Index matches EXTRACT(DOW): 0 = Sunday. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

interface Seller {
  id: string
  nombre: string
  tienda: string | null
}

interface StrandedBooking {
  fecha: string
  hora: string
  cliente: string
  estado: string
}

/** Whole hours only — the database enforces the same, so the options match it. */
const HOURS = Array.from({ length: 25 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`)

function slotCount(day: WeekdaySchedule): number {
  if (!day.abierto) return 0
  return Math.max(0, Number(day.horaCierre.slice(0, 2)) - Number(day.horaApertura.slice(0, 2)))
}

function HourSelect({ value, onChange, disabled, label }: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  label: string
}) {
  return (
    <select
      aria-label={label}
      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {HOURS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
    </select>
  )
}

interface SchedulePayload {
  sellers: Seller[]
  schedule: SellerSchedule | null
  stranded: StrandedBooking[]
}

/** Pure fetch: no React state, so both the mount effect and the seller buttons can call it. */
async function fetchSchedule(sellerId?: string): Promise<SchedulePayload | null> {
  const query = sellerId ? `?sellerId=${encodeURIComponent(sellerId)}` : ""
  const response = await fetch(`/api/schedule${query}`)
  if (!response.ok) return null
  return await response.json() as SchedulePayload
}

export function SchedulePanel() {
  const [sellers, setSellers] = useState<Seller[]>([])
  const [sellerId, setSellerId] = useState<string | null>(null)
  const [week, setWeek] = useState<WeekdaySchedule[]>([])
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [stranded, setStranded] = useState<StrandedBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [newDate, setNewDate] = useState("")
  const [newClosed, setNewClosed] = useState(true)
  const [newOpen, setNewOpen] = useState("09:00")
  const [newClose, setNewClose] = useState("19:00")
  const [newReason, setNewReason] = useState("")

  const apply = useCallback((payload: { schedule: SellerSchedule | null; stranded?: StrandedBooking[] }) => {
    setWeek(payload.schedule?.semana ?? [])
    setExceptions(payload.schedule?.excepciones ?? [])
    setStranded(payload.stranded ?? [])
  }, [])

  // Applies a loaded payload. Kept separate from the fetch so the effect below
  // can own its own async body, which is what keeps setState out of the
  // synchronous effect body.
  const applyPayload = useCallback((data: SchedulePayload | null) => {
    if (!data) {
      setError("Could not load the schedule.")
      setLoading(false)
      return
    }
    setError(null)
    setSellers(data.sellers)
    setSellerId(data.schedule?.vendedorId ?? null)
    apply(data)
    setLoading(false)
  }, [apply])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      const data = await fetchSchedule()
      if (!cancelled) applyPayload(data)
    }
    void initialLoad()
    return () => { cancelled = true }
  }, [applyPayload])

  async function send(body: Record<string, unknown>, successMessage: string) {
    setSaving(true)
    setError(null)
    setNotice(null)
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sellerId }),
    })
    const data = await response.json() as { error?: string; schedule?: SellerSchedule; stranded?: StrandedBooking[] }
    if (!response.ok) {
      setError(data.error || "Could not save the schedule.")
    } else {
      apply({ schedule: data.schedule ?? null, stranded: data.stranded })
      setNotice(successMessage)
    }
    setSaving(false)
  }

  function updateDay(diaSemana: number, patch: Partial<WeekdaySchedule>) {
    setWeek((current) => current.map((day) => day.diaSemana === diaSemana ? { ...day, ...patch } : day))
    setNotice(null)
  }

  const totalWeeklySlots = week.reduce((sum, day) => sum + slotCount(day), 0)

  if (loading) {
    return <Card><CardContent className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="animate-spin" />Loading schedule…</CardContent></Card>
  }

  if (!sellerId) {
    return (
      <Alert>
        <CalendarOff />
        <AlertTitle>No active seller</AlertTitle>
        <AlertDescription>Opening hours belong to a seller. Activate one before setting a schedule.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive"><AlertTriangle /><AlertTitle>Could not save</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert><Save /><AlertTitle>Saved</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}

      {stranded.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{stranded.length} booking{stranded.length === 1 ? "" : "s"} now fall outside opening hours</AlertTitle>
          <AlertDescription>
            <p className="mb-2">These appointments were booked before the schedule changed. They were kept rather than deleted, because a customer is expecting them — contact them to move or cancel.</p>
            <ul className="space-y-1 text-xs">
              {stranded.map((booking) => (
                <li key={`${booking.fecha}-${booking.hora}-${booking.cliente}`}>
                  <strong>{booking.fecha} {booking.hora}</strong> · {booking.cliente} · {booking.estado}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {sellers.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Seller</CardTitle><CardDescription>Each seller keeps their own opening hours.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {sellers.map((seller) => (
              <Button
                key={seller.id}
                size="sm"
                variant={seller.id === sellerId ? "default" : "outline"}
                onClick={() => { setLoading(true); setSellerId(seller.id); void fetchSchedule(seller.id).then(applyPayload) }}
              >
                {seller.nombre}{seller.tienda ? ` · ${seller.tienda}` : ""}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Weekly opening hours</CardTitle>
          <CardDescription>
            The recurring week that generates bookable slots. Each open hour becomes one slot, so 09:00–19:00 is ten appointments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {week.map((day) => (
            <div key={day.diaSemana} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="flex min-w-40 items-center gap-3">
                <Checkbox
                  id={`open-${day.diaSemana}`}
                  checked={day.abierto}
                  onCheckedChange={(checked) => updateDay(day.diaSemana, { abierto: checked === true })}
                />
                <Label htmlFor={`open-${day.diaSemana}`} className="cursor-pointer font-medium">{WEEKDAYS[day.diaSemana]}</Label>
              </div>
              {day.abierto ? (
                <div className="flex flex-wrap items-center gap-2">
                  <HourSelect label={`${WEEKDAYS[day.diaSemana]} opening time`} value={day.horaApertura} disabled={saving} onChange={(value) => updateDay(day.diaSemana, { horaApertura: value })} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <HourSelect label={`${WEEKDAYS[day.diaSemana]} closing time`} value={day.horaCierre} disabled={saving} onChange={(value) => updateDay(day.diaSemana, { horaCierre: value })} />
                </div>
              ) : (
                <Badge variant="secondary">Closed</Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {slotCount(day) > 0 ? `${slotCount(day)} slot${slotCount(day) === 1 ? "" : "s"}` : "no slots"}
              </span>
            </div>
          ))}
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{totalWeeklySlots} bookable slots per week</p>
            <Button disabled={saving} onClick={() => void send({ action: "saveWeek", semana: week }, "Weekly hours updated. Slots regenerate on the next booking page load.")}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}Save weekly hours
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Date exceptions</CardTitle>
          <CardDescription>Holidays and one-off closures. An exception overrides the weekly hours for that date only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="exception-date">Date</Label>
              <Input id="exception-date" type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className="w-44" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox id="exception-closed" checked={newClosed} onCheckedChange={(checked) => setNewClosed(checked === true)} />
              <Label htmlFor="exception-closed" className="cursor-pointer">Closed all day</Label>
            </div>
            {!newClosed && (
              <div className="flex items-center gap-2 pb-1">
                <HourSelect label="Exception opening time" value={newOpen} disabled={saving} onChange={setNewOpen} />
                <span className="text-sm text-muted-foreground">to</span>
                <HourSelect label="Exception closing time" value={newClose} disabled={saving} onChange={setNewClose} />
              </div>
            )}
            <div className="min-w-48 flex-1 space-y-1">
              <Label htmlFor="exception-reason">Reason</Label>
              <Input id="exception-reason" placeholder="Public holiday, outlet closed…" value={newReason} onChange={(event) => setNewReason(event.target.value)} />
            </div>
            <Button
              disabled={saving || !newDate}
              onClick={() => void send({
                action: "saveException",
                fecha: newDate,
                abierto: !newClosed,
                horaApertura: newClosed ? null : newOpen,
                horaCierre: newClosed ? null : newClose,
                motivo: newReason,
              }, "Exception saved.").then(() => { setNewDate(""); setNewReason("") })}
            >
              <Plus />Add exception
            </Button>
          </div>

          {exceptions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No upcoming exceptions. The weekly hours apply to every date.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map((exception) => (
                  <TableRow key={exception.id}>
                    <TableCell className="font-medium">{exception.fecha}</TableCell>
                    <TableCell>
                      {exception.abierto
                        ? <Badge variant="outline">{exception.horaApertura && exception.horaCierre ? `${exception.horaApertura}–${exception.horaCierre}` : "Weekly hours"}</Badge>
                        : <Badge variant="secondary">Closed</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{exception.motivo || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" aria-label={`Remove exception on ${exception.fecha}`} disabled={saving} onClick={() => void send({ action: "deleteException", id: exception.id }, "Exception removed.")}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
