"use client"

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Minus,
  Package,
  Plus,
  ReceiptText,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ModeToggle } from "@/components/mode-toggle"
import { BoxManifest } from "@/components/box-manifest"
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useSession } from "@/lib/hooks/useSession"
import { ConsolidatedBoxManifest, EnvioEstado, SesionCompra, TimeSlot } from "@/lib/types"
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils"

type DashboardTab = "overview" | "bookings" | "customers" | "sessions"
type BookingFilter = "all" | "today" | "upcoming" | "payment_pending" | "in_progress" | "completed"

interface SellerPanelProps {
  sessionId: string | null
}

interface StaffNotification {
  id: string
  title: string
  message: string
  read: boolean
  createdAt: string
}

const pageSize = 4
const deliverySteps: { status: EnvioEstado; label: string }[] = [
  { status: "preparacion", label: "Create individual shipment" },
]

function SessionStatus({ session }: { session: SesionCompra }) {
  if (session.estado === "completada") return (
    <Badge variant="secondary" className="bg-sky-100 text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300">Closed</Badge>
  )
  if (session.startedAt) return <Badge>Live</Badge>
  if (session.bookingEstado === "pendiente_pago") return <Badge variant="outline">Payment pending</Badge>
  if (session.bookingEstado === "cancelada") return <Badge variant="destructive">Cancelled</Badge>
  return <Badge variant="secondary">Scheduled</Badge>
}

function BookingStage({ session }: { session: SesionCompra }) {
  if (session.bookingEstado === "cancelada") return <Badge variant="destructive">Cancelled</Badge>
  if (session.bookingEstado === "pendiente_pago") return <Badge variant="outline">Awaiting payment</Badge>
  if (session.estado === "completada") return <Badge variant="secondary">Appointment completed</Badge>
  if (session.startedAt) return <Badge>In progress</Badge>
  return <Badge variant="secondary">Scheduled</Badge>
}

function OrderStage({ session }: { session: SesionCompra }) {
  if (session.estado === "en_progreso") return <Badge variant="secondary">Building cart</Badge>
  if (session.montoPagado65 <= 0) return <Badge variant="outline">Awaiting 65% payment</Badge>
  if (!session.envio) return <Badge variant="secondary">Create shipment</Badge>
  if (session.envio.estado === "preparacion") return <Badge variant="secondary">Ready for consolidated box</Badge>
  if (session.envio.estado === "en_transito") return <Badge variant="secondary">In transit</Badge>
  if (session.envio.estado === "en_aduanas") return <Badge variant="secondary">In transit</Badge>
  if (session.envio.estado === "recibido_equipo_local" && session.montoPagado35 <= 0) return <Badge variant="outline">Awaiting final 35%</Badge>
  if (session.montoPagado35 <= 0) return <Badge variant="outline">Awaiting final 35%</Badge>
  return <Badge><CheckCircle2 />Completed</Badge>
}

function sellerActionLabel(session: SesionCompra): string {
  if (session.estado === "en_progreso") return "Manage live cart"
  if (session.montoPagado65 <= 0) return "View invoice"
  if (!session.envio) return "Create individual shipment"
  if (session.envio.estado === "preparacion") return "Review package for boxing"
  if (session.envio.estado === "en_transito" || session.envio.estado === "en_aduanas") return "View shipment tracking"
  if (session.envio.estado === "recibido_equipo_local") return "View local-team progress"
  return "View completed order"
}

function TablePagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <PaginationRoot className="justify-between px-4 py-4">
      <p className="text-xs text-muted-foreground">Page {Math.min(page, pages)} of {pages} · {total} records</p>
      <PaginationContent className="ml-auto">
        <PaginationItem><PaginationPrevious href="#" aria-disabled={page <= 1} className={cn(page <= 1 && "pointer-events-none opacity-50")} onClick={(event) => { event.preventDefault(); if (page > 1) onChange(page - 1) }} /></PaginationItem>
        <PaginationItem><PaginationNext href="#" aria-disabled={page >= pages} className={cn(page >= pages && "pointer-events-none opacity-50")} onClick={(event) => { event.preventDefault(); if (page < pages) onChange(page + 1) }} /></PaginationItem>
      </PaginationContent>
    </PaginationRoot>
  )
}

function DashboardCard({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <Card><CardContent className="flex items-center gap-4 py-5"><span className="flex size-11 items-center justify-center rounded-xl bg-muted">{icon}</span><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div></CardContent></Card>
  )
}

async function createCustomerUrl(sessionId: string): Promise<string> {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "createCustomerAccess", sessionId }),
  })
  const result = await response.json() as { accessToken?: string; error?: string }
  if (!response.ok || !result.accessToken) throw new Error(result.error || "Unable to create customer link")
  return `${window.location.origin}/access/session/${sessionId}?token=${encodeURIComponent(result.accessToken)}`
}

function RowActions({ session }: { session: SesionCompra }) {
  async function openCustomerView() {
    const target = window.open("about:blank", "_blank")
    try {
      const url = await createCustomerUrl(session.id)
      if (target) target.location.href = url
      else window.location.href = url
    } catch {
      target?.close()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${session.cliente.nombre}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href={`/seller?sessionId=${session.id}`}>{sellerActionLabel(session)}</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openCustomerView()}>Open customer view</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SellerPanel({ sessionId }: SellerPanelProps) {
  const { session, loading, error, addProduct, updateQuantity, removeProduct, close, start, updateDeliveryStatus } = useSession(sessionId)
  const [sessions, setSessions] = useState<SesionCompra[]>([])
  const [notifications, setNotifications] = useState<StaffNotification[]>([])
  const [boxes, setBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview")
  const [page, setPage] = useState(1)
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("upcoming")
  const [bookingSearch, setBookingSearch] = useState("")
  const [bookingFilterDate, setBookingFilterDate] = useState("")
  const [selectedShipments, setSelectedShipments] = useState<string[]>([])
  const [boxCourier, setBoxCourier] = useState("")
  const [boxTracking, setBoxTracking] = useState("")
  const [shippingMessage, setShippingMessage] = useState("")
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingDate, setBookingDate] = useState("")
  const [selectedSellerSlotId, setSelectedSellerSlotId] = useState("")
  const [bookingError, setBookingError] = useState("")
  const [bookingSaving, setBookingSaving] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [actionError, setActionError] = useState("")

  useEffect(() => {
    if (sessionId) return
    async function loadDashboard() {
      const [sessionsResponse, slotsResponse, notificationsResponse, shippingResponse] = await Promise.all([
        fetch("/api/sessions", { cache: "no-store" }),
        fetch("/api/slots", { cache: "no-store" }),
        fetch("/api/notifications", { cache: "no-store" }),
        fetch("/api/shipping", { cache: "no-store" }),
      ])
      if (sessionsResponse.ok) setSessions(((await sessionsResponse.json()) as { sessions: SesionCompra[] }).sessions)
      if (slotsResponse.ok) setSlots(((await slotsResponse.json()) as { slots: TimeSlot[] }).slots)
      if (notificationsResponse.ok) setNotifications(((await notificationsResponse.json()) as { notifications: StaffNotification[] }).notifications)
      if (shippingResponse.ok) setBoxes(((await shippingResponse.json()) as { boxes: ConsolidatedBoxManifest[] }).boxes)
    }
    void loadDashboard()
    const timer = window.setInterval(() => void loadDashboard(), 5000)
    return () => window.clearInterval(timer)
  }, [sessionId])

  useEffect(() => {
    if (!session || session.estado !== "en_progreso") return
    const timer = window.setInterval(() => {
      const origin = session.startedAt ? new Date(session.startedAt).getTime() : Date.now()
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - origin) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [session])

  const customers = useMemo(() => {
    const unique = new Map<string, SesionCompra>()
    sessions.forEach((item) => { if (!unique.has(item.clienteId)) unique.set(item.clienteId, item) })
    return [...unique.values()]
  }, [sessions])

  const bookingDates = [...new Set(slots.map((slot) => slot.date))]
  const activeBookingDate = bookingDate || bookingDates[0] || ""
  const bookingSlots = slots.filter((slot) => slot.date === activeBookingDate)
  const liveCount = sessions.filter((item) => item.estado === "en_progreso" && item.startedAt).length
  const closedCount = sessions.filter((item) => item.estado === "completada").length
  const filteredBookings = useMemo(() => {
    const now = new Date()
    const today = now.toLocaleDateString("en-CA")
    const search = bookingSearch.trim().toLowerCase()
    return sessions
      .filter((item) => {
        const scheduled = new Date(item.fechaHoraProgramada || item.fechaInicio)
        const date = scheduled.toLocaleDateString("en-CA")
        const matchesSearch = !search || [item.cliente.nombre, item.cliente.email, item.cliente.telefono]
          .some((value) => value.toLowerCase().includes(search))
        const matchesDate = !bookingFilterDate || date === bookingFilterDate
        const matchesQuickFilter = bookingFilter === "all"
          || (bookingFilter === "today" && date === today)
          || (bookingFilter === "upcoming" && scheduled >= now && item.estado !== "completada" && item.bookingEstado !== "cancelada")
          || (bookingFilter === "payment_pending" && item.bookingEstado === "pendiente_pago")
          || (bookingFilter === "in_progress" && Boolean(item.startedAt) && item.estado === "en_progreso")
          || (bookingFilter === "completed" && item.estado === "completada")
        return matchesSearch && matchesDate && matchesQuickFilter
      })
      .sort((a, b) => {
        const left = new Date(a.fechaHoraProgramada || a.fechaInicio).getTime()
        const right = new Date(b.fechaHoraProgramada || b.fechaInicio).getTime()
        const leftUpcoming = left >= now.getTime()
        const rightUpcoming = right >= now.getTime()
        if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1
        return leftUpcoming ? left - right : right - left
      })
  }, [sessions, bookingFilter, bookingSearch, bookingFilterDate])
  const nextBookingId = filteredBookings.find((item) => new Date(item.fechaHoraProgramada || item.fechaInicio) >= new Date() && item.bookingEstado !== "cancelada")?.id

  function switchTab(tab: DashboardTab) {
    setActiveTab(tab)
    setPage(1)
  }

  async function markNotificationRead(id: string) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (response.ok) setNotifications((current) => current.map((item) => item.id === id ? { ...item, read: true } : item))
  }

  async function createConsolidatedBox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShippingMessage("")
    const response = await fetch("/api/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipmentIds: selectedShipments, courier: boxCourier, tracking: boxTracking }),
    })
    const result = await response.json() as { box?: { number: string }; error?: string }
    if (!response.ok) {
      setShippingMessage(result.error || "Unable to create consolidated box")
      return
    }
    setSelectedShipments([])
    setBoxCourier("")
    setBoxTracking("")
    setShippingMessage(`${result.box?.number || "Consolidated box"} dispatched to Colombia.`)
    const [sessionsResponse, shippingResponse] = await Promise.all([
      fetch("/api/sessions", { cache: "no-store" }),
      fetch("/api/shipping", { cache: "no-store" }),
    ])
    if (sessionsResponse.ok) setSessions(((await sessionsResponse.json()) as { sessions: SesionCompra[] }).sessions)
    if (shippingResponse.ok) setBoxes(((await shippingResponse.json()) as { boxes: ConsolidatedBoxManifest[] }).boxes)
  }

  async function submitSellerBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSellerSlotId) {
      setBookingError("Select an available appointment time")
      return
    }
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBookingSaving(true)
    setBookingError("")
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: form.get("nombre"), email: form.get("email"), telefono: form.get("telefono"), ciudad: form.get("ciudad"), slotId: selectedSellerSlotId }),
      })
      const data = (await response.json()) as { session?: SesionCompra; error?: string }
      if (!response.ok || !data.session) throw new Error(data.error || "Unable to create booking")
      setSessions((current) => [data.session!, ...current])
      setSlots((current) => current.map((slot) => slot.id === selectedSellerSlotId ? { ...slot, available: false } : slot))
      setBookingOpen(false)
      setBookingDate("")
      setSelectedSellerSlotId("")
      formElement.reset()
    } catch (caughtError) {
      setBookingError(caughtError instanceof Error ? caughtError.message : "Unable to create booking")
    } finally {
      setBookingSaving(false)
    }
  }

  const bookingDialog = (
    <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
      <DialogTrigger asChild><Button><Plus />Book for customer</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Create customer booking</DialogTitle></DialogHeader>
        <form onSubmit={submitSellerBooking} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="seller-name">Customer name</Label><Input id="seller-name" name="nombre" required /></div>
            <div className="space-y-2"><Label htmlFor="seller-email">Email</Label><Input id="seller-email" name="email" type="email" required /></div>
            <div className="space-y-2"><Label htmlFor="seller-phone">WhatsApp number</Label><Input id="seller-phone" name="telefono" required /></div>
            <div className="space-y-2"><Label htmlFor="seller-city">City</Label><Input id="seller-city" name="ciudad" required /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="seller-date">Date</Label><Input id="seller-date" type="date" min={bookingDates[0]} max={bookingDates[bookingDates.length - 1]} value={activeBookingDate} onChange={(event) => { setBookingDate(event.target.value); setSelectedSellerSlotId("") }} /></div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">One-hour appointment</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {bookingSlots.map((slot) => (
                <Button key={slot.id} type="button" variant={selectedSellerSlotId === slot.id ? "default" : "outline"} className="h-12 flex-col gap-0 leading-tight" disabled={!slot.available} onClick={() => setSelectedSellerSlotId(slot.id)}><span>{slot.time}</span><span className="text-[10px] font-normal opacity-70">{slot.available ? "Available" : "Booked"}</span></Button>
              ))}
            </div>
          </fieldset>
          {bookingError && <p className="text-sm text-destructive">{bookingError}</p>}
          <DialogFooter><Button type="submit" disabled={bookingSaving}>{bookingSaving ? "Creating..." : "Create booking"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  if (sessionId) {
    if (loading) return <main className="flex min-h-screen items-center justify-center">Loading session...</main>
    if (!session) return <main className="flex min-h-screen items-center justify-center px-4"><Card className="max-w-md"><CardContent className="py-10 text-center"><p className="font-semibold">Session not found</p><p className="mt-1 text-sm text-muted-foreground">{error || "This session is unavailable or your account does not have access."}</p><Button asChild className="mt-4"><Link href="/seller">Back to dashboard</Link></Button></CardContent></Card></main>

    const isActive = session.estado === "en_progreso" && Boolean(session.startedAt)
    const isWaiting = session.estado === "en_progreso" && !session.startedAt
    const scheduledAt = new Date(session.fechaHoraProgramada || session.fechaInicio)
    const canStart = isWaiting && session.bookingEstado === "confirmada"
    const nextDeliveryStep = session.envio ? undefined : deliverySteps[0]
    const activeSessionId = session.id
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0")
    async function copyCustomerLink() {
      setActionError("")
      try {
        await navigator.clipboard.writeText(await createCustomerUrl(activeSessionId))
      } catch (caughtError) {
        setActionError(caughtError instanceof Error ? caughtError.message : "Unable to create customer link")
      }
    }

    async function submitProduct(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const formElement = event.currentTarget
      const form = new FormData(formElement)
      setActionError("")
      try {
        await addProduct({ nombre: String(form.get("nombre") || ""), sku: String(form.get("sku") || ""), precio: Number(form.get("precio")), cantidad: Number(form.get("cantidad")) || 1, notas: String(form.get("notas") || "") })
        formElement.reset()
      } catch (caughtError) {
        setActionError(caughtError instanceof Error ? caughtError.message : "Unable to add product")
      }
    }

    async function beginSession() {
      setActionError("")
      try {
        await start()
      } catch (caughtError) {
        setActionError(caughtError instanceof Error ? caughtError.message : "Unable to start session")
      }
    }

    async function createShipment() {
      setActionError("")
      try {
        await updateDeliveryStatus("preparacion")
      } catch (caughtError) {
        setActionError(caughtError instanceof Error ? caughtError.message : "Unable to update delivery")
      }
    }

    return (
      <SidebarProvider>
        <SellerSidebar active="sessions" onSelect={null} />
        <SidebarInset className="w-0 min-w-0">
          <header className="flex items-center justify-between border-b bg-background px-4 py-4 lg:px-8"><div className="flex items-center gap-3"><SidebarTrigger /><div><Button asChild variant="link" className="h-auto p-0 text-muted-foreground"><Link href="/seller">Seller dashboard</Link></Button><h1 className="text-xl font-bold">{session.cliente.nombre}</h1></div></div><div className="flex items-center gap-3"><span className="font-mono font-semibold"><Clock className="mr-1 inline size-4" />{isActive ? `${minutes}:${seconds}` : "Not started"}</span><ModeToggle /><Button variant="outline" size="sm" onClick={() => void copyCustomerLink()}><Copy />Customer link</Button></div></header>
          <div className="grid gap-6 p-4 lg:grid-cols-[1fr_340px] lg:p-8">
            <div className="space-y-6">
              {isWaiting && <Card><CardHeader><CardTitle>Session waiting to start</CardTitle><CardDescription>{scheduledAt.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} · {session.outlet}</CardDescription></CardHeader><CardContent className="space-y-3"><Button className="w-full" size="lg" disabled={!canStart} onClick={() => void beginSession()}><MessageCircle />Start live session</Button>{!canStart && <p className="text-center text-xs text-muted-foreground">The booking payment must be confirmed before this session can start.</p>}{actionError && <p className="text-sm text-destructive">{actionError}</p>}</CardContent></Card>}
              <Card><CardHeader><CardTitle className="text-xl">Add product</CardTitle><CardDescription>Cart changes sync to the customer screen.</CardDescription></CardHeader><CardContent><form onSubmit={submitProduct} className="grid gap-3 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label htmlFor="product-name">Product name</Label><Input id="product-name" name="nombre" required /></div><div className="space-y-2"><Label htmlFor="product-sku">SKU</Label><Input id="product-sku" name="sku" /></div><div className="space-y-2"><Label htmlFor="product-price">Price USD</Label><Input id="product-price" name="precio" type="number" min="0.01" step="0.01" required /></div><div className="space-y-2"><Label htmlFor="product-quantity">Quantity</Label><Input id="product-quantity" name="cantidad" type="number" min="1" defaultValue="1" /></div><div className="space-y-2"><Label htmlFor="product-notes">Notes</Label><Input id="product-notes" name="notas" /></div>{actionError && <p className="text-sm text-destructive sm:col-span-2">{actionError}</p>}<Button className="sm:col-span-2" disabled={!isActive}><Plus />Add to cart</Button></form></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ShoppingCart />Cart ({session.productos.length})</CardTitle></CardHeader><CardContent className="space-y-3">{session.productos.length === 0 && <p className="py-8 text-center text-muted-foreground">No products yet.</p>}{session.productos.map((product) => <div key={product.id} className="flex items-center gap-3 rounded-md bg-muted p-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.nombre}</p><p className="text-xs text-muted-foreground">{product.sku || "No SKU"}{product.notas ? ` · ${product.notas}` : ""}</p></div><Button size="icon" variant="outline" onClick={() => void updateQuantity(product.id, -1)} disabled={!isActive}><Minus /></Button><span>{product.cantidad}</span><Button size="icon" variant="outline" onClick={() => void updateQuantity(product.id, 1)} disabled={!isActive}><Plus /></Button><strong className="w-24 text-right">{formatCurrency(product.precio * product.cantidad)}</strong><Button size="icon" variant="ghost" onClick={() => void removeProduct(product.id)} disabled={!isActive}><Trash2 /></Button></div>)}</CardContent></Card>
            </div>
            <aside className="space-y-6"><Card><CardHeader><CardTitle className="text-xl">Order summary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(session.subtotal)}</span></div><div className="flex justify-between"><span>Tax 7%</span><span>{formatCurrency(session.impuesto)}</span></div><div className="flex justify-between"><span>Fee 15%</span><span>{formatCurrency(session.comision)}</span></div><div className="flex justify-between pt-3 text-lg font-bold"><span>Total</span><span>{formatCurrency(session.total)}</span></div></CardContent></Card>{session.estado === "completada" && <Card><CardHeader><CardTitle className="text-xl">Customer delivery</CardTitle><CardDescription>{session.envio ? `Current status: ${session.envio.estado.replaceAll("_", " ")}` : "Create the shipment after the customer's 65% payment is confirmed."}</CardDescription></CardHeader><CardContent className="space-y-3">{session.deliveryAddress && <div className="rounded-md bg-muted p-3 text-sm"><p className="font-medium">Confirmed delivery address</p><p className="mt-1 text-muted-foreground">{session.deliveryAddress}</p><p className="text-muted-foreground">{session.deliveryCity}, Colombia</p></div>}{session.envio?.labelCode && <div className="rounded-md border p-3 text-sm"><p className="text-xs text-muted-foreground">System-generated package label</p><p className="mt-1 font-mono font-semibold">{session.envio.labelCode}</p></div>}{nextDeliveryStep && session.montoPagado65 > 0 && <Button className="w-full" disabled={!session.deliveryAddress || !session.deliveryCity} onClick={() => void createShipment()}><Package />{nextDeliveryStep.label}</Button>}{!nextDeliveryStep && session.envio?.estado === "entregado" && <Badge><CheckCircle2 />Delivery confirmed</Badge>}{session.envio && session.envio.estado !== "entregado" && <p className="text-xs text-muted-foreground">USA operations handles consolidation. The Colombia team owns receipt, final payment, and delivery confirmation.</p>}{session.montoPagado65 <= 0 && <p className="text-xs text-muted-foreground">Waiting for the customer to confirm their address and pay 65%.</p>}{actionError && <p className="text-sm text-destructive">{actionError}</p>}</CardContent></Card>}<Button className="w-full" variant="destructive" disabled={!isActive || session.productos.length === 0} onClick={() => void close()}><X />{isActive ? "Close session and invoice" : "Session closed"}</Button></aside>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  const shoppingSessions = sessions.filter((item) => Boolean(item.startedAt) || item.estado === "completada")
  const readyShipments = shoppingSessions.filter((item) => item.envio?.estado === "preparacion" && !item.envio.cajaId)
  const source = activeTab === "customers" ? customers : activeTab === "sessions" ? shoppingSessions : activeTab === "bookings" ? filteredBookings : sessions
  const paginated = source.slice((page - 1) * pageSize, page * pageSize)
  const unreadNotifications = notifications.filter((item) => !item.read)

  return (
    <SidebarProvider>
      <SellerSidebar active={activeTab} onSelect={switchTab} />
      <SidebarInset className="w-0 min-w-0">
        <header className="flex flex-col justify-between gap-4 border-b px-4 py-5 sm:flex-row sm:items-center lg:px-8"><div className="flex items-center gap-3"><SidebarTrigger className="-ml-1" /><div><p className="text-sm text-muted-foreground">Brash3D operations</p><h1 className="text-2xl font-bold capitalize">{activeTab}</h1></div></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!unreadNotifications.length}><Bell />{unreadNotifications.length ? `${unreadNotifications.length} new` : "No new payments"}</Button><ModeToggle />{bookingDialog}</div></header>
        <div className="space-y-6 p-4 lg:p-8">
          {activeTab === "sessions" && boxes.length > 0 && <Card><CardHeader><CardTitle className="text-xl">Dispatched boxes</CardTitle><CardDescription>Open a digital manifest to verify customer packages and product breakdown.</CardDescription></CardHeader><CardContent className="space-y-3">{boxes.map((box) => <BoxManifest key={box.id} box={box} />)}</CardContent></Card>}
          {activeTab === "overview" && <>{unreadNotifications.length > 0 && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Bell />Payment notifications</CardTitle><CardDescription>Confirmed by Stripe and saved for the assigned seller.</CardDescription></CardHeader><CardContent className="space-y-2">{unreadNotifications.map((item) => <div key={item.id} className="flex flex-col justify-between gap-3 rounded-md bg-muted p-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">{item.title}</p><p className="text-sm text-muted-foreground">{item.message}</p></div><Button size="sm" variant="outline" onClick={() => void markNotificationRead(item.id)}>Mark read</Button></div>)}</CardContent></Card>}<div className="grid gap-4 md:grid-cols-3"><DashboardCard icon={<CalendarDays />} value={sessions.length} label="Total bookings" /><DashboardCard icon={<Clock />} value={liveCount} label="Live sessions" /><DashboardCard icon={<CheckCircle2 />} value={closedCount} label="Invoices created" /></div><SessionTable sessions={sessions.slice(0, 5)} title="Recent bookings" /></>}
          {activeTab === "bookings" && <TableCard title="Bookings" description="Scheduled appointments and booking-payment readiness."><div className="space-y-3 border-b px-4 pb-4"><div className="flex flex-wrap gap-2">{(["upcoming", "today", "payment_pending", "in_progress", "completed", "all"] as BookingFilter[]).map((filter) => <Button key={filter} size="sm" variant={bookingFilter === filter ? "default" : "outline"} onClick={() => { setBookingFilter(filter); setPage(1) }}>{filter.replaceAll("_", " ")}</Button>)}</div><div className="grid gap-2 sm:grid-cols-[1fr_190px_auto]"><Input aria-label="Search bookings" placeholder="Search name, phone, or email" value={bookingSearch} onChange={(event) => { setBookingSearch(event.target.value); setPage(1) }} /><Input aria-label="Filter bookings by date" type="date" value={bookingFilterDate} onChange={(event) => { setBookingFilterDate(event.target.value); setPage(1) }} /><Button variant="ghost" disabled={!bookingSearch && !bookingFilterDate} onClick={() => { setBookingSearch(""); setBookingFilterDate(""); setPage(1) }}>Clear</Button></div><p className="text-xs text-muted-foreground">{filteredBookings.length} matching booking{filteredBookings.length === 1 ? "" : "s"} · nearest upcoming first</p></div><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Booking payment</TableHead><TableHead>Appointment</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.id}><TableCell><div className="flex items-center gap-2"><p className="font-medium">{item.cliente.nombre}</p>{item.id === nextBookingId && <Badge variant="outline">Next</Badge>}</div><p className="text-xs text-muted-foreground">{item.cliente.telefono}</p></TableCell><TableCell>{item.fechaProgramada ? formatDate(item.fechaProgramada) : "—"}</TableCell><TableCell>{item.horaProgramada || "—"}</TableCell><TableCell>{item.bookingEstado === "confirmada" || item.bookingEstado === "completada" ? <Badge><CheckCircle2 />$20 paid</Badge> : <Badge variant="outline">Pending</Badge>}</TableCell><TableCell><BookingStage session={item} /></TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={filteredBookings.length} onChange={setPage} /></TableCard>}
          {activeTab === "customers" && <TableCard title="Customers" description="Customers with a booking or shopping session."><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>WhatsApp</TableHead><TableHead>City</TableHead><TableHead>Last activity</TableHead><TableHead className="text-right">Order value</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.clienteId}><TableCell><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.email}</p></TableCell><TableCell>{item.cliente.telefono}</TableCell><TableCell>{item.cliente.ciudad || item.cliente.pais}</TableCell><TableCell>{formatDateTime(item.fechaInicio)}</TableCell><TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={customers.length} onChange={setPage} /></TableCard>}
          {activeTab === "sessions" && <><Card><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Package />Consolidated shipping to Colombia</CardTitle><CardDescription>Group seller-prepared customer packages before dispatch. Courier and tracking belong to the consolidated box.</CardDescription></CardHeader><CardContent><form className="space-y-3" onSubmit={createConsolidatedBox}><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="box-courier">Courier</Label><Input id="box-courier" value={boxCourier} maxLength={255} onChange={(event) => setBoxCourier(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="box-tracking">Tracking number</Label><Input id="box-tracking" value={boxTracking} maxLength={100} onChange={(event) => setBoxTracking(event.target.value)} required /></div></div><div className="grid gap-2 sm:grid-cols-2">{readyShipments.length === 0 && <p className="text-sm text-muted-foreground sm:col-span-2">No seller-prepared shipments are waiting to be boxed.</p>}{readyShipments.map((item) => <Button key={item.envio!.id} type="button" variant={selectedShipments.includes(item.envio!.id) ? "default" : "outline"} className="justify-start" onClick={() => setSelectedShipments((current) => current.includes(item.envio!.id) ? current.filter((id) => id !== item.envio!.id) : [...current, item.envio!.id])}>{item.cliente.nombre} · {item.envio?.labelCode}</Button>)}</div><Button disabled={!selectedShipments.length}><Package />Create and dispatch box ({selectedShipments.length})</Button>{shippingMessage && <p className="text-sm text-muted-foreground">{shippingMessage}</p>}</form></CardContent></Card><TableCard title="Shopping sessions" description="Sessions that have started, including cart, invoice, payment, and fulfillment progress."><Table><TableHeader><TableRow><TableHead>Session</TableHead><TableHead>Customer</TableHead><TableHead>Shopping</TableHead><TableHead>Order stage</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.id}><TableCell className="font-mono text-xs">{item.id.slice(-8).toUpperCase()}</TableCell><TableCell>{item.cliente.nombre}</TableCell><TableCell><SessionStatus session={item} /></TableCell><TableCell><OrderStage session={item} /></TableCell><TableCell>{item.productos.length}</TableCell><TableCell>{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={shoppingSessions.length} onChange={setPage} /></TableCard></>}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function SellerSidebar({ active, onSelect }: { active: DashboardTab; onSelect: ((tab: DashboardTab) => void) | null }) {
  const router = useRouter()
  const items: { id: DashboardTab; label: string; icon: ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard /> },
    { id: "bookings", label: "Bookings", icon: <CalendarDays /> },
    { id: "customers", label: "Customers", icon: <Users /> },
    { id: "sessions", label: "Sessions", icon: <ReceiptText /> },
  ]
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.replace("/login")
    router.refresh()
  }
  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild><Link href="/seller"><span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">B3D</span><span><span className="block font-semibold">Brash3D</span><span className="block text-xs text-muted-foreground">Seller operations</span></span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu>
          {items.map((item) => <SidebarMenuItem key={item.id}>{onSelect ? <SidebarMenuButton isActive={active === item.id} tooltip={item.label} onClick={() => onSelect(item.id)}>{item.icon}<span>{item.label}</span></SidebarMenuButton> : <SidebarMenuButton isActive={active === item.id} tooltip={item.label} asChild><Link href="/seller">{item.icon}<span>{item.label}</span></Link></SidebarMenuButton>}</SidebarMenuItem>)}
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
      </SidebarContent>
      <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="Sign out" onClick={() => void logout()}><LogOut /><span>Sign out</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
    </Sidebar>
  )
}

function TableCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="overflow-hidden"><CardHeader><CardTitle className="text-xl">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="p-0 [&>div]:overflow-hidden [&_table]:table-fixed [&_th:last-child]:w-20 [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap [&_td:last-child]:text-right [&_td:last-child]:text-clip [&_td_p]:truncate">{children}</CardContent></Card>
}

function SessionTable({ sessions, title }: { sessions: SesionCompra[]; title: string }) {
  return <TableCard title={title} description="Latest bookings and live-shopping activity."><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Appointment</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{sessions.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.telefono}</p></TableCell><TableCell>{item.fechaProgramada ? `${formatDate(item.fechaProgramada)} · ${item.horaProgramada}` : formatDateTime(item.fechaInicio)}</TableCell><TableCell><SessionStatus session={item} /></TableCell><TableCell>{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table></TableCard>
}
