export type ReservaEstado = "pendiente_pago" | "confirmada" | "cancelada" | "completada"

export type SesionEstado = "en_progreso" | "completada" | "cancelada"

export type EnvioEstado = "preparacion" | "en_transito" | "en_aduanas" | "entregado" | "devuelto"

export interface Producto {
  id: string
  nombre: string
  sku?: string
  precio: number
  cantidad: number
  notas?: string
  urlImagen?: string
  addedAt: Date
}

export interface Cliente {
  id: string
  nombre: string
  email: string
  telefono: string
  ciudad?: string
  pais: string
}

export interface Vendedor {
  id: string
  nombre: string
  email: string
  tiendaAsignada?: string
}

export interface TimeSlot {
  id: string
  date: string
  time: string
  available: boolean
  sellerId: string
  sellerName?: string
  outlet?: string
}

export interface Reserva {
  id: string
  clienteId: string
  cliente: Cliente
  fecha: Date
  hora: string
  estado: ReservaEstado
  montoReserva: number
  paymentIntentId?: string
  createdAt: Date
}

export interface SesionCompra {
  id: string
  reservaId: string
  vendedorId: string
  vendedor: Vendedor
  clienteId: string
  cliente: Cliente
  fechaInicio: Date
  fechaProgramada?: Date
  horaProgramada?: string
  outlet?: string
  fechaFin?: Date
  estado: SesionEstado
  productos: Producto[]
  subtotal: number
  impuesto: number
  comision: number
  total: number
  paymentIntent65Id?: string
  paymentIntent35Id?: string
  montoPagado65: number
  montoPagado35: number
}

export interface Envio {
  id: string
  sesionId: string
  trackingNumber?: string
  transportadora?: string
  fechaEnvio?: Date
  fechaEntregaEstimada?: Date
  fechaEntregaReal?: Date
  estado: EnvioEstado
  costoEnvio: number
}

export interface TimelineEvent {
  id: string
  title: string
  description?: string
  date: Date
  status: "completed" | "current" | "pending"
}
