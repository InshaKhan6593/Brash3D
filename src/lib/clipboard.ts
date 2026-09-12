/**
 * Copies text and reports whether it worked, without throwing.
 *
 * `navigator.clipboard` is not always there and not always allowed: the API is
 * absent outside a secure context, and browsers reject the write when the page
 * is not focused or the call is too far from the click that prompted it. Both
 * arrive as a rejected promise.
 *
 * Every call site here previously either swallowed that rejection in an empty
 * `catch` or did not guard it at all, so a blocked clipboard looked exactly
 * like a successful copy -- and the seller pasted whatever had been in the
 * clipboard beforehand. Returning a boolean forces the caller to say which
 * happened.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
