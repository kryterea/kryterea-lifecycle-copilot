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
    // The first page opened fixes the app's origin; any later page load elsewhere is refused before it is sent.
    let origin: string | null = null;
    await context.route("**", (route) => {
      const r = route.request();
      if (origin && r.isNavigationRequest() && r.frame() === page.mainFrame() && new URL(r.url()).origin !== origin) return route.abort("blockedbyclient");
      return route.continue();
    });
    const page = await context.newPage();
    return {
      goto: async (url) => {
        origin ??= new URL(url).origin;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
      },
      snapshot: () => page.locator("body").ariaSnapshot({ timeout: STEP_TIMEOUT_MS }),
      act: async (a) => {
        // The role comes from the model; Playwright rejects one it does not know, and the step is logged as not done.
        const target = page.getByRole(a.role as Parameters<typeof page.getByRole>[0], a.name ? { name: a.name } : {}).first();
        if (a.kind === "click") await target.click({ timeout: STEP_TIMEOUT_MS });
        else if (a.kind === "fill") await target.fill(a.value ?? "", { timeout: STEP_TIMEOUT_MS });
        await page.waitForLoadState("domcontentloaded", { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
      },
      screenshot: () => page.screenshot(),
      url: () => page.url(),
      close: () => context.close(),
    };
  };
  return { open, close: () => browser.close() };
}
