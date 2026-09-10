import "server-only"

const DEFAULT_TAX_RATE = 0.07
const DEFAULT_FEE_RATE = 0.15
const DEFAULT_REFERRAL_MONTHLY_CAP = 3

// A malformed rate would silently reprice every invoice, so refuse to start
// pricing a session rather than falling back to the default without a word.
function readRate(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === "") return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`${name} must be a decimal fraction between 0 and 1, for example 0.07`)
  }
  return value
}

export function taxRate(): number {
  return readRate("TAX_RATE_FL", DEFAULT_TAX_RATE)
}

export function feeRate(): number {
  return readRate("FEE_RATE", DEFAULT_FEE_RATE)
}

// Section 14 of the specification: cap how many complimentary bookings one
// referrer can earn per month so the program cannot be farmed with fake accounts.
export function referralRewardMonthlyCap(): number {
  const raw = process.env.REFERRAL_REWARD_MONTHLY_CAP
  if (raw === undefined || raw.trim() === "") return DEFAULT_REFERRAL_MONTHLY_CAP
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("REFERRAL_REWARD_MONTHLY_CAP must be a whole number of rewards, for example 3")
  }
  return value
}
