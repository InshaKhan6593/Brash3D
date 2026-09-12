"use client"

import { Check, Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LOCALES } from "@/lib/i18n/locale"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Switches the customer screens and the Colombia panel between Spanish and
 * English. Shaped like `ModeToggle`, which sits beside it in every header.
 *
 * The language names are always in their own language -- "Español", never
 * "Spanish" -- so somebody who cannot read the current language can still find
 * the one they want.
 */
export function LanguageToggle() {
  const { locale, t, setLocale } = useLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t.language.label}>
          <Languages className="size-4" />
          <span className="sr-only">{t.language.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t.language.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALES.map((option) => (
          <DropdownMenuItem key={option} onClick={() => setLocale(option)}>
            {/* Both icons stay mounted and visibility is toggled in CSS, so the
                row never inserts or removes a DOM node -- the same reason the
                referral copy button in the session page does it this way. */}
            <Check aria-hidden className={locale === option ? undefined : "invisible"} />
            {t.language[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
