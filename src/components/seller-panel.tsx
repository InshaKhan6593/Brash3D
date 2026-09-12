"use client"

import { Fragment, FormEvent, ReactNode, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  CalendarDays,
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  AlertCircle,
  FileText,
  LayoutDashboard,
  Lock,
  LogOut,
  MoreHorizontal,
  Minus,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  CalendarCog,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { matchesBookingFilter, type BookingFilter } from "@/lib/booking-filters"
import { SchedulePanel } from "@/components/schedule-panel"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ModeToggle } from "@/components/mode-toggle"
import { PurchaseHistoryTable } from "@/components/purchase-history-table"
import { WhatsAppIcon } from "@/components/whatsapp-icon"
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
import { ConsolidatedBoxManifest, CustomerPurchaseHistory, EnvioEstado, SesionCompra, TimeSlot } from "@/lib/types"
import { DEFAULT_INITIAL_PERCENTAGE, finalAmount, initialAmount, isValidPercentage } from "@/lib/payment-split"
import { cn, formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/utils"

type DashboardTab = "overview" | "bookings" | "customers" | "sessions" | "shipping" | "schedule"

interface SellerPanelProps {
  sessionId: string | null
  isAdmin: boolean
}

interface StaffNotification {
  id: string
  title: string
  message: string
  read: boolean
  createdAt: string
}

interface DispatchDraft {
  shipmentIds: string[]
  courier: string
  tracking: string
}

const pageSize = 4
const deliverySteps: { status: EnvioEstado; label: string }[] = [
  { status: "preparacion", label: "Create individual shipment" },
]

function shipmentStatusLabel(status: EnvioEstado): string {
  if (status === "preparacion") return "Preparing"
  if (status === "en_transito") return "In transit"
  if (status === "en_aduanas") return "In customs"
  if (status === "recibido_equipo_local") return "Received by local team"
  if (status === "entregado") return "Delivered"
  return "Returned"
}

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

function hasInitialPayment(session: SesionCompra): boolean {
  return session.montoPagadoInicial > 0 && Boolean(session.paymentIntentInicialId)
}

function OrderStage({ session }: { session: SesionCompra }) {
  if (session.estado === "en_progreso") return <Badge variant="secondary">Building cart</Badge>
  if (!hasInitialPayment(session)) return <Badge variant="outline">Awaiting up-front payment</Badge>
  if (!session.envio) return <Badge variant="secondary">Create shipment</Badge>
  if (session.envio.estado === "preparacion") return <Badge variant="secondary">Ready for consolidated box</Badge>
  if (session.envio.estado === "en_transito") return <Badge variant="secondary">In transit</Badge>
  if (session.envio.estado === "en_aduanas") return <Badge variant="secondary">In transit</Badge>
  if (session.envio.estado === "recibido_equipo_local" && session.montoPagadoFinal <= 0) return <Badge variant="outline">Awaiting balance</Badge>
  if (session.montoPagadoFinal <= 0) return <Badge variant="outline">Awaiting balance</Badge>
  return <Badge><CheckCircle2 />Completed</Badge>
}

function sellerActionLabel(session: SesionCompra): string {
  if (session.estado === "en_progreso") return "Manage live cart"
  if (!hasInitialPayment(session)) return "Payment not completed"
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

function DashboardCard({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <Card><CardContent className="flex items-center gap-4 py-5"><span className="flex size-11 items-center justify-center rounded-xl bg-muted">{icon}</span><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div></CardContent></Card>
  )
}

function OverviewDashboard({ sessions, boxes }: { sessions: SesionCompra[]; boxes: ConsolidatedBoxManifest[] }) {
  const now = new Date()
  const today = now.toLocaleDateString("en-CA")
  const scheduledTime = (session: SesionCompra) => new Date(session.fechaHoraProgramada || session.fechaInicio)
  // Unfinished work, not only work that has yet to start — an appointment whose
  // slot time has passed but which nobody has closed is still today's business,
  // and dropping it left the panel claiming "No appointments today" during a
  // live session.
  const upcoming = sessions
    .filter((session) => session.estado !== "completada" && session.bookingEstado !== "cancelada")
    .sort((a, b) => scheduledTime(a).getTime() - scheduledTime(b).getTime())
  const todayBookings = upcoming.filter((session) => scheduledTime(session).toLocaleDateString("en-CA") === today)
  const schedule = (todayBookings.length ? todayBookings : upcoming).slice(0, 6)
  const liveCount = sessions.filter((session) => session.estado === "en_progreso").length
  const pendingBookingCount = sessions.filter((session) => session.bookingEstado === "pendiente_pago").length
  const completedCount = sessions.filter((session) => session.estado === "completada").length
  const customerCount = new Set(sessions.map((session) => session.clienteId)).size
  const orderValue = sessions.reduce((sum, session) => sum + session.total, 0)
  const collected = sessions.reduce((sum, session) => sum + session.montoPagadoInicial + session.montoPagadoFinal, 0)
  const outstanding = Math.max(0, orderValue - collected)
  const readyToShip = sessions.filter((session) => session.envio?.estado === "preparacion").length
  const awaitingFinalPayment = sessions.filter((session) => session.envio?.estado === "recibido_equipo_local" && session.montoPagadoFinal <= 0).length
  const bookingFeesCollected = sessions.filter((session) => session.bookingEstado === "confirmada" || session.bookingEstado === "completada").reduce((sum, session) => sum + session.bookingFee, 0)

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h2 className="text-xl font-semibold tracking-tight">Business overview</h2><p className="text-sm text-muted-foreground">A live view of bookings, revenue, payments, and fulfillment.</p></div>{todayBookings.length > 0 && <Badge variant="outline">{todayBookings.length} appointment{todayBookings.length === 1 ? "" : "s"} today</Badge>}</div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DashboardCard icon={<CalendarDays />} value={sessions.length} label="Total bookings" />
      <DashboardCard icon={<Clock />} value={liveCount} label="Live sessions" />
      <DashboardCard icon={<DollarSign />} value={formatCurrency(orderValue)} label="Order value" />
      <DashboardCard icon={<Users />} value={customerCount} label="Customers" />
    </div>

    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <Card><CardHeader><CardTitle>Today’s operations</CardTitle><CardDescription>{todayBookings.length ? "Appointments scheduled for today." : "No appointments today. Showing the next scheduled sessions."}</CardDescription></CardHeader><CardContent className="space-y-2">{schedule.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No upcoming sessions.</p>}{schedule.map((session) => <div key={session.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><div className="min-w-16 text-center"><p className="text-sm font-semibold">{session.horaProgramada || scheduledTime(session).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p><p className="text-[11px] text-muted-foreground">{formatDate(scheduledTime(session))}</p></div><div className="min-w-0"><p className="truncate font-medium">{session.cliente.nombre}</p><p className="truncate text-xs text-muted-foreground">{session.cliente.ciudad || session.cliente.pais} · {session.outlet || "Nike Sawgrass"}</p></div></div><div className="flex items-center justify-between gap-3 sm:justify-end"><SessionStatus session={session} /><RowActions session={session} /></div></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Payment health</CardTitle><CardDescription>Cash position across current orders.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">Collected</p><p className="text-xs text-muted-foreground">Up-front and final payments</p></div><p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(collected)}</p></div><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">Outstanding</p><p className="text-xs text-muted-foreground">Balances still due</p></div><p className="font-semibold">{formatCurrency(outstanding)}</p></div><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">Booking fees</p><p className="text-xs text-muted-foreground">Confirmed appointments</p></div><p className="font-semibold">{formatCurrency(bookingFeesCollected)}</p></div><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">Invoices closed</p><p className="text-xs text-muted-foreground">Completed shopping sessions</p></div><Badge variant="secondary">{completedCount}</Badge></div></CardContent></Card>
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Needs attention</CardTitle><CardDescription>Operational items that may need action.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"><div className="flex items-center gap-3 rounded-lg border p-3"><AlertCircle className="size-5 text-amber-600" /><div><p className="text-sm font-medium">Payment pending</p><p className="text-xs text-muted-foreground">{pendingBookingCount} booking{pendingBookingCount === 1 ? "" : "s"}</p></div></div><div className="flex items-center gap-3 rounded-lg border p-3"><Package className="size-5 text-blue-600" /><div><p className="text-sm font-medium">Ready to dispatch</p><p className="text-xs text-muted-foreground">{readyToShip} package{readyToShip === 1 ? "" : "s"}</p></div></div><div className="flex items-center gap-3 rounded-lg border p-3"><DollarSign className="size-5 text-violet-600" /><div><p className="text-sm font-medium">Final payment due</p><p className="text-xs text-muted-foreground">{awaitingFinalPayment} delivery{awaitingFinalPayment === 1 ? "" : "ies"}</p></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Consolidated boxes</CardTitle><CardDescription>Latest consolidated boxes on their way to the local teams.</CardDescription></CardHeader><CardContent className="space-y-2">{boxes.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No consolidated boxes yet.</p>}{boxes.slice(0, 4).map((box) => <div key={box.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="font-medium">{box.number}</p><p className="truncate text-xs text-muted-foreground">{box.courier || "Courier pending"} · {box.customerCount} customer{box.customerCount === 1 ? "" : "s"}</p></div><Badge variant={box.status === "recibida" ? "secondary" : "outline"}>{box.status.replaceAll("_", " ")}</Badge></div>)}</CardContent></Card>
    </div>
  </div>
}

function ShippingOperations({
  boxes,
  readyShipments,
  selectedShipments,
  courier,
  tracking,
  message,
  onCourierChange,
  onTrackingChange,
  onToggleShipment,
  onCreateBox,
  onAssignShipments,
  onDispatchBox,
}: {
  boxes: ConsolidatedBoxManifest[]
  readyShipments: SesionCompra[]
  selectedShipments: string[]
  courier: string
  tracking: string
  message: string
  onCourierChange: (value: string) => void
  onTrackingChange: (value: string) => void
  onToggleShipment: (id: string) => void
  onCreateBox: (draft: DispatchDraft) => Promise<boolean>
  onAssignShipments: (boxId: string, shipmentIds: string[]) => Promise<boolean>
  onDispatchBox: (boxId: string) => Promise<boolean>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [search, setSearch] = useState("")
  const [boxSearch, setBoxSearch] = useState("")
  const [assignmentSearch, setAssignmentSearch] = useState("")
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null)
  const [boxView, setBoxView] = useState<"details" | "assign" | "ship">("details")
  const [assignmentSelection, setAssignmentSelection] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const selectedPackages = readyShipments.filter((item) => selectedShipments.includes(item.envio!.id))
  const filteredShipments = readyShipments.filter((item) => {
    const query = search.trim().toLowerCase()
    return !query || [item.cliente.nombre, item.cliente.ciudad || "", item.envio?.labelCode || ""].some((value) => value.toLowerCase().includes(query))
  })
  const filteredBoxes = boxes.filter((box) => {
    const query = boxSearch.trim().toLowerCase()
    return !query || [box.number, box.courier || "", box.trackingNumber || "", box.status].some((value) => value.toLowerCase().includes(query))
  })
  const assignmentShipments = readyShipments.filter((item) => {
    const query = assignmentSearch.trim().toLowerCase()
    return !query || [item.cliente.nombre, item.cliente.ciudad || "", item.envio?.labelCode || ""].some((value) => value.toLowerCase().includes(query))
  })
  const activeBox = boxes.find((box) => box.id === activeBoxId) || null

  function resetCreateDialog() {
    setReviewing(false)
    setSearch("")
    setCreateOpen(false)
  }

  function openBox(box: ConsolidatedBoxManifest) {
    setActiveBoxId(box.id)
    setBoxView("details")
    setAssignmentSearch("")
    setAssignmentSelection([])
  }

  function closeBox() {
    setActiveBoxId(null)
    setBoxView("details")
    setAssignmentSelection([])
  }

  async function confirmDispatch() {
    setSaving(true)
    const success = await onCreateBox({ shipmentIds: selectedShipments, courier, tracking })
    setSaving(false)
    if (success) resetCreateDialog()
  }

  async function assignSelectedShipments() {
    if (!activeBox || assignmentSelection.length === 0) return
    setSaving(true)
    const success = await onAssignShipments(activeBox.id, assignmentSelection)
    setSaving(false)
    if (success) {
      setAssignmentSelection([])
      setAssignmentSearch("")
      setBoxView("details")
    }
  }

  async function shipActiveBox() {
    if (!activeBox) return
    setSaving(true)
    const success = await onDispatchBox(activeBox.id)
    setSaving(false)
    if (success) closeBox()
  }

  function boxStatusLabel(status: string) {
    if (status === "pendiente") return "Draft"
    if (status === "enviada") return "Shipped"
    if (status === "recibida") return "Received"
    return status.replaceAll("_", " ")
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h2 className="text-xl font-semibold tracking-tight">Shipping operations</h2><p className="text-sm text-muted-foreground">Build a dispatch box from prepared customer shipments, review the manifest, then confirm dispatch.</p></div>
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setReviewing(false) }}>
        <DialogTrigger asChild><Button><Package />Create dispatch box</Button></DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {!reviewing ? <Fragment key="compose">
            <DialogHeader><DialogTitle>Create dispatch box</DialogTitle><DialogDescription>Select unassigned shipments and save this box as a draft. Dispatch happens separately after a final review.</DialogDescription></DialogHeader>
            <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); setReviewing(true) }}>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="box-courier">Courier</Label><Input id="box-courier" value={courier} maxLength={255} onChange={(event) => onCourierChange(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="box-tracking">Tracking number</Label><Input id="box-tracking" value={tracking} maxLength={100} onChange={(event) => onTrackingChange(event.target.value)} required /></div></div>
              <div className="space-y-3"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">Unassigned shipments</p><p className="text-xs text-muted-foreground">{selectedShipments.length} selected · {readyShipments.length} ready</p></div><Input aria-label="Search shipments" placeholder="Search customer or label" value={search} onChange={(event) => setSearch(event.target.value)} className="sm:max-w-xs" /></div><div className="max-h-72 overflow-y-auto rounded-lg border">{filteredShipments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{readyShipments.length === 0 ? "No seller-prepared shipments are waiting to be boxed." : "No shipments match your search."}</p> : filteredShipments.map((item) => { const shipmentId = item.envio!.id; const checked = selectedShipments.includes(shipmentId); return <label key={shipmentId} className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-b-0 hover:bg-muted/50"><input type="checkbox" checked={checked} onChange={() => onToggleShipment(shipmentId)} className="mt-1 size-4 accent-primary" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.cliente.nombre}</span><span className="font-mono text-xs text-muted-foreground">{item.envio?.labelCode}</span></span><span className="mt-1 block text-xs text-muted-foreground">{item.cliente.ciudad || item.cliente.pais} · {item.productos.reduce((sum, product) => sum + product.cantidad, 0)} item{item.productos.reduce((sum, product) => sum + product.cantidad, 0) === 1 ? "" : "s"} · {item.productos.map((product) => `${product.nombre} × ${product.cantidad}`).join(", ") || "No products"}</span></span></label> })}</div></div>
              <DialogFooter><Button type="button" variant="outline" onClick={resetCreateDialog}>Cancel</Button><Button type="submit" disabled={!selectedShipments.length || !courier.trim() || !tracking.trim()}>Review dispatch ({selectedShipments.length})</Button></DialogFooter>
            </form>
          </Fragment> : <Fragment key="review">
            <DialogHeader><DialogTitle>Review new dispatch box</DialogTitle><DialogDescription>Check the customer and product breakdown before creating this editable draft box.</DialogDescription></DialogHeader>
            <div className="space-y-4"><div className="grid gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Courier</p><p className="font-medium">{courier}</p></div><div><p className="text-xs text-muted-foreground">Tracking</p><p className="font-mono font-medium">{tracking}</p></div></div><div className="rounded-lg border"><div className="border-b px-4 py-3"><p className="font-medium">Box contents</p><p className="text-xs text-muted-foreground">{selectedPackages.length} customer shipment{selectedPackages.length === 1 ? "" : "s"}</p></div><div className="divide-y">{selectedPackages.map((item) => <div key={item.envio!.id} className="p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.ciudad || item.cliente.pais} · {item.envio?.labelCode}</p></div><span className="text-sm font-medium">{formatCurrency(item.total)}</span></div><div className="mt-3 space-y-1 text-sm text-muted-foreground">{item.productos.map((product) => <div key={product.id} className="flex justify-between gap-3"><span>{product.nombre} × {product.cantidad}</span><span>{formatCurrency(product.precio * product.cantidad)}</span></div>)}</div></div>)}</div></div></div>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setReviewing(false)} disabled={saving}>Back</Button><Button type="button" onClick={() => void confirmDispatch()} disabled={saving}>{saving ? "Creating…" : "Create draft box"}</Button></DialogFooter>
          </Fragment>}
        </DialogContent>
      </Dialog>
    </div>
    {message && !createOpen && <p className="text-sm text-muted-foreground">{message}</p>}
    <TableCard title="Dispatch boxes" description="Review box contents and dispatch draft boxes only after the final confirmation."><div className="border-b px-4 py-4"><Input aria-label="Search dispatch boxes" placeholder="Filter by box number, tracking, courier, or status" value={boxSearch} onChange={(event) => setBoxSearch(event.target.value)} /></div>{filteredBoxes.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted-foreground">{boxes.length === 0 ? "No dispatch boxes created yet." : "No dispatch boxes match this filter."}</p> : <Table><TableHeader><TableRow><TableHead>Box</TableHead><TableHead>Courier</TableHead><TableHead>Tracking</TableHead><TableHead>Contents</TableHead><TableHead>Status</TableHead><TableHead className="w-28 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredBoxes.map((box) => <TableRow key={box.id} className="cursor-pointer" onClick={() => openBox(box)}><TableCell><p className="font-medium">{box.number}</p><p className="text-xs text-muted-foreground">{formatDateTime(box.createdAt)}</p></TableCell><TableCell>{box.courier || "—"}</TableCell><TableCell className="font-mono text-xs">{box.trackingNumber || "—"}</TableCell><TableCell>{box.customerCount} customer{box.customerCount === 1 ? "" : "s"} · {box.totalUnits} unit{box.totalUnits === 1 ? "" : "s"}</TableCell><TableCell><Badge variant={box.status === "enviada" ? "secondary" : "outline"}>{boxStatusLabel(box.status)}</Badge></TableCell><TableCell className="text-right">{box.status === "pendiente" ? <Button type="button" size="sm" onClick={(event) => { event.stopPropagation(); openBox(box); setBoxView("ship") }}>Ship</Button> : <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openBox(box) }}>Open</Button>}</TableCell></TableRow>)}</TableBody></Table>}</TableCard>
    <Dialog open={Boolean(activeBox)} onOpenChange={(open) => { if (!open) closeBox() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {activeBox && boxView === "details" && <>
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{activeBox.number}<Badge variant={activeBox.status === "enviada" ? "secondary" : "outline"}>{boxStatusLabel(activeBox.status)}</Badge></DialogTitle><DialogDescription>{activeBox.courier || "Courier pending"} · {activeBox.trackingNumber || "Tracking pending"} · {activeBox.customerCount} customers · {activeBox.totalUnits} units</DialogDescription></DialogHeader>
          <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Session ID</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader><TableBody>{activeBox.packages.map((item) => <TableRow key={item.sessionId}><TableCell><p className="font-medium">{item.customerName}</p><p className="text-xs text-muted-foreground">{item.deliveryCity || "City pending"}</p></TableCell><TableCell className="font-mono text-xs">{item.sessionId}</TableCell><TableCell className="min-w-64 text-sm">{item.products.map((product) => `${product.name} × ${product.quantity}`).join(", ") || "No products"}</TableCell><TableCell className="text-right font-medium">{formatCurrency(item.remainingBalance)}</TableCell></TableRow>)}</TableBody></Table></div>
          <DialogFooter>{activeBox.status === "pendiente" && <><Button type="button" variant="outline" onClick={() => setBoxView("assign")}>Assign shipments</Button><Button type="button" onClick={() => setBoxView("ship")} disabled={!activeBox.packages.length}>Ship box</Button></>}</DialogFooter>
        </>}
        {activeBox && boxView === "assign" && <>
          <DialogHeader><DialogTitle>Assign shipments to {activeBox.number}</DialogTitle><DialogDescription>Only shipments still marked as unassigned are shown. A shipment already attached to another box cannot be selected.</DialogDescription></DialogHeader>
          <div className="space-y-3"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><p className="text-sm text-muted-foreground">{assignmentSelection.length} selected · {readyShipments.length} unassigned</p><Input aria-label="Search unassigned shipments" placeholder="Search customer or label" value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} className="sm:max-w-xs" /></div><div className="max-h-80 overflow-y-auto rounded-lg border">{assignmentShipments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No unassigned shipments match this search.</p> : assignmentShipments.map((item) => { const shipmentId = item.envio!.id; const checked = assignmentSelection.includes(shipmentId); return <label key={shipmentId} className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-b-0 hover:bg-muted/50"><input type="checkbox" checked={checked} onChange={() => setAssignmentSelection((current) => checked ? current.filter((id) => id !== shipmentId) : [...current, shipmentId])} className="mt-1 size-4 accent-primary" /><span className="min-w-0 flex-1"><span className="flex flex-wrap justify-between gap-2"><span className="font-medium">{item.cliente.nombre}</span><span className="font-mono text-xs text-muted-foreground">{item.envio?.labelCode}</span></span><span className="mt-1 block text-xs text-muted-foreground">{item.productos.map((product) => `${product.nombre} × ${product.cantidad}`).join(", ") || "No products"}</span></span></label> })}</div></div>
          {message && <p className="text-sm text-destructive">{message}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setBoxView("details")} disabled={saving}>Back</Button><Button type="button" onClick={() => void assignSelectedShipments()} disabled={saving || assignmentSelection.length === 0}>{saving ? "Assigning…" : `Assign selected (${assignmentSelection.length})`}</Button></DialogFooter>
        </>}
        {activeBox && boxView === "ship" && <>
          <DialogHeader><DialogTitle>Final shipping review</DialogTitle><DialogDescription>Review this manifest carefully. Shipping locks the box and cannot be undone.</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"><p className="font-semibold text-destructive">This action cannot be reverted</p><p className="mt-1 text-muted-foreground">After confirmation, the shipments will be marked in transit and no more assignments can be added.</p></div><div className="grid gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Box</p><p className="font-medium">{activeBox.number}</p></div><div><p className="text-xs text-muted-foreground">Courier</p><p className="font-medium">{activeBox.courier || "—"}</p></div><div><p className="text-xs text-muted-foreground">Tracking</p><p className="font-mono font-medium">{activeBox.trackingNumber || "—"}</p></div></div><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Session ID</TableHead><TableHead>Items</TableHead></TableRow></TableHeader><TableBody>{activeBox.packages.map((item) => <TableRow key={item.sessionId}><TableCell className="font-medium">{item.customerName}</TableCell><TableCell className="font-mono text-xs">{item.sessionId}</TableCell><TableCell className="min-w-64">{item.products.map((product) => `${product.name} × ${product.quantity}`).join(", ")}</TableCell></TableRow>)}</TableBody></Table></div></div>
          {message && <p className="text-sm text-destructive">{message}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => setBoxView("details")} disabled={saving}>Back</Button><Button type="button" variant="destructive" onClick={() => void shipActiveBox()} disabled={saving}>{saving ? "Shipping…" : "Confirm and ship"}</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </div>
}

function CustomerPurchaseHistoryDetail({ history, loading, error, onBack }: { history: CustomerPurchaseHistory | null; loading: boolean; error: string; onBack: () => void }) {
  return <div className="space-y-6">
    <div className="space-y-3">
      <Button type="button" variant="ghost" size="sm" className="-ml-3" onClick={onBack}><ArrowLeft />Back to customers</Button>
      <div>
        <p className="text-sm text-muted-foreground">Customer record</p>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{history?.customer.name || "Purchase history"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Review completed orders, payment progress, and shipment details.</p>
      </div>
    </div>

    {loading && <Card><CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">Loading customer history...</CardContent></Card>}
    {error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Unable to load history</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {history && <>
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</p><p className="mt-1 font-medium">{history.customer.name}</p></div>
          <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Referral code</p><p className="mt-1 font-mono text-sm font-semibold">{history.customer.referralCode}</p></div>
          <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available credit</p><p className="mt-1 font-semibold">{formatCurrency(history.availableReferralCredit)} <span className="text-sm font-normal text-muted-foreground">({history.availableReferralRewards} reward{history.availableReferralRewards === 1 ? "" : "s"})</span></p></div>
        </CardContent>
      </Card>
      <PurchaseHistoryTable history={history} />
    </>}
  </div>
}

function ReopenSessionDialog({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function confirm() {
    setSaving(true)
    setError("")
    try {
      await onConfirm()
      setOpen(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to reopen session")
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setError("") }}>
    <DialogTrigger asChild><Button type="button" variant="outline"><Pencil />Reopen for correction</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Reopen this order for correction?</DialogTitle><DialogDescription>This returns the session to edit mode so the cart can be corrected before the customer pays the invoice.</DialogDescription></DialogHeader>
      <Alert><Lock /><AlertTitle>Admin-only action</AlertTitle><AlertDescription>Reopening is recorded in the audit log. It is unavailable after payment, shipment creation, or an active payment checkout.</AlertDescription></Alert>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button type="button" onClick={() => void confirm()} disabled={saving}>{saving ? "Reopening…" : "Reopen session"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function ReadOnlyOrderDetails({ session, isAdmin, onReopen }: { session: SesionCompra; isAdmin: boolean; onReopen: () => Promise<void> }) {
  const canReopen = isAdmin && session.estado === "completada" && session.montoPagadoInicial <= 0 && !session.paymentIntentInicialId && !session.checkoutSessionInicialId && !session.envio
  return <Card>
    <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
      <div><CardTitle className="flex items-center gap-2 text-xl"><Lock className="size-5" />Order details</CardTitle><CardDescription>This shopping session is closed and the invoice total is locked.</CardDescription></div>
      <Badge variant="secondary" className="shrink-0">Read only</Badge>
    </CardHeader>
    <CardContent className="p-0">
      {session.productos.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">No products were recorded for this session.</p> : <Table className="w-full table-fixed"><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="hidden sm:table-cell">SKU</TableHead><TableHead className="w-16 text-right">Qty</TableHead><TableHead className="w-28 text-right">Unit price</TableHead><TableHead className="w-28 text-right">Line total</TableHead></TableRow></TableHeader><TableBody>{session.productos.map((product) => <TableRow key={product.id}><TableCell className="min-w-0"><p className="truncate font-medium" title={product.nombre}>{product.nombre}</p>{product.notas && <p className="truncate text-xs text-muted-foreground" title={product.notas}>{product.notas}</p>}</TableCell><TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{product.sku || "—"}</TableCell><TableCell className="text-right">{product.cantidad}</TableCell><TableCell className="whitespace-nowrap text-right text-sm">{formatCurrency(product.precio)}</TableCell><TableCell className="whitespace-nowrap text-right font-medium">{formatCurrency(product.precio * product.cantidad)}</TableCell></TableRow>)}</TableBody></Table>}
      <div className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Closed {session.fechaFin ? formatDateTime(session.fechaFin) : "after the live session"}. Payment and shipping continue separately.</p>{canReopen && <ReopenSessionDialog onConfirm={onReopen} />}</div>
    </CardContent>
  </Card>
}

function CloseSessionDialog({ session, open, onOpenChange, onConfirm, isActive }: { session: SesionCompra; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (initialPercentage: number) => Promise<void>; isActive: boolean }) {
  const [percentage, setPercentage] = useState(String(session.porcentajeInicial || DEFAULT_INITIAL_PERCENTAGE))

  if (!isActive) return null

  const subtotal = session.productos.reduce((sum, product) => sum + product.precio * product.cantidad, 0)
  const tax = subtotal * session.tasaImpuesto
  const fee = subtotal * session.tasaComision
  const total = subtotal + tax + fee

  const parsed = Number(percentage)
  const valid = isValidPercentage(parsed)
  const upFront = valid ? initialAmount(total, parsed) : 0
  const onDelivery = valid ? finalAmount(total, parsed) : 0

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger asChild><Button className="w-full" variant="destructive" disabled={session.productos.length === 0}><X />Close session and invoice</Button></DialogTrigger>
    {/*
      A pinned header and footer with only the middle scrolling. The whole
      dialog used to be one `overflow-y-auto` box, so on a laptop-height screen
      the title scrolled out of view and Confirm sat below the fold with no
      sign it was there.
    */}
    <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
      <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 text-left"><DialogTitle>Close session and create invoice?</DialogTitle><DialogDescription>This action locks the cart totals and starts the customer’s payment step. Check the invoice and the split before confirming.</DialogDescription></DialogHeader>

      <div className="dialog-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
      <div className="space-y-3 rounded-lg bg-muted/60 p-4 text-sm"><div className="flex justify-between gap-4"><span>Items</span><span className="font-medium">{session.productos.reduce((sum, product) => sum + product.cantidad, 0)}</span></div><div className="flex justify-between gap-4"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div><div className="flex justify-between gap-4"><span>Florida tax ({formatPercent(session.tasaImpuesto)})</span><span>{formatCurrency(tax)}</span></div><div className="flex justify-between gap-4"><span>Brash3D fee ({formatPercent(session.tasaComision)})</span><span>{formatCurrency(fee)}</span></div><div className="flex justify-between gap-4 border-t pt-3 text-base font-bold"><span>Total invoice</span><span>{formatCurrency(total)}</span></div></div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="initial-percentage">Paid up front</Label>
          <p className="text-xs text-muted-foreground">Choose how much this customer pays now. The rest is collected on delivery.</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[100, 85, 65, 50].map((preset) => (
            <Button key={preset} type="button" size="sm" variant={parsed === preset ? "default" : "outline"} onClick={() => setPercentage(String(preset))}>{preset}%</Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input id="initial-percentage" type="number" min="1" max="100" step="1" inputMode="numeric" className="h-9 w-24" value={percentage} onChange={(event) => setPercentage(event.target.value)} />
          <span className="text-sm text-muted-foreground">% up front</span>
        </div>
        {!valid ? <p className="text-sm text-destructive">Enter a percentage between 1 and 100.</p> : <div className="space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Customer pays now</span><span className="font-semibold">{formatCurrency(upFront)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">{onDelivery > 0 ? "Collected on delivery" : "Nothing to collect on delivery"}</span><span className="font-semibold">{formatCurrency(onDelivery)}</span></div>
        </div>}
      </div>

      <div className="space-y-1 border-t pt-4 text-sm"><p className="font-medium">Products</p><div className="space-y-1 text-muted-foreground">{session.productos.map((product) => <p key={product.id}>{product.nombre} × {product.cantidad}</p>)}</div></div>
      </div>

      <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={!valid} onClick={() => void onConfirm(parsed)}>Confirm and create invoice</Button></DialogFooter>
    </DialogContent>
  </Dialog>
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

function RowActions({ session, onViewHistory }: { session: SesionCompra; onViewHistory?: (customerId: string) => void }) {
  async function generateCustomerAccessLink() {
    try {
      const url = await createCustomerUrl(session.id)
      await navigator.clipboard.writeText(url)
    } catch {
      // Open customer view remains available when clipboard access is blocked.
    }
  }

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
        {onViewHistory && <DropdownMenuItem onSelect={() => onViewHistory(session.clienteId)}>View purchase history</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => void generateCustomerAccessLink()}>Generate customer access link</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openCustomerView()}>Open customer view</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SellerPanel({ sessionId, isAdmin }: SellerPanelProps) {
  const { session, loading, error, addProduct, updateQuantity, removeProduct, close, reopenForCorrection, start, updateDeliveryStatus } = useSession(sessionId)
  const [sessions, setSessions] = useState<SesionCompra[]>([])
  const [notifications, setNotifications] = useState<StaffNotification[]>([])
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null)
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [boxes, setBoxes] = useState<ConsolidatedBoxManifest[]>([])
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview")
  const [page, setPage] = useState(1)
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("upcoming")
  const [bookingSearch, setBookingSearch] = useState("")
  const [bookingFilterDate, setBookingFilterDate] = useState("")
  const [sessionSearch, setSessionSearch] = useState("")
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
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [shipmentCodeCopied, setShipmentCodeCopied] = useState(false)
  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(null)
  const [customerHistory, setCustomerHistory] = useState<CustomerPurchaseHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")

  async function openCustomerHistory(customerId: string) {
    setHistoryCustomerId(customerId)
    setHistoryLoading(true)
    setHistoryError("")
    setCustomerHistory(null)
    try {
      const response = await fetch(`/api/customer-history?customerId=${encodeURIComponent(customerId)}`, { cache: "no-store" })
      const data = await response.json() as { history?: CustomerPurchaseHistory; error?: string }
      if (!response.ok || !data.history) throw new Error(data.error || "Unable to load purchase history")
      setCustomerHistory(data.history)
    } catch (caughtError) {
      setHistoryError(caughtError instanceof Error ? caughtError.message : "Unable to load purchase history")
    } finally {
      setHistoryLoading(false)
    }
  }

  function closeCustomerHistory() {
    setHistoryCustomerId(null)
    setCustomerHistory(null)
    setHistoryError("")
  }

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
      if (notificationsResponse.ok) {
        const nextNotifications = ((await notificationsResponse.json()) as { notifications: StaffNotification[] }).notifications
        setNotifications(nextNotifications)
        setActiveNotificationId((current) => current || nextNotifications.find((item) => !item.read && !dismissedNotificationIds.includes(item.id))?.id || null)
      }
      if (shippingResponse.ok) setBoxes(((await shippingResponse.json()) as { boxes: ConsolidatedBoxManifest[] }).boxes)
    }
    void loadDashboard()
    const timer = window.setInterval(() => void loadDashboard(), 5000)
    return () => window.clearInterval(timer)
  }, [dismissedNotificationIds, sessionId])

  useEffect(() => {
    if (!activeNotificationId) return
    const notificationId = activeNotificationId
    const timer = window.setTimeout(() => {
      setDismissedNotificationIds((current) => current.includes(notificationId) ? current : [...current, notificationId])
      setActiveNotificationId(null)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [activeNotificationId])

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
  const filteredBookings = useMemo(() => {
    const now = new Date()
    const search = bookingSearch.trim().toLowerCase()
    return sessions
      .filter((item) => {
        const scheduled = new Date(item.fechaHoraProgramada || item.fechaInicio)
        const date = scheduled.toLocaleDateString("en-CA")
        const matchesSearch = !search || [item.cliente.nombre, item.cliente.email, item.cliente.telefono]
          .some((value) => value.toLowerCase().includes(search))
        const matchesDate = !bookingFilterDate || date === bookingFilterDate
        return matchesSearch && matchesDate && matchesBookingFilter(item, bookingFilter, now)
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
  const shoppingSessions = useMemo(() => sessions.filter((item) => Boolean(item.startedAt) || item.estado === "completada"), [sessions])
  const filteredSessions = useMemo(() => {
    const search = sessionSearch.trim().toLowerCase()
    return shoppingSessions.filter((item) => {
      const matchesSearch = !search || [item.id, item.cliente.nombre, item.cliente.email, item.envio?.labelCode || ""].some((value) => value.toLowerCase().includes(search))
      return matchesSearch
    })
  }, [shoppingSessions, sessionSearch])

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
    if (response.ok) {
      setDismissedNotificationIds((current) => current.includes(id) ? current : [...current, id])
      setActiveNotificationId((current) => current === id ? null : current)
    }
  }

  async function markAllNotificationsRead() {
    await Promise.all(notifications.filter((item) => !item.read).map((item) => markNotificationRead(item.id)))
    setActiveNotificationId(null)
  }

  function dismissNotificationToast(id: string) {
    setDismissedNotificationIds((current) => current.includes(id) ? current : [...current, id])
    setActiveNotificationId((current) => current === id ? null : current)
  }

  async function clearNotification(id: string) {
    const response = await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (!response.ok) return
    setNotifications((current) => current.filter((item) => item.id !== id))
    dismissNotificationToast(id)
  }

  async function clearAllNotifications() {
    const response = await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    })
    if (!response.ok) return
    setNotifications([])
    setDismissedNotificationIds([])
    setActiveNotificationId(null)
  }

  async function refreshShippingData() {
    const [sessionsResponse, shippingResponse] = await Promise.all([
      fetch("/api/sessions", { cache: "no-store" }),
      fetch("/api/shipping", { cache: "no-store" }),
    ])
    if (sessionsResponse.ok) setSessions(((await sessionsResponse.json()) as { sessions: SesionCompra[] }).sessions)
    if (shippingResponse.ok) setBoxes(((await shippingResponse.json()) as { boxes: ConsolidatedBoxManifest[] }).boxes)
  }

  async function createConsolidatedBox(draft: DispatchDraft): Promise<boolean> {
    setShippingMessage("")
    const response = await fetch("/api/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createBox", ...draft }),
    })
    const result = await response.json() as { box?: { number: string }; error?: string }
    if (!response.ok) {
      setShippingMessage(result.error || "Unable to create dispatch box")
      return false
    }
    setSelectedShipments([])
    setBoxCourier("")
    setBoxTracking("")
    setShippingMessage(`${result.box?.number || "Dispatch box"} created as a draft. Assign more shipments or review it before shipping.`)
    await refreshShippingData()
    return true
  }

  async function assignShipmentsToBox(boxId: string, shipmentIds: string[]): Promise<boolean> {
    setShippingMessage("")
    const response = await fetch("/api/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assignShipments", boxId, shipmentIds }),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) {
      setShippingMessage(result.error || "Unable to assign shipments")
      return false
    }
    setShippingMessage("Shipments assigned to the dispatch box.")
    await refreshShippingData()
    return true
  }

  async function dispatchConsolidatedBox(boxId: string): Promise<boolean> {
    setShippingMessage("")
    const response = await fetch("/api/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dispatchBox", boxId }),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) {
      setShippingMessage(result.error || "Unable to ship dispatch box")
      return false
    }
    setShippingMessage("Dispatch box shipped and locked.")
    await refreshShippingData()
    return true
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

    async function copyShipmentCode() {
      const shipmentCode = session?.envio?.labelCode
      if (!shipmentCode) return
      setActionError("")
      try {
        await navigator.clipboard.writeText(shipmentCode)
        setShipmentCodeCopied(true)
        window.setTimeout(() => setShipmentCodeCopied(false), 2000)
      } catch (caughtError) {
        setActionError(caughtError instanceof Error ? caughtError.message : "Unable to copy shipment code")
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

    async function confirmCloseSession(initialPercentage: number) {
      setActionError("")
      try {
        await close(initialPercentage)
        setCloseDialogOpen(false)
      } catch (caughtError) {
        setActionError(caughtError instanceof Error ? caughtError.message : "Unable to close session")
      }
    }

    async function reopenClosedSession() {
      setActionError("")
      try {
        await reopenForCorrection()
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : "Unable to reopen session"
        setActionError(message)
        throw new Error(message)
      }
    }

    return (
      <SidebarProvider>
        <SellerSidebar active="sessions" onSelect={null} isAdmin={isAdmin} />
        <SidebarInset className="w-0 min-w-0">
          <header className="flex items-center justify-between border-b bg-background px-4 py-4 lg:px-8"><div className="flex items-center gap-3"><SidebarTrigger /><div><Button asChild variant="link" className="h-auto p-0 text-muted-foreground"><Link href="/seller">Seller dashboard</Link></Button><h1 className="text-xl font-bold">{session.cliente.nombre}</h1></div></div><div className="flex flex-wrap items-center justify-end gap-2">{session.requiresLocalInvoice && <Badge variant="outline"><FileText />Local invoice requested</Badge>}<span className="font-mono font-semibold"><Clock className="mr-1 inline size-4" />{isActive ? `${minutes}:${seconds}` : "Not started"}</span>{session.envio && <Badge variant="outline" aria-label={`Shipment status: ${shipmentStatusLabel(session.envio.estado)}`}>Shipment: {shipmentStatusLabel(session.envio.estado)}</Badge>}<ModeToggle /><Button variant="outline" size="sm" onClick={() => void copyCustomerLink()}><Copy />Customer link</Button></div></header>
          <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8">
            <div className="min-w-0 space-y-6">
              {isWaiting && <Card><CardHeader><CardTitle>Session waiting to start</CardTitle><CardDescription>{scheduledAt.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} · {session.outlet}</CardDescription></CardHeader><CardContent className="space-y-3"><Button className="w-full" size="lg" disabled={!canStart} onClick={() => void beginSession()}><WhatsAppIcon />Start live session</Button>{!canStart && <p className="text-center text-xs text-muted-foreground">The booking payment must be confirmed before this session can start.</p>}{actionError && <p className="text-sm text-destructive">{actionError}</p>}</CardContent></Card>}
              {isActive && <Card><CardHeader><CardTitle className="text-xl">Add product</CardTitle><CardDescription>Cart changes sync to the customer screen.</CardDescription></CardHeader><CardContent><form onSubmit={submitProduct} className="grid gap-3 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label htmlFor="product-name">Product name</Label><Input id="product-name" name="nombre" required /></div><div className="space-y-2"><Label htmlFor="product-sku">SKU</Label><Input id="product-sku" name="sku" /></div><div className="space-y-2"><Label htmlFor="product-price">Price USD</Label><Input id="product-price" name="precio" type="number" min="0.01" step="0.01" required /></div><div className="space-y-2"><Label htmlFor="product-quantity">Quantity</Label><Input id="product-quantity" name="cantidad" type="number" min="1" defaultValue="1" /></div><div className="space-y-2"><Label htmlFor="product-notes">Notes</Label><Input id="product-notes" name="notas" /></div>{actionError && <p className="text-sm text-destructive sm:col-span-2">{actionError}</p>}<Button className="sm:col-span-2"><Plus />Add to cart</Button></form></CardContent></Card>}
              {session.estado === "completada" ? <ReadOnlyOrderDetails session={session} isAdmin={isAdmin} onReopen={reopenClosedSession} /> : <Card><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ShoppingCart />Cart ({session.productos.length})</CardTitle></CardHeader><CardContent className="space-y-3">{session.productos.length === 0 && <p className="py-8 text-center text-muted-foreground">No products yet.</p>}{session.productos.map((product) => <div key={product.id} className="flex items-center gap-3 rounded-md bg-muted p-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.nombre}</p><p className="text-xs text-muted-foreground">{product.sku || "No SKU"}{product.notas ? ` · ${product.notas}` : ""}</p></div><Button size="icon" variant="outline" onClick={() => void updateQuantity(product.id, -1)}><Minus /></Button><span>{product.cantidad}</span><Button size="icon" variant="outline" onClick={() => void updateQuantity(product.id, 1)}><Plus /></Button><strong className="w-24 text-right">{formatCurrency(product.precio * product.cantidad)}</strong><Button size="icon" variant="ghost" onClick={() => void removeProduct(product.id)}><Trash2 /></Button></div>)}</CardContent></Card>}
            </div>
            <aside className="min-w-0 space-y-6"><Card><CardHeader><CardTitle className="text-xl">Order summary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(session.subtotal)}</span></div><div className="flex justify-between"><span>Tax {formatPercent(session.tasaImpuesto)}</span><span>{formatCurrency(session.impuesto)}</span></div><div className="flex justify-between"><span>Fee {formatPercent(session.tasaComision)}</span><span>{formatCurrency(session.comision)}</span></div><div className="flex justify-between pt-3 text-lg font-bold"><span>Total</span><span>{formatCurrency(session.total)}</span></div></CardContent></Card>{session.estado === "completada" && <Card><CardHeader><CardTitle className="text-xl">Customer delivery</CardTitle><CardDescription>{session.envio ? `Current status: ${shipmentStatusLabel(session.envio.estado)}` : "Create the shipment after the customer's up-front payment is confirmed."}</CardDescription></CardHeader><CardContent className="space-y-3">{session.deliveryAddress && <div className="rounded-md bg-muted p-3 text-sm"><p className="font-medium">Confirmed delivery address</p><p className="mt-1 text-muted-foreground">{session.deliveryAddress}</p><p className="text-muted-foreground">{session.deliveryCity}, {session.cliente.pais}</p></div>}{session.envio?.labelCode && <div className="rounded-md border p-3 text-sm"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">Customer shipment code</p><p className="mt-1 break-all font-mono font-semibold">{session.envio.labelCode}</p></div><Button type="button" size="sm" variant="outline" className="min-w-24 shrink-0 justify-center" onClick={() => void copyShipmentCode()}><Copy />{shipmentCodeCopied ? "Copied" : "Copy code"}</Button></div></div>}{nextDeliveryStep && hasInitialPayment(session) && <Button className="w-full" disabled={!session.deliveryAddress || !session.deliveryCity} onClick={() => void createShipment()}><Package />{nextDeliveryStep.label}</Button>}{!nextDeliveryStep && session.envio?.estado === "entregado" && <Badge><CheckCircle2 />Delivery confirmed</Badge>}{session.envio && session.envio.estado !== "entregado" && <p className="text-xs text-muted-foreground">USA operations handles consolidation. The local team owns receipt, final payment, and delivery confirmation.</p>}{!hasInitialPayment(session) && <p className="text-xs text-muted-foreground">Waiting for the customer to confirm their address and pay the up-front amount.</p>}{actionError && <p className="text-sm text-destructive">{actionError}</p>}</CardContent></Card>}<CloseSessionDialog session={session} open={closeDialogOpen} onOpenChange={setCloseDialogOpen} onConfirm={confirmCloseSession} isActive={isActive} /></aside>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  const readyShipments = shoppingSessions.filter((item) => item.envio?.estado === "preparacion" && !item.envio.cajaId)
  const source = activeTab === "customers" ? customers : activeTab === "sessions" ? filteredSessions : activeTab === "bookings" ? filteredBookings : activeTab === "shipping" ? [] : sessions
  const paginated = source.slice((page - 1) * pageSize, page * pageSize)
  const unreadNotifications = notifications.filter((item) => !item.read)

  return (
    <SidebarProvider>
      <SellerSidebar active={activeTab} onSelect={switchTab} isAdmin={isAdmin} />
      <SidebarInset className="w-0 min-w-0">
        <header className="flex flex-col justify-between gap-4 border-b px-4 py-5 sm:flex-row sm:items-center lg:px-8">
          <div className="flex items-center gap-3"><SidebarTrigger className="-ml-1" /><div><p className="text-sm text-muted-foreground">Brash3D operations</p><h1 className="text-2xl font-bold capitalize">{activeTab}</h1></div></div>
          <div className="flex items-center gap-2">
            <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label={unreadNotifications.length ? `${unreadNotifications.length} unread notifications` : "Notifications"}>
                  <Bell />
                  {unreadNotifications.length > 0 && <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white shadow-sm">{unreadNotifications.length > 99 ? "99+" : unreadNotifications.length}</span>}
                  <span className="sr-only">Open notifications</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="flex max-h-[75vh] w-[min(100%-2rem,680px)] max-w-none flex-col gap-0 overflow-hidden p-0">
                <DialogHeader className="border-b px-4 py-4 pr-12">
                  <DialogTitle>Notifications</DialogTitle>
                  <DialogDescription>Payment and booking activity for your operations.</DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                  {notifications.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No notifications yet.</div> : <div className="overflow-hidden rounded-lg border">
                    {notifications.map((item) => <div key={item.id} className={cn("flex gap-3 border-b p-3 last:border-b-0", !item.read && "bg-primary/5")}>
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted", !item.read && "bg-primary/10 text-primary")}><Bell className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><p className={cn("truncate text-sm font-medium", !item.read && "font-semibold")}>{item.title}</p>{!item.read && <span className="size-2 shrink-0 rounded-full bg-red-600" aria-label="Unread" />}</div><div className="flex shrink-0 items-center gap-1"><time className="hidden text-[11px] text-muted-foreground sm:block">{formatDateTime(item.createdAt)}</time><Button aria-label={`Clear ${item.title}`} title="Clear notification" variant="ghost" size="icon" className="size-7" onClick={() => void clearNotification(item.id)}><Trash2 className="size-3.5" /></Button></div></div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
                        {!item.read && <Button size="sm" variant="outline" className="mt-2 h-7 px-2 text-xs" onClick={() => void markNotificationRead(item.id)}>Mark as read</Button>}
                      </div>
                    </div>)}
                  </div>}
                </div>
                {notifications.length > 0 && <div className="flex flex-wrap gap-2 border-t px-4 py-3"><Button variant="outline" size="sm" disabled={!unreadNotifications.length} onClick={() => void markAllNotificationsRead()}>Mark all as read</Button><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void clearAllNotifications()}><Trash2 />Clear all</Button></div>}
              </DialogContent>
            </Dialog>
            <ModeToggle />{bookingDialog}
          </div>
        </header>
        {activeNotificationId && (() => {
          const notification = notifications.find((item) => item.id === activeNotificationId)
          if (!notification) return null
          return <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:inset-x-auto sm:right-4 sm:justify-end">
            <Alert className="pointer-events-auto flex w-full max-w-md items-start gap-3 bg-background p-3 shadow-lg">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <AlertTitle className="text-sm">{notification.title}</AlertTitle>
                <AlertDescription className="line-clamp-2 text-xs text-muted-foreground">{notification.message}</AlertDescription>
              </div>
              <Button aria-label="Dismiss notification" variant="ghost" size="icon" className="-mr-2 -mt-2 shrink-0 !p-0" onClick={() => dismissNotificationToast(notification.id)}>
                <X />
              </Button>
            </Alert>
          </div>
        })()}
        <div className="space-y-6 p-4 lg:p-8">
          {historyCustomerId ? <CustomerPurchaseHistoryDetail history={customerHistory} loading={historyLoading} error={historyError} onBack={closeCustomerHistory} /> : <>
          {activeTab === "overview" && <OverviewDashboard sessions={sessions} boxes={boxes} />}
          {activeTab === "shipping" && <ShippingOperations boxes={boxes} readyShipments={readyShipments} selectedShipments={selectedShipments} courier={boxCourier} tracking={boxTracking} message={shippingMessage} onCourierChange={setBoxCourier} onTrackingChange={setBoxTracking} onToggleShipment={(id) => setSelectedShipments((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onCreateBox={createConsolidatedBox} onAssignShipments={assignShipmentsToBox} onDispatchBox={dispatchConsolidatedBox} />}
          {activeTab === "bookings" && <TableCard title="Bookings" description="Scheduled appointments and booking-payment readiness."><div className="space-y-3 border-b px-4 pb-4"><div className="flex flex-wrap gap-2">{(["upcoming", "today", "payment_pending", "in_progress", "completed", "all"] as BookingFilter[]).map((filter) => <Button key={filter} size="sm" variant={bookingFilter === filter ? "default" : "outline"} onClick={() => { setBookingFilter(filter); setPage(1) }}>{filter.replaceAll("_", " ")}</Button>)}</div><div className="grid gap-2 sm:grid-cols-[1fr_190px_auto]"><Input aria-label="Search bookings" placeholder="Search name, phone, or email" value={bookingSearch} onChange={(event) => { setBookingSearch(event.target.value); setPage(1) }} /><Input aria-label="Filter bookings by date" type="date" value={bookingFilterDate} onChange={(event) => { setBookingFilterDate(event.target.value); setPage(1) }} /><Button variant="ghost" disabled={!bookingSearch && !bookingFilterDate} onClick={() => { setBookingSearch(""); setBookingFilterDate(""); setPage(1) }}>Clear</Button></div><p className="text-xs text-muted-foreground">{filteredBookings.length} matching booking{filteredBookings.length === 1 ? "" : "s"} · nearest upcoming first</p></div><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Appointment</TableHead><TableHead>Booking fee</TableHead><TableHead>Status</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.id}><TableCell><div className="flex items-center gap-2"><p className="font-medium">{item.cliente.nombre}</p>{item.id === nextBookingId && <Badge variant="outline">Next</Badge>}</div><p className="text-xs text-muted-foreground">{item.cliente.telefono}</p></TableCell><TableCell className="whitespace-nowrap"><p className="font-medium">{item.horaProgramada || "—"}</p><p className="text-xs text-muted-foreground">{item.fechaProgramada ? formatDate(item.fechaProgramada) : "—"}</p></TableCell><TableCell>{item.bookingEstado === "confirmada" || item.bookingEstado === "completada" ? <Badge><CheckCircle2 />{item.bookingFee > 0 ? "$20 paid" : "Referral reward"}</Badge> : <Badge variant="outline">Pending</Badge>}</TableCell><TableCell><BookingStage session={item} /></TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={filteredBookings.length} onChange={setPage} /></TableCard>}
          {activeTab === "customers" && <TableCard title="Customers" description="Customers with a booking or shopping session."><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>WhatsApp</TableHead><TableHead>City</TableHead><TableHead>Last activity</TableHead><TableHead className="text-right">Latest order</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.clienteId}><TableCell><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.email}</p></TableCell><TableCell>{item.cliente.telefono}</TableCell><TableCell>{item.cliente.ciudad || item.cliente.pais}</TableCell><TableCell>{formatDateTime(item.fechaInicio)}</TableCell><TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} onViewHistory={openCustomerHistory} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={customers.length} onChange={setPage} /></TableCard>}
          {activeTab === "sessions" && <TableCard title="Shopping sessions" description="Customer sessions and shipment progress."><div className="border-b px-4 py-4"><Input aria-label="Search sessions" placeholder="Search customer, session ID, or shipment code" value={sessionSearch} onChange={(event) => { setSessionSearch(event.target.value); setPage(1) }} /></div><p className="border-b px-4 py-3 text-xs text-muted-foreground">{filteredSessions.length} matching session{filteredSessions.length === 1 ? "" : "s"}</p><Table className="!w-full !table-fixed [&_th]:!py-2 [&_td]:!py-2"><TableHeader><TableRow><TableHead className="w-[13%]">Session ID</TableHead><TableHead className="w-[14%]">Date</TableHead><TableHead className="w-[21%]">Customer</TableHead><TableHead className="w-[20%]">Assignment</TableHead><TableHead className="w-[20%]">Order stage</TableHead><TableHead className="w-[24%]">Shipment code</TableHead><TableHead className="w-[8%] text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.id}><TableCell title={item.id} className="font-mono text-xs">{item.id.slice(-8).toUpperCase()}</TableCell><TableCell className="whitespace-nowrap text-xs">{formatDateTime(item.fechaHoraProgramada || item.fechaInicio)}</TableCell><TableCell>{item.cliente.nombre}</TableCell><TableCell><p className="text-sm font-medium">{item.vendedor.nombre}</p><p className="text-xs text-muted-foreground">{item.vendedor.tiendaAsignada || "Assigned seller"}</p></TableCell><TableCell className="whitespace-nowrap"><OrderStage session={item} /></TableCell><TableCell title={item.envio?.labelCode || "—"} className="max-w-48 font-mono text-xs"><span className="block truncate">{item.envio?.labelCode || "—"}</span></TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={filteredSessions.length} onChange={setPage} /></TableCard>}
          </>}
          {activeTab === "schedule" && isAdmin && <SchedulePanel />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function SellerSidebar({ active, onSelect, isAdmin }: { active: DashboardTab; onSelect: ((tab: DashboardTab) => void) | null; isAdmin: boolean }) {
  const items: { id: DashboardTab; label: string; icon: ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard /> },
    { id: "bookings", label: "Bookings", icon: <CalendarDays /> },
    { id: "customers", label: "Customers", icon: <Users /> },
    { id: "sessions", label: "Sessions", icon: <ReceiptText /> },
    { id: "shipping", label: "Shipping", icon: <Package /> },
    // Changing opening hours moves every customer's bookable slot, so it stays admin-only.
    ...(isAdmin ? [{ id: "schedule" as const, label: "Schedule", icon: <CalendarCog /> }] : []),
  ]
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    // Full document load: a soft navigation would keep this panel's fetched
    // data in memory and can reuse the router's stale entry for /login.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft navigation is exactly what breaks here.
    window.location.assign("/login")
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
  return <Card className="overflow-hidden"><CardHeader><CardTitle className="text-xl">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="p-0 [&>div]:overflow-hidden [&_table]:table-auto [&_th]:align-middle [&_th:last-child]:w-20 [&_td]:align-middle [&_td]:whitespace-nowrap [&_td]:py-3 [&_td:last-child]:text-right [&_td_p]:truncate">{children}</CardContent></Card>
}
