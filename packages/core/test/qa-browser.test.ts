import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MAX_STEPS,
  exploreFlow,
  type AppPage,
  type CopilotRecord,
  type Criterion,
  type Model,
  type ModelRequest,
  type PageAction,
  type Packs,
  type RoleContext,
} from "../src/index.js";

const screens = mkdtempSync(join(tmpdir(), "lifecycle-screens-"));
afterAll(() => rmSync(screens, { recursive: true, force: true }));

const packs: Packs = { role: { ba: "", architect: "", qa: "QA PACK", compliance: "", po: "" }, legal: [] };
const APP = "http://localhost:3000/";
const PNG = new Uint8Array([137, 80, 78, 71]);
const CRIT: Criterion = { id: "k1", projectId: "p1", changeId: "c1", text: "A customer can book a slot", isFailurePath: false, createdAt: "t" };

/** A static local page: it records every action and moves to /done after a click on "Book". */
function fakePage() {
  const actions: PageAction[] = [];
  let url = "";
  let closed = false;
  const page: AppPage = {
    goto: async (u) => {
      url = u;
    },
    snapshot: async () => `- heading "Glow Studio"\n- button "Book"`,
    act: async (a) => {
      actions.push(a);
      if (a.kind === "click" && a.name === "Book") url = new URL("/done", url).href;
      if (a.kind === "click" && a.name === "Instagram") url = "https://instagram.com/glow";
    },
    screenshot: async () => PNG,
    url: () => url,
    close: async () => {
      closed = true;
    },
  };
  return { page, actions, closed: () => closed, open: async () => page };
}

function model(steps: Array<Partial<PageAction>>, judge: Record<string, unknown> = {}) {
  const calls: ModelRequest[] = [];
  let i = 0;
  const m = (async (req: ModelRequest) => {
    calls.push(req);
    const data =
      req.name === "qa.exploreStep"
        ? { kind: "click", role: "button", name: "Book", value: null, reason: "try it", ...(steps[Math.min(i++, steps.length - 1)] ?? {}) }
        : { state: "evidence_found", note: "The booking shows as confirmed.", title: null, plain: null, costIfIgnored: null, fixPrompt: null, ...judge };
    return { data, usage: { input: 0, output: 0 }, costUsd: 0 };
  }) as Model;
  return { m, calls };
}

const ctx = (m: Model): RoleContext => ({
  record: {} as CopilotRecord,
  model: m,
  packs,
  project: { id: "p1", name: "Salon", repoUrl: "x", appUrl: APP, createdAt: "t" },
  change: { id: "c1", projectId: "p1", title: "Bookings", description: "Book a slot.", kind: "feature", stage: "verification", createdAt: "t" },
  repo: { dir: ".", commit: "abc1234" },
  runId: "r1",
  existingFindings: [],
  answers: [],
});

describe("QA in the running app", () => {
  it("stops after 8 steps and returns no_evidence", async () => {
    const f = fakePage();
    const { m, calls } = model([{ kind: "click", name: "Book" }]);
    const r = await exploreFlow(ctx(m), CRIT, APP, f.open);
    expect(MAX_STEPS).toBe(8);
    expect(calls.filter((c) => c.name === "qa.exploreStep")).toHaveLength(8);
    expect(calls.some((c) => c.name === "qa.judgeFlow")).toBe(false);
    expect(r.check).toMatchObject({ state: "no_evidence", evidence: [], criterionId: "k1", runId: "r1" });
    expect(f.closed()).toBe(true);
  });

  it("judges from the screenshots once the model is done, and cites the last screen", async () => {
    const f = fakePage();
    const { m, calls } = model([{ kind: "fill", role: "textbox", name: "Email", value: "test@example.com" }, { kind: "click", name: "Book" }, { kind: "done" }]);
    const r = await exploreFlow(ctx(m), CRIT, APP, f.open, screens);
    expect(f.actions.map((a) => a.kind)).toEqual(["fill", "click"]);
    const judge = calls.find((c) => c.name === "qa.judgeFlow")!;
    expect(judge.images).toHaveLength(3);
    expect(judge.images![0]).toMatch(/^data:image\/png;base64,/);
    // The typed text never reaches the judge, only that something was typed.
    expect(judge.user).not.toContain("test@example.com");
    expect(r.check.state).toBe("evidence_found");
    expect(r.check.evidence).toEqual([{ type: "screen", url: "http://localhost:3000/done", screenshotPath: "r1-k1-3.png" }]);
    expect(r.screenshots).toEqual(["r1-k1-1.png", "r1-k1-2.png", "r1-k1-3.png"]);
    expect(existsSync(join(screens, "r1-k1-3.png"))).toBe(true);
  });

  it("a gap seen in the app becomes a finding tied to the criterion", async () => {
    const f = fakePage();
    const { m } = model([{ kind: "done" }], { state: "gap", note: "No confirmation shows.", title: "Booking shows no confirmation", plain: "The page stays blank.", costIfIgnored: "Customers book twice.", fixPrompt: "Show a confirmation after booking." });
    const r = await exploreFlow(ctx(m), CRIT, APP, f.open);
    expect(r.check.state).toBe("gap");
    expect(r.finding).toMatchObject({ kind: "conformance", title: "Booking shows no confirmation", criterionId: "k1", trigger: { type: "screen", url: APP } });
    expect(r.finding!.fixPrompt).toContain(APP);
  });

  it("never leaves the app: a goto or a link to another site ends the test with no evidence", async () => {
    const away = model([{ kind: "goto", value: "https://evil.example/steal" }]);
    const f1 = fakePage();
    expect((await exploreFlow(ctx(away.m), CRIT, APP, f1.open)).check.state).toBe("no_evidence");
    expect(away.calls.some((c) => c.name === "qa.judgeFlow")).toBe(false);

    const link = model([{ kind: "click", name: "Instagram" }]);
    const f2 = fakePage();
    expect((await exploreFlow(ctx(link.m), CRIT, APP, f2.open)).check.note).toMatch(/off the app/);
    expect(f2.closed()).toBe(true);

    // The first page itself redirects elsewhere: nothing is looked at or sent to the model.
    const redirect = model([{ kind: "done" }]);
    const f3 = fakePage();
    f3.page.goto = async () => {};
    f3.page.url = () => "https://elsewhere.example/";
    const shot = f3.page.screenshot;
    let shots = 0;
    f3.page.screenshot = async () => (shots++, shot());
    expect((await exploreFlow(ctx(redirect.m), CRIT, APP, f3.open)).check.state).toBe("no_evidence");
    expect(redirect.calls).toHaveLength(0);
    expect(shots).toBe(0);
  });
});
