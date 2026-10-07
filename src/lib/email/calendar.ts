/**
 * The appointment as a calendar event: an `.ics` invitation attached to the
 * email, which Gmail, Outlook and Apple Mail show with an "add to calendar"
 * card, and a Google Calendar link for anyone whose client ignores the file.
 */

export interface CalendarEvent {
  /** Stable per booking, so a re-sent invite updates the event, not doubles it. */
  uid: string
  start: Date
  end: Date
  title: string
  description: string
  location: string
  url: string
  organizer: { name: string; email: string }
  attendee: { name: string; email: string }
}

/** 20261007T210000Z */
function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
}

/**
 * Lines longer than 75 octets are folded onto continuation lines starting
 * with a space. Folded by UTF-8 bytes, never inside a multi-byte character,
 * because Spanish copy is full of them.
 */
function fold(line: string): string {
  const parts: string[] = []
  let current = ""
  let bytes = 0
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8")
    const limit = parts.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      parts.push(current)
      current = ""
      bytes = 0
    }
    current += char
    bytes += size
  }
  parts.push(current)
  return parts.join("\r\n ")
}

export function icsInvite(event: CalendarEvent, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Brash3D//Mi Global Shopper//ES",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(event.location)}`,
    `URL:${event.url}`,
    `ORGANIZER;CN=${escapeText(event.organizer.name)}:mailto:${event.organizer.email}`,
    `ATTENDEE;CN=${escapeText(event.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${event.attendee.email}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return lines.map(fold).join("\r\n") + "\r\n"
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${icsDate(event.start)}/${icsDate(event.end)}`,
    details: `${event.description}\n\n${event.url}`,
    location: event.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
