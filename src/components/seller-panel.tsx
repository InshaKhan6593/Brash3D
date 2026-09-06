"use client"

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Minus,
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
import { SesionCompra, TimeSlot } from "@/lib/types"
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils"

type DashboardTab = "overview" | "bookings" | "customers" | "sessions"

interface SellerPanelProps {
  sessionId: string | null
}

const pageSize = 4

function SessionStatus({ status }: { status: SesionCompra["estado"] }) {
  return status === "en_progreso" ? (
    <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300">Ready</Badge>
  ) : (
    <Badge variant="secondary" className="bg-sky-100 text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300">Closed</Badge>
  )
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

function RowActions({ session }: { session: SesionCompra }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${session.cliente.nombre}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href={`/seller?sessionId=${session.id}`}>Manage session</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={`/session/${session.id}`} target="_blank">Open customer view</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SellerPanel({ sessionId }: SellerPanelProps) {
  const { session, loading, error, addProduct, updateQuantity, removeProduct, close } = useSession(sessionId)
  const [sessions, setSessions] = useState<SesionCompra[]>([])
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview")
  const [page, setPage] = useState(1)
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
      const [sessionsResponse, slotsResponse] = await Promise.all([
        fetch("/api/sessions", { cache: "no-store" }),
        fetch("/api/slots", { cache: "no-store" }),
      ])
      if (sessionsResponse.ok) setSessions(((await sessionsResponse.json()) as { sessions: SesionCompra[] }).sessions)
      if (slotsResponse.ok) setSlots(((await slotsResponse.json()) as { slots: TimeSlot[] }).slots)
    }
    void loadDashboard()
  }, [sessionId])

  useEffect(() => {
    if (!session || session.estado !== "en_progreso") return
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(session.fechaInicio).getTime()) / 1000)))
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
  const liveCount = sessions.filter((item) => item.estado === "en_progreso").length
  const closedCount = sessions.filter((item) => item.estado === "completada").length

  function switchTab(tab: DashboardTab) {
    setActiveTab(tab)
    setPage(1)
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
                <Button key={slot.id} type="button" variant={selectedSellerSlotId === slot.id ? "default" : "outline"} className="h-auto py-2" disabled={!slot.available} onClick={() => setSelectedSellerSlotId(slot.id)}><span><span className="block font-medium">{slot.time}</span><span className="block truncate text-xs opacity-70">{slot.outlet}{!slot.available && " · Booked"}</span></span></Button>
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
    if (!session) return <main className="flex min-h-screen items-center justify-center px-4"><Card className="max-w-md"><CardContent className="py-10 text-center"><p className="font-semibold">Session not found</p><p className="mt-1 text-sm text-muted-foreground">{error || "The demo server may have restarted."}</p><Button asChild className="mt-4"><Link href="/seller">Back to dashboard</Link></Button></CardContent></Card></main>

    const isActive = session.estado === "en_progreso"
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0")
    const customerUrl = typeof window === "undefined" ? "" : `${window.location.origin}/session/${session.id}`

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

    return (
      <SidebarProvider>
        <SellerSidebar active="sessions" onSelect={null} />
        <SidebarInset className="w-0 min-w-0">
          <header className="flex items-center justify-between border-b bg-background px-4 py-4 lg:px-8"><div className="flex items-center gap-3"><SidebarTrigger /><div><Button asChild variant="link" className="h-auto p-0 text-muted-foreground"><Link href="/seller">Seller dashboard</Link></Button><h1 className="text-xl font-bold">{session.cliente.nombre}</h1></div></div><div className="flex items-center gap-3"><span className="font-mono font-semibold"><Clock className="mr-1 inline size-4" />{minutes}:{seconds}</span><ModeToggle /><Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(customerUrl)}><Copy />Customer link</Button></div></header>
          <div className="grid gap-6 p-4 lg:grid-cols-[1fr_340px] lg:p-8">
            <div className="space-y-6">
              <Card><CardHeader><CardTitle className="text-xl">Add product</CardTitle><CardDescription>Cart changes sync to the customer screen.</CardDescription></CardHeader><CardContent><form onSubmit={submitProduct} className="grid gap-3 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label htmlFor="product-name">Product name</Label><Input id="product-name" name="nombre" required /></div><div className="space-y-2"><Label htmlFor="product-sku">SKU</Label><Input id="product-sku" name="sku" /></div><div className="space-y-2"><Label htmlFor="product-price">Price USD</Label><Input id="product-price" name="precio" type="number" min="0.01" step="0.01" required /></div><div className="space-y-2"><Label htmlFor="product-quantity">Quantity</Label><Input id="product-quantity" name="cantidad" type="number" min="1" defaultValue="1" /></div><div className="space-y-2"><Label htmlFor="product-notes">Notes</Label><Input id="product-notes" name="notas" /></div>{actionError && <p className="text-sm text-destructive sm:col-span-2">{actionError}</p>}<Button className="sm:col-span-2" disabled={!isActive}><Plus />Add to cart</Button></form></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><ShoppingCart />Cart ({session.productos.length})</CardTitle></CardHeader><CardContent className="space-y-3">{session.productos.length === 0 && <p className="py-8 text-center text-muted-foreground">No products yet.</p>}{session.productos.map((product) => <div key={product.id} className="flex items-center gap-3 rounded-md bg-muted p-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.nombre}</p><p className="text-xs text-muted-foreground">{product.sku || "No SKU"}{product.notas ? ` · ${product.notas}` : ""}</p></div><Button size="icon" variant="outline" onClick={() => void updateQuantity(product.id, -1)} disabled={!isActive}><Minus /></Button><span>{product.cantidad}</span><Button size="icon" variant="outline" onClick={() => void updateQuantity(product.id, 1)} disabled={!isActive}><Plus /></Button><strong className="w-24 text-right">{formatCurrency(product.precio * product.cantidad)}</strong><Button size="icon" variant="ghost" onClick={() => void removeProduct(product.id)} disabled={!isActive}><Trash2 /></Button></div>)}</CardContent></Card>
            </div>
            <aside className="space-y-6"><Card><CardHeader><CardTitle className="text-xl">Order summary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(session.subtotal)}</span></div><div className="flex justify-between"><span>Tax 7%</span><span>{formatCurrency(session.impuesto)}</span></div><div className="flex justify-between"><span>Fee 15%</span><span>{formatCurrency(session.comision)}</span></div><div className="flex justify-between pt-3 text-lg font-bold"><span>Total</span><span>{formatCurrency(session.total)}</span></div></CardContent></Card><Button className="w-full" variant="destructive" disabled={!isActive || session.productos.length === 0} onClick={() => void close()}><X />{isActive ? "Close session and invoice" : "Session closed"}</Button></aside>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  const source = activeTab === "customers" ? customers : sessions
  const paginated = source.slice((page - 1) * pageSize, page * pageSize)

  return (
    <SidebarProvider>
      <SellerSidebar active={activeTab} onSelect={switchTab} />
      <SidebarInset className="w-0 min-w-0">
        <header className="flex flex-col justify-between gap-4 border-b px-4 py-5 sm:flex-row sm:items-center lg:px-8"><div className="flex items-center gap-3"><SidebarTrigger className="-ml-1" /><div><p className="text-sm text-muted-foreground">Brash3D operations</p><h1 className="text-2xl font-bold capitalize">{activeTab}</h1></div></div><div className="flex items-center gap-2"><ModeToggle />{bookingDialog}</div></header>
        <div className="space-y-6 p-4 lg:p-8">
          {activeTab === "overview" && <><div className="grid gap-4 md:grid-cols-3"><DashboardCard icon={<CalendarDays />} value={sessions.length} label="Total bookings" /><DashboardCard icon={<Clock />} value={liveCount} label="Ready or live" /><DashboardCard icon={<CheckCircle2 />} value={closedCount} label="Invoices created" /></div><SessionTable sessions={sessions.slice(0, 5)} title="Recent bookings" /></>}
          {activeTab === "bookings" && <TableCard title="Bookings" description="Scheduled customer appointments from today through next month."><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Outlet</TableHead><TableHead>Status</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.telefono}</p></TableCell><TableCell>{item.fechaProgramada ? formatDate(item.fechaProgramada) : "—"}</TableCell><TableCell>{item.horaProgramada || "—"}</TableCell><TableCell>{item.outlet || item.vendedor.tiendaAsignada}</TableCell><TableCell><SessionStatus status={item.estado} /></TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={sessions.length} onChange={setPage} /></TableCard>}
          {activeTab === "customers" && <TableCard title="Customers" description="Customers with a booking or shopping session."><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>WhatsApp</TableHead><TableHead>City</TableHead><TableHead>Last activity</TableHead><TableHead className="text-right">Order value</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.clienteId}><TableCell><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.email}</p></TableCell><TableCell>{item.cliente.telefono}</TableCell><TableCell>{item.cliente.ciudad || item.cliente.pais}</TableCell><TableCell>{formatDateTime(item.fechaInicio)}</TableCell><TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={customers.length} onChange={setPage} /></TableCard>}
          {activeTab === "sessions" && <TableCard title="Shopping sessions" description="Live carts, closed sessions, and invoice totals."><Table><TableHeader><TableRow><TableHead>Session</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(paginated as SesionCompra[]).map((item) => <TableRow key={item.id}><TableCell className="font-mono text-xs">{item.id.slice(-8).toUpperCase()}</TableCell><TableCell>{item.cliente.nombre}</TableCell><TableCell><SessionStatus status={item.estado} /></TableCell><TableCell>{item.productos.length}</TableCell><TableCell>{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table><TablePagination page={page} total={sessions.length} onChange={setPage} /></TableCard>}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function SellerSidebar({ active, onSelect }: { active: DashboardTab; onSelect: ((tab: DashboardTab) => void) | null }) {
  const items: { id: DashboardTab; label: string; icon: ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard /> },
    { id: "bookings", label: "Bookings", icon: <CalendarDays /> },
    { id: "customers", label: "Customers", icon: <Users /> },
    { id: "sessions", label: "Sessions", icon: <ReceiptText /> },
  ]
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
      <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild tooltip="Customer site"><Link href="/"><LogOut /><span>Customer site</span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
    </Sidebar>
  )
}

function TableCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="overflow-hidden"><CardHeader><CardTitle className="text-xl">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="p-0 [&>div]:overflow-hidden [&_table]:table-fixed [&_th:last-child]:w-20 [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap [&_td:last-child]:text-right [&_td:last-child]:text-clip [&_td_p]:truncate">{children}</CardContent></Card>
}

function SessionTable({ sessions, title }: { sessions: SesionCompra[]; title: string }) {
  return <TableCard title={title} description="Latest bookings and live-shopping activity."><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Appointment</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{sessions.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.cliente.nombre}</p><p className="text-xs text-muted-foreground">{item.cliente.telefono}</p></TableCell><TableCell>{item.fechaProgramada ? `${formatDate(item.fechaProgramada)} · ${item.horaProgramada}` : formatDateTime(item.fechaInicio)}</TableCell><TableCell><SessionStatus status={item.estado} /></TableCell><TableCell>{formatCurrency(item.total)}</TableCell><TableCell className="text-right"><RowActions session={item} /></TableCell></TableRow>)}</TableBody></Table></TableCard>
}
