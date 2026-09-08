import os
import re

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("BRASH3D_BASE_URL", "http://localhost:3000")
SELLER_EMAIL = "maria@brash3d.com"
SELLER_PASSWORD = os.environ.get("BRASH3D_QA_SELLER_PASSWORD")
LOCAL_TEAM_EMAIL = "colombia@brash3d.com"
LOCAL_TEAM_PASSWORD = os.environ.get("BRASH3D_QA_LOCAL_TEAM_PASSWORD")


def login_as_seller(page):
    if not SELLER_PASSWORD:
        raise RuntimeError("BRASH3D_QA_SELLER_PASSWORD is required")
    page.goto(f"{BASE_URL}/login")
    page.locator("#email").fill(SELLER_EMAIL)
    page.locator("#password").fill(SELLER_PASSWORD)
    page.get_by_role("button", name="Sign in", exact=True).click()
    page.wait_for_url(re.compile(r"/seller"))
    expect(page.get_by_role("link", name=re.compile("Brash3D Seller operations"))).to_be_visible()


def open_actions(page, customer_name):
    page.get_by_role("button", name=f"Actions for {customer_name}", exact=True).click()
    return page.get_by_role("menu")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.set_default_timeout(15_000)

    login_as_seller(page)

    # Seller assignment visibility and customer-link affordance.
    page.get_by_role("button", name="Sessions", exact=True).click()
    expect(page.get_by_role("columnheader", name="Assignment", exact=True)).to_be_visible()
    expect(page.get_by_text("Maria Garcia", exact=True).first).to_be_visible()
    menu = open_actions(page, "Fixture Active Shopper")
    menu.get_by_role("menuitem", name="Generate customer access link", exact=True).click()
    page.wait_for_timeout(250)
    copied_link = page.evaluate("navigator.clipboard.readText()")
    assert "/access/session/" in copied_link, "Generated customer access link was not copied"
    menu = open_actions(page, "Fixture Active Shopper")
    expect(menu.get_by_role("menuitem", name="Open customer view", exact=True)).to_be_visible()
    page.keyboard.press("Escape")

    # Active shopper now has a completed fixture order, so history is observable.
    page.get_by_role("button", name="Customers", exact=True).click()
    menu = open_actions(page, "Fixture Active Shopper")
    menu.get_by_role("menuitem", name="View purchase history", exact=True).click()
    expect(page.get_by_text("Order history", exact=True)).to_be_visible()
    expect(page.get_by_text(re.compile(r"1 order"))).to_be_visible()
    page.get_by_role("button", name="Back to customers", exact=True).click()

    # Dispatched shipment status is explicit in the session detail.
    page.get_by_role("button", name="Sessions", exact=True).click()
    page.get_by_label("Search sessions").fill("Fixture In Transit")
    menu = open_actions(page, "Fixture In Transit")
    menu.get_by_role("menuitem", name="View shipment tracking", exact=True).click()
    expect(page.get_by_text("Shipment: In transit", exact=True)).to_be_visible()
    expect(page.get_by_text("Current status: In transit", exact=True)).to_be_visible()
    page.get_by_role("link", name="Seller dashboard", exact=True).click()

    # Pending-box append, dispatch, and post-dispatch lock are exercised in one isolated flow.
    page.get_by_role("button", name="Shipping", exact=True).click()
    pending_row = page.locator("tr").filter(has_text="TS-PENDING-001")
    pending_row.get_by_role("button", name="Ship", exact=True).click()
    page.get_by_role("button", name="Back", exact=True).click()
    page.get_by_role("button", name="Assign shipments", exact=True).click()
    shipment_label = page.locator("label").filter(has_text="TS-LABEL-002").first
    shipment_label.locator("input").check()
    expect(page.get_by_role("button", name="Assign selected (1)", exact=True)).to_be_visible()
    page.get_by_role("button", name="Assign selected (1)", exact=True).click()
    expect(page.get_by_text("Fixture Shipment Two", exact=True)).to_be_visible()
    page.get_by_role("button", name="Ship box", exact=True).click()
    page.get_by_role("button", name="Confirm and ship", exact=True).click()
    expect(page.get_by_text("Dispatch box shipped and locked.", exact=True)).to_be_visible()
    pending_row = page.locator("tr").filter(has_text="TS-PENDING-001")
    expect(pending_row.get_by_text("Shipped", exact=True)).to_be_visible()
    pending_row.get_by_role("button", name="Open", exact=True).click()
    expect(page.get_by_role("button", name="Assign shipments", exact=True)).not_to_be_visible()

    # A local-team user is denied seller tools and lands on the correct role area.
    if not LOCAL_TEAM_PASSWORD:
        raise RuntimeError("BRASH3D_QA_LOCAL_TEAM_PASSWORD is required")
    local_context = browser.new_context(viewport={"width": 1440, "height": 1000})
    local_page = local_context.new_page()
    local_page.goto(f"{BASE_URL}/login")
    local_page.locator("#email").fill(LOCAL_TEAM_EMAIL)
    local_page.locator("#password").fill(LOCAL_TEAM_PASSWORD)
    local_page.get_by_role("button", name="Sign in", exact=True).click()
    local_page.wait_for_url(re.compile(r"/local-team"))
    local_page.goto(f"{BASE_URL}/seller")
    local_page.wait_for_url(re.compile(r"/local-team"))
    expect(local_page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
    local_context.close()

    print("focused-ui-smoke: PASS")
    context.close()
    browser.close()
