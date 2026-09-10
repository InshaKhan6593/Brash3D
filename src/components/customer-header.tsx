import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"

interface CustomerHeaderProps {
  status?: "live" | "order" | "booking"
}

export function CustomerHeader({ status = "booking" }: CustomerHeaderProps) {
  // "Reservar sesión" only makes sense once the customer has an order to leave
  // behind. On the booking page it links to the page they are already on, and
  // during a live call it invites them away from their own cart mid-session.
  const showBookingLink = status === "order"

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            B3D
          </span>
          <span className="min-w-0">
            <span className="block truncate font-bold leading-none">Brash3D</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:block">Compras en vivo desde el outlet</span>
          </span>
        </Link>

        <nav className="flex shrink-0 items-center gap-2" aria-label="Navegación del cliente">
          {status === "live" && <Badge>Sesión en vivo</Badge>}
          {status === "order" && <Badge variant="secondary">Seguimiento del pedido</Badge>}
          <ModeToggle />
          {showBookingLink && (
            <Button asChild variant="outline" size="sm">
              <Link href="/"><CalendarDays /><span className="hidden sm:inline">Reservar otra sesión</span><span className="sm:hidden">Reservar</span></Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  )
}
