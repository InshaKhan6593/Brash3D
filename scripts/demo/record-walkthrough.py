"""
Records the client walkthrough video with DemoDSL: one customer's order from
booking to delivery, narrated in Spanish, recorded against the local app.

    Customer books  ->  seller runs the live session  ->  customer watches the
    cart  ->  seller closes and invoices  ->  customer pays  ->  seller ships in
    a consolidated box  ->  Colombia receives, collects and delivers  ->
    customer sees the order complete.

Each chapter is its own DemoDSL recording. Between chapters this script does
what a real customer's card would trigger through Stripe's webhook -- marking
the booking fee and the up-front payment as paid -- so no card is typed on
camera. The chapters are then joined into one MP4.

Prerequisites: the local database and dev server running, `pip install
"demodsl[gtts]" psycopg pyyaml`, `playwright install chromium`, and ffmpeg.

    BRASH3D_QA_SELLER_PASSWORD='...' BRASH3D_QA_LOCAL_TEAM_PASSWORD='...' \\
      DATABASE_URL='postgresql://...' python scripts/demo/record-walkthrough.py

Options: --chapters 1,2 records only those; --skip-voice and --turbo make a
fast silent preview; --keep leaves the demo order in the database.

Point it only at a local or demo database: it writes payment rows that no
money backs. Everything it creates belongs to a `fixture+demo-…@brash3d.test`
customer and is deleted at the end unless --keep is given.
"""

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import yaml

BASE_URL = os.environ.get("BRASH3D_BASE_URL", "http://localhost:3000")
DATABASE_URL = os.environ.get("DATABASE_URL")
SELLER_EMAIL = "maria@brash3d.com"
SELLER_PASSWORD = os.environ.get("BRASH3D_QA_SELLER_PASSWORD")
LOCAL_TEAM_EMAIL = "colombia@brash3d.com"
LOCAL_TEAM_PASSWORD = os.environ.get("BRASH3D_QA_LOCAL_TEAM_PASSWORD")

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "demo"

STAMP = str(int(time.time()))
CUSTOMER = {
    "name": "Camila Rodríguez",
    "email": f"fixture+demo-{STAMP}@brash3d.test",
    "phone": f"300 555 {STAMP[-4:]}",
    "city": "Bogotá",
    "store": "Nike, Sawgrass Mills",
    "address": "Calle 93 #11-26, apartamento 502",
}
PRODUCTS = [("Tenis Nike Pegasus", "95"), ("Chaqueta Windrunner", "68")]
START_TIME = "3:00 PM"  # Florida time on the booking grid

VIEWPORT = {"width": 1280, "height": 720}


def css(value):
    return {"type": "css", "value": value}


def text(value):
    return {"type": "text", "value": value}


def say(step, narration, wait=None):
    step["narration"] = narration
    if wait is not None:
        step["wait"] = wait
    return step


def config(title, url, steps):
    return {
        "metadata": {"title": title},
        "voice": {"engine": "gtts", "voice_id": "es"},
        "subtitle": {"enabled": True, "style": "classic"},
        "scenarios": [{
            "name": title,
            "url": url,
            "browser": "chrome",
            "viewport": VIEWPORT,
            "on_error": "fail",
            "steps": steps,
        }],
        "pipeline": [
            {"generate_narration": {}},
            {"edit_video": {}},
            {"mix_audio": {}},
            {"burn_subtitles": {}},
            {"optimize": {"format": "mp4"}},
        ],
        "output": {"filename": f"{title}.mp4", "formats": ["mp4"]},
    }


def login(email, password, destination, narration):
    return [
        say({"action": "navigate", "url": f"{BASE_URL}/login?next={urllib.request.quote(destination, safe='')}"}, narration, 1.0),
        {"action": "type", "locator": css("#email"), "value": email, "char_rate": 30},
        {"action": "type", "locator": css("#password"), "value": password},
        {"action": "click", "locator": css('form button:has-text("Sign in")'), "wait": 3.0},
    ]


# --- chapters ---------------------------------------------------------------

def chapter_booking(state):
    c = CUSTOMER
    return config("01 Reserva del cliente", BASE_URL, [
        say({"action": "navigate", "url": BASE_URL},
            "Esta es la página de reservas de Mi Global Shopper. El cliente agenda una sesión de compra en vivo con su comprador personal.", 1.0),
        say({"action": "type", "locator": css("#booking-date"), "value": state["date"]},
            "Primero elige la fecha de su cita.", 1.0),
        say({"action": "hover", "locator": text("1 h 30 min · 30 USD")},
            "Puede reservar una hora por 20 dólares, o sumar media hora adicional por 10 dólares más.", 1.0),
        say({"action": "click", "locator": css(f'#horarios button:has-text("{START_TIME}")')},
            "Los horarios están en hora de Florida, cada media hora. Los que ya están ocupados aparecen deshabilitados.", 1.0),
        say({"action": "type", "locator": css("#tienda"), "value": c["store"], "char_rate": 18},
            "En la cita seleccionada escribe el outlet o la tienda donde quiere que compremos por él.", 0.5),
        {"action": "type", "locator": css("#nombre"), "value": c["name"], "char_rate": 20},
        {"action": "type", "locator": css("#email"), "value": c["email"], "char_rate": 30},
        {"action": "type", "locator": css("#telefono"), "value": c["phone"], "char_rate": 20},
        say({"action": "type", "locator": css("#ciudad"), "value": c["city"], "char_rate": 20},
            "Completa sus datos. Su correo recibe la confirmación con la invitación de calendario, y su WhatsApp el enlace de su pedido.", 0.5),
        say({"action": "click", "locator": text("Pagar 20 USD y reservar"), "wait": 4.0},
            "Paga la reserva con Stripe, de forma segura. El horario queda apartado mientras paga."),
        say({"action": "pause", "wait": 2.0},
            "Cuando el pago se confirma, la cita queda reservada para él."),
    ])


def chapter_live(state):
    steps = login(SELLER_EMAIL, SELLER_PASSWORD, f"/seller?sessionId={state['session_id']}",
                  "A la hora de la cita, el comprador personal abre la sesión desde su panel.")
    steps += [
        say({"action": "click", "locator": text("Start live session"), "wait": 2.0},
            "Inicia la sesión en vivo y llama al cliente por videollamada de WhatsApp desde la tienda."),
    ]
    for index, (name, price) in enumerate(PRODUCTS):
        steps += [
            {"action": "type", "locator": css("#product-name"), "value": name, "char_rate": 20},
            {"action": "type", "locator": css("#product-price"), "value": price, "char_rate": 10},
            say({"action": "click", "locator": text("Add to cart"), "wait": 1.5},
                "Agrega cada producto que el cliente elige, con su precio." if index == 0
                else "El carrito se actualiza al instante para el cliente."),
        ]
    steps += [
        say({"action": "click", "locator": text("Extend 30 min (+$10.00)"), "wait": 2.0},
            "Si el cliente necesita más tiempo, el vendedor extiende la llamada media hora. Se suman 10 dólares a la factura, solo si nadie tiene la siguiente cita."),
    ]
    return config("02 Sesion en vivo", BASE_URL, steps)


def chapter_cart(state):
    return config("03 Carrito en vivo", state["customer_url"], [
        say({"action": "navigate", "url": state["customer_url"], "wait": 2.0},
            "Mientras tanto, el cliente ve su carrito en vivo desde su teléfono, sin instalar ninguna aplicación."),
        say({"action": "scroll", "direction": "down", "pixels": 300, "wait": 1.5},
            "Ve cada producto y el subtotal de la mercancía. El impuesto y la comisión aparecen cuando se cierra la sesión."),
    ])


def chapter_close(state):
    steps = login(SELLER_EMAIL, SELLER_PASSWORD, f"/seller?sessionId={state['session_id']}",
                  "Al terminar la compra, el vendedor cierra la sesión.")
    steps += [
        say({"action": "click", "locator": text("Close session and invoice"), "wait": 1.5},
            "Confirma la comisión acordada con este cliente y cuánto paga por adelantado."),
        say({"action": "click", "locator": css('[role="dialog"] button:has-text("65%")'), "wait": 1.0},
            "Por ejemplo, el 65 por ciento ahora y el resto al recibir sus productos en Colombia."),
        say({"action": "click", "locator": css('[role="dialog"] button:has-text("Confirm and create invoice")'), "wait": 2.5},
            "Al cerrar, se genera la factura y el cliente la recibe en su pantalla y por WhatsApp."),
    ]
    return config("04 Cierre y factura", BASE_URL, steps)


def chapter_pay(state):
    c = CUSTOMER
    return config("05 Pago del cliente", state["customer_url"], [
        say({"action": "navigate", "url": state["customer_url"], "wait": 2.0},
            "El cliente ve su factura completa: productos, impuesto de Florida, comisión y tiempo adicional."),
        say({"action": "type", "locator": css("#delivery-address"), "value": c["address"], "char_rate": 25},
            "Confirma su dirección de entrega en Colombia.", 0.5),
        say({"action": "click", "locator": css('button:has-text("Continuar y pagar")'), "wait": 4.0},
            "Y paga la parte inicial con Stripe."),
        say({"action": "pause", "wait": 2.0},
            "Una vez confirmado el pago, su dirección queda fija y el pedido pasa a envío."),
    ])


def chapter_ship(state):
    steps = login(SELLER_EMAIL, SELLER_PASSWORD, f"/seller?sessionId={state['session_id']}",
                  "Con el pago inicial confirmado, el vendedor prepara el envío.")
    steps += [
        say({"action": "click", "locator": text("Create individual shipment"), "wait": 2.0},
            "Crea el envío del cliente, con una etiqueta para marcar el paquete."),
        say({"action": "navigate", "url": f"{BASE_URL}/seller?tab=shipping", "wait": 1.5},
            "Los envíos de varios clientes viajan juntos en una caja consolidada."),
        {"action": "click", "locator": text("Create dispatch box"), "wait": 1.0},
        {"action": "type", "locator": css("#box-courier"), "value": "DHL Express", "char_rate": 20},
        say({"action": "type", "locator": css("#box-tracking"), "value": "BR-4471", "char_rate": 15},
            "Registra la transportadora y el número de guía."),
        say({"action": "click", "locator": css(f'[role="dialog"] label:has-text("{CUSTOMER["name"]}")'), "wait": 1.0},
            "Selecciona los envíos que van en la caja."),
        {"action": "click", "locator": css('[role="dialog"] button:has-text("Review dispatch")'), "wait": 1.5},
        say({"action": "click", "locator": text("Create draft box"), "wait": 2.0},
            "Revisa el manifiesto con cada cliente y sus productos."),
        {"action": "click", "locator": css('tr:has-text("BR-4471") button:has-text("Ship")'), "wait": 1.5},
        say({"action": "click", "locator": text("Confirm and ship"), "wait": 2.5},
            "Y despacha la caja. El cliente ve que su pedido va en camino a Colombia."),
    ]
    return config("06 Envio consolidado", BASE_URL, steps)


def chapter_colombia(state):
    steps = login(LOCAL_TEAM_EMAIL, LOCAL_TEAM_PASSWORD, "/local-team",
                  "En Colombia, el equipo local tiene su propio panel.")
    steps += [
        say({"action": "click", "locator": text(state["box_number"]), "wait": 1.5},
            "Ve las cajas que vienen en camino, con su guía y cuántos clientes trae cada una."),
        say({"action": "click", "locator": css('button:has-text("Confirmar recepción")'), "wait": 1.5},
            "Cuando la caja llega, revisa las etiquetas y confirma la recepción."),
        say({"action": "click", "locator": css('button:has-text("Sí, caja recibida")'), "wait": 2.0},
            "Los paquetes pasan a la lista de entregas."),
        say({"action": "click", "locator": css('button:has-text("Entregas a clientes")'), "wait": 2.0},
            "Cada entrega muestra al cliente, su ciudad y el saldo pendiente."),
        say({"action": "click", "locator": css('button:has-text("Ver pedido")'), "wait": 3.0},
            "Al abrir el pedido, ve la dirección, los productos que debe entregar, lo que ya pagó y el saldo por cobrar."),
        say({"action": "click", "locator": css('[role="dialog"] button:has-text("Efectivo recibido")'), "wait": 1.5},
            "Al entregar, cobra el saldo: con un link de pago de Stripe, o en efectivo."),
        say({"action": "click", "locator": css('button:has-text("Sí, recibí el efectivo")'), "wait": 2.5},
            "Registra el pago y la entrega queda confirmada. El resumen de la caja separa lo cobrado por Stripe del efectivo del equipo local."),
    ]
    return config("07 Equipo Colombia", BASE_URL, steps)


def chapter_done(state):
    return config("08 Pedido entregado", state["customer_url"], [
        say({"action": "navigate", "url": state["customer_url"], "wait": 2.0},
            "Y el cliente ve su pedido completo: reservado, comprado, pagado, enviado y entregado."),
        say({"action": "scroll", "direction": "down", "pixels": 400, "wait": 2.0},
            "Mi Global Shopper: compras en vivo en los outlets de Estados Unidos, entregadas en Colombia."),
    ])


# --- what Stripe's webhook would do between chapters ------------------------

def pick_date():
    """A day at least two days out where START_TIME and the half hour after it are free."""
    with urllib.request.urlopen(f"{BASE_URL}/api/slots?fresh={time.time()}") as response:
        slots = json.load(response)["slots"]
    soon = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    by_day = {}
    for slot in slots:
        if slot["date"] >= soon:
            by_day.setdefault(slot["date"], []).append(slot)
    for date in sorted(by_day):
        day = by_day[date]
        for index, slot in enumerate(day[:-1]):
            nxt = day[index + 1]
            if slot["time"] == START_TIME and slot["available"] and nxt["available"]:
                return date
    raise RuntimeError(f"No day with {START_TIME} free for an hour")


def confirm_booking(db, state):
    with db.cursor() as cur:
        cur.execute("""
            SELECT sc.id::text, r.id::text FROM reservas r
            JOIN sesiones_compra sc ON sc.reserva_id = r.id
            JOIN clientes c ON c.id = r.cliente_id WHERE c.email = %s
        """, (CUSTOMER["email"],))
        row = cur.fetchone()
        if not row:
            raise RuntimeError("The booking chapter did not create a booking")
        state["session_id"], booking_id = row
        cur.execute("UPDATE reservas SET estado = 'confirmada', confirmed_at = now() WHERE id = %s::uuid", (booking_id,))
        cur.execute("""
            INSERT INTO payment_logs (payment_intent_id, reserva_id, monto, tipo_pago, estado, metadata)
            SELECT %s, id, monto_reserva, 'booking_fee', 'succeeded', '{"demo": true}'::jsonb FROM reservas WHERE id = %s::uuid
        """, (f"pi_demo_{STAMP}_booking", booking_id))
        # The durable link the WhatsApp and email confirmations would carry.
        token = secrets.token_urlsafe(32)
        cur.execute("""
            INSERT INTO customer_session_access (session_id, token_hash, expires_at)
            VALUES (%s::uuid, %s, now() + interval '90 days')
        """, (state["session_id"], hashlib.sha256(token.encode()).hexdigest()))
    db.commit()
    state["customer_url"] = f"{BASE_URL}/session/{state['session_id']}?token={token}"


def confirm_initial_payment(db, state):
    with db.cursor() as cur:
        cur.execute("""
            UPDATE sesiones_compra
            SET monto_pagado_inicial = round(total * porcentaje_inicial / 100, 2),
                payment_intent_inicial_id = %s
            WHERE id = %s::uuid AND monto_pagado_inicial = 0 AND estado = 'completada'
            RETURNING monto_pagado_inicial
        """, (f"pi_demo_{STAMP}_initial", state["session_id"]))
        row = cur.fetchone()
        if not row:
            raise RuntimeError("The invoice was not closed, or is already paid")
        cur.execute("""
            INSERT INTO payment_logs (payment_intent_id, sesion_id, monto, tipo_pago, estado, metadata)
            VALUES (%s, %s::uuid, %s, 'session_inicial', 'succeeded', '{"demo": true}'::jsonb)
        """, (f"pi_demo_{STAMP}_initial", state["session_id"], row[0]))
    db.commit()


def note_box_number(db, state):
    with db.cursor() as cur:
        cur.execute("""
            SELECT c.numero_caja FROM cajas_consolidadas c
            JOIN envios e ON e.caja_id = c.id WHERE e.sesion_id = %s::uuid
        """, (state["session_id"],))
        row = cur.fetchone()
        if not row:
            raise RuntimeError("The shipping chapter did not box the order")
        state["box_number"] = row[0]


def cleanup(db):
    with db.cursor() as cur:
        # Every demo customer, so an interrupted earlier run is cleared too.
        cur.execute("SELECT id FROM clientes WHERE email LIKE 'fixture+demo-%%@brash3d.test'")
        customers = [r[0] for r in cur.fetchall()]
        if not customers:
            return
        cur.execute("SELECT sc.id, sc.reserva_id, e.caja_id FROM sesiones_compra sc LEFT JOIN envios e ON e.sesion_id = sc.id WHERE sc.cliente_id = ANY(%s)", (customers,))
        rows = cur.fetchall()
        sessions, bookings = [r[0] for r in rows], [r[1] for r in rows]
        boxes = [r[2] for r in rows if r[2]]
        for statement, values in [
            ("DELETE FROM customer_session_access WHERE session_id = ANY(%s)", (sessions,)),
            ("DELETE FROM payment_logs WHERE sesion_id = ANY(%s) OR reserva_id = ANY(%s)", (sessions, bookings)),
            ("DELETE FROM staff_notifications WHERE reserva_id = ANY(%s)", (bookings,)),
            ("DELETE FROM session_audit_events WHERE session_id = ANY(%s)", (sessions,)),
            ("DELETE FROM envios WHERE sesion_id = ANY(%s)", (sessions,)),
            ("DELETE FROM productos_carrito WHERE sesion_id = ANY(%s)", (sessions,)),
            ("DELETE FROM sesiones_compra WHERE id = ANY(%s)", (sessions,)),
            ("DELETE FROM reservas WHERE id = ANY(%s)", (bookings,)),
            ("DELETE FROM clientes WHERE id = ANY(%s)", (customers,)),
            # The demo's own box, only once nothing else is in it.
            ("DELETE FROM cajas_consolidadas c WHERE c.id = ANY(%s) AND NOT EXISTS (SELECT 1 FROM envios e WHERE e.caja_id = c.id)", (boxes,)),
        ]:
            cur.execute(statement, values)
    db.commit()


# DemoDSL starts its Remotion renderer as a bare "npx", which Windows only
# finds as npx.cmd (Git Bash's extensionless npx is not runnable). Run its CLI
# with that one name resolved.
DEMODSL = """
import shutil, subprocess, sys
from demodsl.cli import app
_popen = subprocess.Popen.__init__
def _init(self, args, *rest, **kw):
    if sys.platform == "win32" and isinstance(args, (list, tuple)) and args and args[0] == "npx":
        args = [shutil.which("npx.cmd") or "npx", *args[1:]]
    _popen(self, args, *rest, **kw)
subprocess.Popen.__init__ = _init
sys.argv[0] = "demodsl"
app()
"""


CHAPTERS = [
    (chapter_booking, confirm_booking),
    (chapter_live, None),
    (chapter_cart, None),
    (chapter_close, None),
    (chapter_pay, confirm_initial_payment),
    (chapter_ship, note_box_number),
    (chapter_colombia, None),
    (chapter_done, None),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip-voice", action="store_true")
    parser.add_argument("--turbo", action="store_true")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    if not (DATABASE_URL and SELLER_PASSWORD and LOCAL_TEAM_PASSWORD):
        sys.exit("Set DATABASE_URL, BRASH3D_QA_SELLER_PASSWORD and BRASH3D_QA_LOCAL_TEAM_PASSWORD")

    run_dir = OUT / STAMP
    run_dir.mkdir(parents=True, exist_ok=True)
    state = {"date": pick_date()}
    print(f"Recording into {run_dir} (appointment {state['date']} {START_TIME})")
    videos = []
    db = psycopg.connect(DATABASE_URL)
    # Repeated recordings book from the same address and hit the 10-per-hour
    # booking limit; start each run with a clear counter.
    with db.cursor() as cur:
        cur.execute("DELETE FROM request_rate_limits WHERE key LIKE 'booking:%'")
    db.commit()
    try:
        for number, (build, after) in enumerate(CHAPTERS, start=1):
            cfg = build(state)
            path = run_dir / f"chapter-{number:02d}.yaml"
            path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
            if not args.skip_voice:
                # Stretch each step's wait to its real spoken length, or the
                # narration runs past the end of the recorded clip.
                subprocess.run([sys.executable, "-c", DEMODSL, "estimate", str(path), "--synthesize", "--fix"],
                               env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}, check=True,
                               stdout=subprocess.DEVNULL)
            command = [sys.executable, "-c", DEMODSL, "run", str(path), "-o", str(run_dir / f"chapter-{number:02d}")]
            if args.skip_voice:
                command.append("--skip-voice")
            if args.turbo:
                command.append("--turbo")
            print(f"[{number}/{len(CHAPTERS)}] {cfg['metadata']['title']}", flush=True)
            # UTF-8 mode: on Windows DemoDSL otherwise reads the config in the
            # system code page, garbling every accent in the Spanish narration.
            result = subprocess.run(command, env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"})
            if result.returncode != 0:
                raise RuntimeError(f"Chapter {number} failed; see the DemoDSL output above")
            found = sorted((run_dir / f"chapter-{number:02d}").rglob("*.mp4"), key=lambda p: p.stat().st_mtime)
            if not found:
                raise RuntimeError(f"Chapter {number} produced no MP4")
            videos.append(found[-1])
            if after:
                after(db, state)

        # Same size and frame rate for every chapter, then one file.
        listing = run_dir / "chapters.txt"
        normalised = []
        for index, video in enumerate(videos, start=1):
            target = run_dir / f"part-{index:02d}.mp4"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
                            "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                            "-c:a", "aac", "-ar", "44100", "-ac", "2", str(target)], check=True)
            normalised.append(target)
        listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in normalised), encoding="utf-8")
        final = run_dir / "mi-global-shopper-walkthrough.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", str(listing), "-c", "copy", str(final)], check=True)
        print(f"\nWalkthrough ready: {final}")
    finally:
        if not args.keep:
            cleanup(db)
            print("Removed the demo customer and order.")
        db.close()


if __name__ == "__main__":
    main()
