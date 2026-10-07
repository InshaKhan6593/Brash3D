import Image from "next/image"
import { cn } from "@/lib/utils"

/**
 * The client's two marks. Mi Global Shopper is the brand customers see, a round
 * badge; Brash3D Technologies is the company behind it, a wordmark that fronts
 * the staff screens. Both come from the files the client supplied.
 */

export function BrandLogo({ size, className, priority }: { size: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/mi-global-shopper.png"
      alt="Mi Global Shopper"
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0 rounded-full ring-1 ring-border", className)}
    />
  )
}

/** The Brash3D wordmark's own proportions (735 × 182). */
const WORDMARK_RATIO = 735 / 182

/**
 * The wordmark's grey letters vanish on a dark background, so in dark mode it
 * sits on a small white plate rather than being recoloured -- the client's
 * logo stays exactly as supplied.
 */
export function BrandWordmark({ height, className, priority }: { height: number; className?: string; priority?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 dark:rounded-md dark:bg-white dark:px-2 dark:py-1", className)}>
      <Image
        src="/brand/brash3d-wordmark.png"
        alt="Brash3D Technologies"
        width={Math.round(height * WORDMARK_RATIO)}
        height={height}
        priority={priority}
      />
    </span>
  )
}
