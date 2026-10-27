import type { OpenPage } from "@lifecycle/core";

const STEP_TIMEOUT_MS = 8_000;
const LOAD_TIMEOUT_MS = 15_000;

/**
 * A Playwright browser for QA to use the project's running app. Each test gets a fresh context (no shared cookies).
 * Null when Chromium cannot start (not installed: `npx playwright install chromium`); QA then reads code only.
 */
export async function playwrightBrowser(): Promise<{ open: OpenPage; close: () => Promise<void> } | null> {
  const { chromium } = await import("playwright");
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.warn(`QA in the running app is off: Chromium did not start (${String(e).split("\n")[0]}).`);
    return null;
  }
  const open: OpenPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // The first page opened fixes the app's origin; any later page load elsewhere, in this page or a popup, is refused
    // before it is sent. Playwright does not route the hops of a redirect, so each hop is fetched here, checked, and
    // loaded as a fresh page whose next load comes back through this route. Iframes and the app's own requests pass.
    let origin: string | null = null;
    const hops = new Set<string>();
    await context.route("**", async (route) => {
      const r = route.request();
      if (!origin || !r.isNavigationRequest() || subFrame(r)) return route.continue();
      if (new URL(r.url()).origin !== origin) return route.abort("blockedbyclient");
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.status() >= 300 && response.status() < 400 ? response.headers().location : undefined;
      hops.delete(r.url());
      if (!location) return route.fulfill({ response });
      const next = new URL(location, r.url());
      if (next.origin !== origin) return route.abort("blockedbyclient");
      hops.add(r.url());
      // A parsed URL's href is percent-encoded, so it cannot close the attribute.
      return route.fulfill({ status: 200, contentType: "text/html", body: `<meta http-equiv="refresh" content="0;url=${next.href}">` });
    });
    const page = await context.newPage();
    const settle = () => page.waitForURL((u) => !hops.has(u.href), { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS }).catch(() => {});
    return {
      goto: async (url) => {
        origin ??= new URL(url).origin;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
        await settle();
      },
      snapshot: () => page.locator("body").ariaSnapshot({ timeout: STEP_TIMEOUT_MS }),
      act: async (a) => {
        // The role comes from the model; Playwright rejects one it does not know, and the step is logged as not done.
        const target = page.getByRole(a.role as Parameters<typeof page.getByRole>[0], a.name ? { name: a.name } : {}).first();
        if (a.kind === "click") await target.click({ timeout: STEP_TIMEOUT_MS });
        else if (a.kind === "fill") await target.fill(a.value ?? "", { timeout: STEP_TIMEOUT_MS });
        await page.waitForLoadState("domcontentloaded", { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
        await settle();
      },
      screenshot: () => page.screenshot(),
      url: () => page.url(),
      close: () => context.close(),
    };
  };
  return { open, close: () => browser.close() };
}

/** A popup's first load has no frame yet; that is a top-level page, not an iframe. */
function subFrame(r: import("playwright").Request): boolean {
  try {
    return r.frame().parentFrame() !== null;
  } catch {
    return false;
  }
}
