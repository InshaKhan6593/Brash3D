"use client"

import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LanguageToggle } from "@/components/language-toggle"
import { ModeToggle } from "@/components/mode-toggle"
import { useLocale } from "@/lib/i18n/provider"

interface CustomerHeaderProps {
  status?: "live" | "order" | "booking"
}

export function CustomerHeader({ status = "booking" }: CustomerHeaderProps) {
  const { t } = useLocale()

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
            <span className="hidden truncate text-xs text-muted-foreground sm:block">{t.header.tagline}</span>
          </span>
        </Link>

        <nav className="flex shrink-0 items-center gap-2" aria-label={t.header.nav}>
          {status === "live" && <Badge>{t.header.live}</Badge>}
          {status === "order" && <Badge variant="secondary">{t.header.order}</Badge>}
          <LanguageToggle />
          <ModeToggle />
          {showBookingLink && (
            <Button asChild variant="outline" size="sm">
              <Link href="/"><CalendarDays /><span className="hidden sm:inline">{t.header.bookAnother}</span><span className="sm:hidden">{t.header.bookAnotherShort}</span></Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  )
}
