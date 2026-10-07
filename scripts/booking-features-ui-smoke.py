"""
End-to-end UI check of the half-hour booking features, through a real browser.

Covers what the client asked for in October 2026 and what was built for it:

1. Booking page: booking lengths and prices, the Florida-time label, the
   required "Outlet o tienda" field, and a booking that reaches Stripe.
2. Half-hour blocking: every half hour the booking spans shows as taken.
3. Seller, from the booking email's link while signed out: sign-in returns to
   that session, which shows the customer's store; start, extend 30 minutes
   (+10 USD), and end without a purchase.
4. Customer: the extra time is one 10 USD payment with no delivery address, and
   paying it opens Stripe.
5. Colombia team: signs in, and the extra-time order never reaches their panel.

Run against the local app with the dev server up:

    BRASH3D_QA_SELLER_PASSWORD='...' BRASH3D_QA_LOCAL_TEAM_PASSWORD='...' \\
      DATABASE_URL='postgresql://...' python scripts/booking-features-ui-smoke.py

It books a real slot and confirms it in SQL the way the Stripe webhook would,
so point it only at a local or demo database. Everything it creates belongs to
a `fixture+ui-…@brash3d.test` customer and is deleted at the end.
"""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg
from playwright.sync_api import expect, sync_playwright

BASE_URL = os.environ.get("BRASH3D_BASE_URL", "http://localhost:3000")
DATABASE_URL = os.environ.get("DATABASE_URL")
SELLER_EMAIL = "maria@brash3d.com"
SELLER_PASSWORD = os.environ.get("BRASH3D_QA_SELLER_PASSWORD")
LOCAL_TEAM_EMAIL = "colombia@brash3d.com"
LOCAL_TEAM_PASSWORD = os.environ.get("BRASH3D_QA_LOCAL_TEAM_PASSWORD")

if not (DATABASE_URL and SELLER_PASSWORD and LOCAL_TEAM_PASSWORD):
    sys.exit("Set DATABASE_URL, BRASH3D_QA_SELLER_PASSWORD and BRASH3D_QA_LOCAL_TEAM_PASSWORD")

STAMP = str(int(time.time()))
CUSTOMER_NAME = f"UI Check {STAMP}"
CUSTOMER_EMAIL = f"fixture+ui-{STAMP}@brash3d.test"
STORE = "Adidas, Dolphin Mall"
STRIPE = re.compile(r"^https://checkout\.stripe\.com/")


def step(message):
    print(f"  ✓ {message}", flush=True)


def fetch_slots():
    with urllib.request.urlopen(f"{BASE_URL}/api/slots?fresh={time.time()}") as response:
        return json.load(response)["slots"]


def pick_span(slots, halves):
    """A start at least three days out with `halves` consecutive free half hours."""
    soon = (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat()
    by_day = {}
    for slot in slots:
        if slot["date"] >= soon:
            by_day.setdefault(slot["date"], []).append(slot)
    for date in sorted(by_day):
        day = by_day[date]
        for index in range(len(day) - halves + 1):
            span = day[index:index + halves]
            starts = [datetime.fromisoformat(s["startsAt"].replace("Z", "+00:00")) for s in span]
            contiguous = all(starts[i + 1] - starts[i] == timedelta(minutes=30) for i in range(halves - 1))
            if contiguous and all(s["available"] for s in span):
                return span
    raise RuntimeError(f"No day with {halves} consecutive free half hours")


def sign_in(page, email, password):
    page.locator("#email").fill(email)
    page.locator("#password").fill(password)
    page.get_by_role("button", name="Sign in", exact=True).click()


def cleanup(connection):
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM clientes WHERE email = %s", (CUSTOMER_EMAIL,))
        customers = [row[0] for row in cursor.fetchall()]
        if not customers:
            return
        cursor.execute("SELECT id, reserva_id FROM sesiones_compra WHERE cliente_id = ANY(%s)", (customers,))
        rows = cursor.fetchall()
        sessions = [row[0] for row in rows]
        bookings = [row[1] for row in rows]
        cursor.execute("DELETE FROM customer_session_access WHERE session_id = ANY(%s)", (sessions,))
        cursor.execute("DELETE FROM payment_logs WHERE sesion_id = ANY(%s) OR reserva_id = ANY(%s)", (sessions, bookings))
        cursor.execute("DELETE FROM staff_notifications WHERE reserva_id = ANY(%s)", (bookings,))
        cursor.execute("DELETE FROM session_audit_events WHERE session_id = ANY(%s)", (sessions,))
        cursor.execute("DELETE FROM envios WHERE sesion_id = ANY(%s)", (sessions,))
        cursor.execute("DELETE FROM productos_carrito WHERE sesion_id = ANY(%s)", (sessions,))
        cursor.execute("DELETE FROM sesiones_compra WHERE id = ANY(%s)", (sessions,))
        # Deleting the bookings frees every half hour they held (migration 021).
        cursor.execute("DELETE FROM reservas WHERE id = ANY(%s)", (bookings,))
        cursor.execute("DELETE FROM clientes WHERE id = ANY(%s)", (customers,))
    connection.commit()


connection = psycopg.connect(DATABASE_URL)
failed = False
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        print("Customer booking page")
        customer = browser.new_context(viewport={"width": 1280, "height": 1000}, locale="es-CO")
        page = customer.new_page()
        page.set_default_timeout(20_000)
        span = pick_span(fetch_slots(), 3)
        start = span[0]
        page.goto(BASE_URL)
        expect(page.get_by_text("el outlet o tienda de tu interés", exact=False)).to_be_visible()
        expect(page.get_by_text("costo fijo por hora de 20 USD, 30 minutos adicionales de 10 USD", exact=False)).to_be_visible()
        page.locator("#booking-date").fill(start["date"])
        page.get_by_role("radio", name="1 h 30 min · 30 USD").click()
        expect(page.get_by_text("Hora de Florida (Miami)").first).to_be_visible()
        page.locator("#horarios").get_by_role("button", name=start["time"], exact=True).click()
        expect(page.get_by_role("button", name="Pagar 30 USD y reservar")).to_be_enabled()
        step("1 h 30 costs 30 USD, times are labelled Florida time, the start is selectable")

        page.locator("#nombre").fill(CUSTOMER_NAME)
        page.locator("#email").fill(CUSTOMER_EMAIL)
        page.locator("#telefono").fill(f"300 555 {STAMP[-4:]}")
        page.locator("#ciudad").fill("Bogotá")
        page.get_by_role("button", name="Pagar 30 USD y reservar").click()
        assert page.locator("#tienda").evaluate("element => !element.validity.valid"), "store field should be required"
        expect(page).to_have_url(re.compile(r"localhost"))
        step("the booking is refused without a store")

        page.locator("#tienda").fill(STORE)
        page.get_by_role("button", name="Pagar 30 USD y reservar").click()
        page.wait_for_url(STRIPE, timeout=30_000)
        step("with a store, the booking opens Stripe Checkout")

        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT sc.id::text, r.id::text, r.duracion_minutos, r.monto_reserva, r.tienda_solicitada
                FROM reservas r JOIN sesiones_compra sc ON sc.reserva_id = r.id
                JOIN clientes c ON c.id = r.cliente_id WHERE c.email = %s
            """, (CUSTOMER_EMAIL,))
            session_id, booking_id, minutes, fee, store = cursor.fetchone()
            assert (minutes, float(fee), store) == (90, 30.0, STORE), (minutes, fee, store)
            # What the Stripe booking webhook does once the fee is paid.
            cursor.execute("UPDATE reservas SET estado = 'confirmada', confirmed_at = now() WHERE id = %s::uuid", (booking_id,))
        connection.commit()
        step("stored as 90 minutes, 30 USD, with the store as typed; confirmed as the webhook would")

        page.goto(f"{BASE_URL}/?fresh={STAMP}")
        page.locator("#booking-date").fill(start["date"])
        grid = page.locator("#horarios")
        for slot in span:
            expect(grid.get_by_role("button", name=re.compile(rf"^{re.escape(slot['time'])}"))).to_be_disabled()
        step("all three half hours of the booking now show as taken")

        print("Seller, from the email link")
        seller = browser.new_context(viewport={"width": 1440, "height": 1000})
        seller_page = seller.new_page()
        seller_page.set_default_timeout(20_000)
        seller_page.goto(f"{BASE_URL}/seller?sessionId={session_id}")
        seller_page.wait_for_url(re.compile(r"/login\?next="))
        expect(seller_page.get_by_role("img", name="Brash3D Technologies")).to_be_visible()
        sign_in(seller_page, SELLER_EMAIL, SELLER_PASSWORD)
        seller_page.wait_for_url(re.compile(rf"/seller\?sessionId={session_id}"))
        step("signed out, the link signs in and lands on that session")

        expect(seller_page.get_by_text(STORE, exact=False).first).to_be_visible()
        step("the session shows the store the customer wrote")

        seller_page.get_by_role("button", name="Start live session").click()
        seller_page.get_by_role("button", name="Extend 30 min (+$10.00)").click()
        expect(seller_page.get_by_text("Extra time 30 min")).to_be_visible()
        expect(seller_page.get_by_text("2 h", exact=False).first).to_be_visible()
        step("started, then extended: 2 h call, 10 USD of extra time on the order summary")

        seller_page.get_by_role("button", name="End session without a purchase").click()
        dialog = seller_page.get_by_role("dialog")
        expect(dialog).to_contain_text("the extra time is still charged")
        dialog.get_by_role("button", name="End without a purchase").click()
        expect(seller_page.get_by_text("Extra time only", exact=True)).to_be_visible()
        expect(seller_page.get_by_role("button", name=re.compile("Create shipment"))).to_have_count(0)
        step("ended with nothing bought: an extra-time-only invoice, nothing to ship")

        print("Customer order page")
        page.goto(f"{BASE_URL}/session/{session_id}")
        expect(page.get_by_text("Solo se cobra el tiempo adicional")).to_be_visible()
        expect(page.get_by_text("Pago del tiempo adicional")).to_be_visible()
        expect(page.locator("#delivery-address")).to_have_count(0)
        page.get_by_role("button", name="Pagar $10.00").click()
        page.wait_for_url(STRIPE, timeout=30_000)
        step("one 10 USD payment, no delivery address, and Pagar opens Stripe")

        print("Colombia team")
        local = browser.new_context(viewport={"width": 1280, "height": 900})
        local_page = local.new_page()
        local_page.set_default_timeout(20_000)
        local_page.goto(f"{BASE_URL}/login")
        sign_in(local_page, LOCAL_TEAM_EMAIL, LOCAL_TEAM_PASSWORD)
        local_page.wait_for_url(re.compile(r"/local-team"))
        expect(local_page.get_by_role("button", name=re.compile("Cerrar sesión|Sign out"))).to_be_visible()
        expect(local_page.get_by_text(CUSTOMER_NAME)).to_have_count(0)
        step("signs in to the Colombia panel, where the extra-time order never appears")

        browser.close()
    print("\nBooking features UI smoke test passed.")
except Exception:
    failed = True
    raise
finally:
    cleanup(connection)
    connection.close()
    print("Cleaned up the test customer, booking and session." + (" (after a failure)" if failed else ""))
