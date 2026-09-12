import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { DEFAULT_COUNTRY } from "@/lib/countries"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Customer-facing screens and the local-team panel are shown in Spanish; the
// USA seller/admin dashboard stays in English. The locale is the destination
// country's, so a second country formats its own dates and numbers without
// these call sites changing. `DEFAULT_COUNTRY` keeps today's `es-CO` behaviour
// wherever the country is not known -- the public booking page, for instance,
// which runs before a customer record exists.
export function formatDateTimeEs(date: Date | string, locale: string = DEFAULT_COUNTRY.locale): string {
  return new Date(date).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatPercent(rate: number, locale: string = DEFAULT_COUNTRY.locale): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate * 100)}%`
}
