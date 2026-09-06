import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"

interface CustomerHeaderProps {
  status?: "live" | "order" | "booking"
}

export function CustomerHeader({ status = "booking" }: CustomerHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            B3D
          </span>
          <span>
            <span className="block font-bold leading-none">Brash3D</span>
            <span className="hidden text-xs text-muted-foreground sm:block">Live outlet shopping</span>
          </span>
        </Link>

        <nav className="flex items-center gap-3" aria-label="Customer navigation">
          {status === "live" && <Badge>Live session</Badge>}
          {status === "order" && <Badge variant="secondary">Order tracking</Badge>}
          <ModeToggle />
          <Button asChild variant="outline" size="sm">
            <Link href="/"><CalendarDays />Book a session</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}
