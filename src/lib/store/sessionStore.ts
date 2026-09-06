import {
  Cliente,
  Envio,
  EnvioEstado,
  Producto,
  Reserva,
  SesionCompra,
  TimeSlot,
  Vendedor,
} from "@/lib/types"

interface StoreState {
  sessions: Map<string, SesionCompra>
  bookings: Map<string, Reserva>
  envios: Map<string, Envio>
  timeSlots: TimeSlot[]
  slotVersion?: number
}

const SLOT_VERSION = 2

const sellers: Vendedor[] = [
  { id: "ven-maria", nombre: "Maria Garcia", email: "maria@brash3d.com", tiendaAsignada: "Sawgrass Mills" },
  { id: "ven-juan", nombre: "Juan Perez", email: "juan@brash3d.com", tiendaAsignada: "Dolphin Mall" },
]

function formatSlotDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function generateTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = []
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  const end = new Date(start.getFullYear(), start.getMonth() + 2, 0, 12, 0, 0, 0)

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    for (let hour = 9; hour <= 18; hour += 1) {
      const suffix = hour >= 12 ? "PM" : "AM"
      const displayHour = hour > 12 ? hour - 12 : hour
      const time = `${displayHour}:00 ${suffix}`
      for (const seller of sellers) {
        slots.push({
          id: `slot-${formatSlotDate(date)}-${hour}-${seller.id}`,
          date: formatSlotDate(date),
          time,
          available: true,
          sellerId: seller.id,
          sellerName: seller.nombre,
          outlet: seller.tiendaAsignada,
        })
      }
    }
  }

  return slots
}

const globalStore = globalThis as typeof globalThis & {
  __brash3dDemoStore?: StoreState
}

const store = globalStore.__brash3dDemoStore ?? {
  sessions: new Map<string, SesionCompra>(),
  bookings: new Map<string, Reserva>(),
  envios: new Map<string, Envio>(),
  timeSlots: generateTimeSlots(),
  slotVersion: SLOT_VERSION,
}

globalStore.__brash3dDemoStore = store

if (store.slotVersion !== SLOT_VERSION || store.timeSlots.length < 100) {
  const bookedSlots = new Set(
    [...store.sessions.values()]
      .filter((session) => session.fechaProgramada && session.horaProgramada)
      .map((session) => `${formatSlotDate(new Date(session.fechaProgramada!))}|${session.horaProgramada}|${session.outlet || session.vendedor.tiendaAsignada}`)
  )
  store.timeSlots = generateTimeSlots().map((slot) => ({
    ...slot,
    available: !bookedSlots.has(`${slot.date}|${slot.time}|${slot.outlet}`),
  }))
  store.slotVersion = SLOT_VERSION
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function copySession(session: SesionCompra): SesionCompra {
  return {
    ...session,
    cliente: { ...session.cliente },
    vendedor: { ...session.vendedor },
    productos: session.productos.map((product) => ({ ...product })),
  }
}

export function getTimeSlots(): TimeSlot[] {
  return store.timeSlots.map((slot) => ({ ...slot }))
}

export function createBooking(cliente: Cliente, slotId: string): Reserva {
  const slot = store.timeSlots.find((candidate) => candidate.id === slotId)

  if (!slot || !slot.available) {
    throw new Error("SLOT_NOT_AVAILABLE")
  }

  slot.available = false
  const booking: Reserva = {
    id: createId("res"),
    clienteId: cliente.id,
    cliente,
    fecha: new Date(`${slot.date}T12:00:00`),
    hora: slot.time,
    estado: "confirmada",
    montoReserva: 20,
    createdAt: new Date(),
  }

  store.bookings.set(booking.id, booking)
  return { ...booking, cliente: { ...booking.cliente } }
}

export function getBooking(id: string): Reserva | null {
  const booking = store.bookings.get(id)
  return booking ? { ...booking, cliente: { ...booking.cliente } } : null
}

export function createSession(
  reservaId: string,
  vendedor: Vendedor,
  cliente: Cliente,
  schedule?: { fecha: Date; hora: string; outlet?: string }
): SesionCompra {
  const session: SesionCompra = {
    id: createId("ses"),
    reservaId,
    vendedorId: vendedor.id,
    vendedor,
    clienteId: cliente.id,
    cliente,
    fechaInicio: new Date(),
    fechaProgramada: schedule?.fecha,
    horaProgramada: schedule?.hora,
    outlet: schedule?.outlet,
    estado: "en_progreso",
    productos: [],
    subtotal: 0,
    impuesto: 0,
    comision: 0,
    total: 0,
    montoPagado65: 0,
    montoPagado35: 0,
  }

  store.sessions.set(session.id, session)
  return copySession(session)
}

export function createSessionForBooking(booking: Reserva, slotId: string): SesionCompra {
  const slot = store.timeSlots.find((candidate) => candidate.id === slotId)
  const seller = sellers.find((candidate) => candidate.id === slot?.sellerId) ?? sellers[0]
  return createSession(booking.id, seller, booking.cliente, {
    fecha: booking.fecha,
    hora: booking.hora,
    outlet: slot?.outlet,
  })
}

export function listSessions(): SesionCompra[] {
  return [...store.sessions.values()]
    .sort((a, b) => b.fechaInicio.getTime() - a.fechaInicio.getTime())
    .map(copySession)
}

export function getSession(id: string): SesionCompra | null {
  const session = store.sessions.get(id)
  return session ? copySession(session) : null
}

function recalculateTotals(session: SesionCompra): void {
  session.subtotal = session.productos.reduce(
    (sum, product) => sum + product.precio * product.cantidad,
    0
  )
  session.impuesto = session.subtotal * 0.07
  session.comision = session.subtotal * 0.15
  session.total = session.subtotal + session.impuesto + session.comision
}

export function addProductToSession(
  sessionId: string,
  product: Omit<Producto, "id" | "addedAt">
): SesionCompra | null {
  const session = store.sessions.get(sessionId)
  if (!session || session.estado !== "en_progreso") return null

  session.productos.push({
    id: createId("prod"),
    ...product,
    addedAt: new Date(),
  })
  recalculateTotals(session)
  return copySession(session)
}

export function updateProductQuantity(
  sessionId: string,
  productId: string,
  delta: number
): SesionCompra | null {
  const session = store.sessions.get(sessionId)
  if (!session || session.estado !== "en_progreso") return null

  const product = session.productos.find((candidate) => candidate.id === productId)
  if (!product) return null

  product.cantidad = Math.max(1, product.cantidad + delta)
  recalculateTotals(session)
  return copySession(session)
}

export function removeProductFromSession(
  sessionId: string,
  productId: string
): SesionCompra | null {
  const session = store.sessions.get(sessionId)
  if (!session || session.estado !== "en_progreso") return null

  session.productos = session.productos.filter((product) => product.id !== productId)
  recalculateTotals(session)
  return copySession(session)
}

export function closeSession(sessionId: string): SesionCompra | null {
  const session = store.sessions.get(sessionId)
  if (!session) return null

  session.estado = "completada"
  session.fechaFin = new Date()
  return copySession(session)
}

export function simulatePayment(sessionId: string, amount: "65" | "35"): boolean {
  const session = store.sessions.get(sessionId)
  if (!session || session.estado !== "completada" || session.total <= 0) return false

  if (amount === "65") {
    session.montoPagado65 = session.total * 0.65
  } else if (session.montoPagado65 > 0) {
    session.montoPagado35 = session.total * 0.35
  } else {
    return false
  }

  return true
}

export function createEnvio(sessionId: string): Envio {
  const envio: Envio = {
    id: createId("env"),
    sesionId: sessionId,
    estado: "preparacion",
    costoEnvio: 0,
  }
  store.envios.set(envio.id, envio)
  return { ...envio }
}

export function updateEnvioEstado(envioId: string, estado: EnvioEstado): Envio | null {
  const envio = store.envios.get(envioId)
  if (!envio) return null

  envio.estado = estado
  if (estado === "en_transito" && !envio.fechaEnvio) {
    envio.fechaEnvio = new Date()
    envio.fechaEntregaEstimada = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  }
  if (estado === "entregado") envio.fechaEntregaReal = new Date()
  return { ...envio }
}

export function getEnvio(id: string): Envio | null {
  const envio = store.envios.get(id)
  return envio ? { ...envio } : null
}

export function getEnvioBySession(sessionId: string): Envio | null {
  const envio = [...store.envios.values()].find((candidate) => candidate.sesionId === sessionId)
  return envio ? { ...envio } : null
}
