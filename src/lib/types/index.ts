export type ReservaEstado = "pendiente_pago" | "confirmada" | "cancelada" | "completada"

export type SesionEstado = "en_progreso" | "completada" | "cancelada"

export type EnvioEstado = "preparacion" | "en_transito" | "en_aduanas" | "recibido_equipo_local" | "entregado" | "devuelto"
export type PagoFinalMetodo = "stripe" | "efectivo" | "transferencia"

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
  requiresLocalInvoice?: boolean
  paymentIntentId?: string
  holdExpiresAt?: Date
  checkoutSessionId?: string
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
  startedAt?: Date
  fechaProgramada?: Date
  fechaHoraProgramada?: Date
  horaProgramada?: string
  bookingEstado: ReservaEstado
  bookingFee: number
  requiresLocalInvoice?: boolean
  outlet?: string
  fechaFin?: Date
  estado: SesionEstado
  productos: Producto[]
  subtotal: number
  impuesto: number
  comision: number
  total: number
  tasaImpuesto: number
  tasaComision: number
  paymentIntentInicialId?: string
  paymentIntentFinalId?: string
  checkoutSessionInicialId?: string
  checkoutSessionFinalId?: string
  montoPagadoInicial: number
  montoPagadoFinal: number
  porcentajeInicial: number
  deliveryAddress?: string
  deliveryCity?: string
  deliveryAddressConfirmedAt?: Date
  envio?: Envio
}

export interface Envio {
  id: string
  sesionId: string
  cajaId?: string
  labelCode?: string
  deliveryAddress?: string
  deliveryCity?: string
  trackingNumber?: string
  transportadora?: string
  metodoPagoRecibido?: PagoFinalMetodo
  fechaEnvio?: Date
  fechaEntregaEstimada?: Date
  fechaEntregaReal?: Date
  estado: EnvioEstado
  costoEnvio: number
}

// Accounting metadata only. The system never moves money between Brash3D
// Media Group LLC (USA) and Brash3D SAS (Colombia); it only records which side
// collected each final payment.
export interface BoxSettlement {
  collected: number
  viaStripe: number
  localFund: number
  cash: number
  transfer: number
  pending: number
  deliveredCount: number
  pendingCount: number
}

export interface ConsolidatedBoxManifest {
  id: string
  number: string
  country: string
  courier?: string
  trackingNumber?: string
  status: string
  createdAt: Date
  receivedAt?: Date
  customerCount: number
  productLines: number
  totalUnits: number
  settlement: BoxSettlement
  packages: Array<{
    sessionId: string
    labelCode: string
    customerName: string
    phone: string
    deliveryAddress: string
    deliveryCity: string
    remainingBalance: number
    collectedAmount: number
    paymentMethod?: PagoFinalMetodo
    requiresLocalInvoice: boolean
    products: Array<{ name: string; quantity: number; price: number }>
  }>
}

export interface PurchaseHistoryItem {
  sessionId: string
  bookedAt: Date
  outlet?: string
  status: SesionEstado
  shipmentStatus?: EnvioEstado
  paymentStatus: "paid" | "partial" | "pending"
  trackingNumber?: string
  total: number
  products: Producto[]
}

export interface CustomerPurchaseHistory {
  customer: {
    id: string
    name: string
    referralCode: string
  }
  availableReferralRewards: number
  availableReferralCredit: number
  purchases: PurchaseHistoryItem[]
}
