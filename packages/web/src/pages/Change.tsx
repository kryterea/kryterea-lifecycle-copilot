import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { RoleId, StageId } from "@lifecycle/core";
import { api, message, useActor, useJob, type ChangeView, type FindingView } from "../api";
import { FindingItem } from "../components/FindingItem";
import { BackIcon, BranchIcon, CheckIcon, CloseIcon, CopyIcon, PlayIcon, PlusIcon, QuestionIcon, RecordIcon, RefreshIcon } from "../components/Icon";
import { DutyRow, EvidenceStamp, ROLES } from "../components/ProfessionalCard";
import { Instrument, JobNote, useSpend } from "../components/SpendMeter";
import { Stamp } from "../components/Stamp";
import { STAGE_NAMES, STAGES, Trail, type NodeState, type TrailStop } from "../components/Trail";

/** Who is on duty at each stage. Release recomputes the gates of everyone who raised findings. */
const ON_DUTY: Record<StageId, RoleId[]> = {
  intake: ["ba"],
  analysis: ["ba"],
  design_review: ["architect", "compliance"],
  build: [],
  verification: ["qa"],
  release: ["architect", "qa", "compliance"],
  acceptance: ["po"],
  operate: [],
};

/** The gates that must be cleared before the product owner can accept. */
const BEFORE_ACCEPTANCE: RoleId[] = ["ba", "architect", "qa", "compliance"];

/** Stages where QA needs acceptance criteria to clear. */
const NEEDS_CRITERIA: StageId[] = ["verification", "release", "acceptance"];

/** Still holding release: open, or a deferred legal finding (deferring does not clear the law). */
const unresolved = (f: FindingView) => f.status === "open" || (f.status === "deferred" && f.kind === "legal");

function line(stage: StageId, v: ChangeView, afterDelivery: number): string {
  const cleared = BEFORE_ACCEPTANCE.every((r) => v.gates[r]?.state === "cleared");
  switch (stage) {
    case "intake":
      return "The analyst reads the request and the code.";
    case "analysis":
      return v.questions.length ? "Answer the analyst, then run the next step." : "The analyst writes the acceptance criteria.";
    case "design_review":
      return "Architect and compliance review the design.";
    case "build":
      return "Your coding agent builds this. Re-check after it pushes.";
    case "verification":
      return "QA checks each criterion against the code.";
    case "release":
      return "Fix each finding or accept its risk, then run the next step.";
    case "acceptance":
      return cleared ? "Every gate is cleared. Accept to deliver." : "Waiting on held gates.";
    case "operate":
      return afterDelivery ? "New findings after delivery. Open a fix change to carry them." : "Delivered. The copilot keeps watching new pushes.";
  }
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("blocked");
    }
  };
  return (
    <button type="button" className="btn ghost sm" onClick={copy} title={state === "blocked" ? "The browser blocked the clipboard. Select the text and copy it by hand." : undefined}>
      {state === "copied" ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      {state === "copied" ? "Copied" : "Copy"}
    </button>
  );
}

/** The one place the copilot meets the coding agent: the ids the MCP tools need, and a prompt to start it. */
function Handoff({ projectId }: { projectId: string }) {
  const prompt = `Use the lifecycle-copilot MCP tools on project ${projectId}. List the open findings, fix them one at a time and call report_fix for each. Commit, then call request_recheck.`;
  return (
    <div className="block">
      <h3 className="block-head">
        <BranchIcon size={16} /> Hand to your coding agent
      </h3>
      <div className="prompt">
        <div className="prompt-head">
          <span>Project id</span>
          <CopyButton text={projectId} />
        </div>
        <p>{projectId}</p>
      </div>
      <div className="prompt">
        <div className="prompt-head">
          <span>Prompt</span>
          <CopyButton text={prompt} />
        </div>
        <p>{prompt}</p>
      </div>
    </div>
  );
}

function Questions({ changeId, questions, onSaved }: { changeId: string; questions: string[]; onSaved: () => void }) {
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.answer(changeId, { answers: answers.map((a) => a.trim()) });
      onSaved();
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <form className="block questions" onSubmit={save}>
      <h3 className="block-head">
        <QuestionIcon size={16} /> Questions from the analyst
      </h3>
      <ol>
        {questions.map((q, i) => (
          <li key={i}>
            <label>
              <span>{q}</span>
              <textarea
                rows={2}
                value={answers[i] ?? ""}
                onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
                required
                maxLength={2000}
              />
            </label>
          </li>
        ))}
      </ol>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn primary" disabled={answers.some((a) => !a.trim())}>
          <CheckIcon size={16} /> Save answers
        </button>
      </div>
    </form>
  );
}

/** The end for work that will not ship: the change stops where it is, with the reason in the record. */
function Withdraw({ changeId, onDone }: { changeId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [actor, setActor] = useActor();
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.withdraw(changeId, { reason: reason.trim(), actor: actor.trim() });
      onDone();
    } catch (err) {
      setError(message(err));
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        <CloseIcon size={15} /> Withdraw
      </button>
    );
  }
  return (
    <form className="withdraw" onSubmit={submit}>
      <input aria-label="Why withdraw" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required autoFocus />
      <input aria-label="Your name" placeholder="Your name" value={actor} onChange={(e) => setActor(e.target.value)} maxLength={100} autoComplete="name" required />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn secondary sm" disabled={!reason.trim() || !actor.trim()}>
          Withdraw change
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
          Keep
        </button>
      </div>
    </form>
  );
}

export function Change({ id }: { id: string }) {
  const [view, setView] = useState<ChangeView | null>(null);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pick, setPick] = useState<StageId | null>(null);
  const [actor, setActor] = useActor();
  const { refresh: refreshSpend } = useSpend();

  const load = useCallback(() => {
    api.change(id).then(
      (v) => {
        setView(v);
        setError(null);
      },
      (e) => setError(message(e)),
    );
  }, [id]);
  useEffect(load, [load]);

  // A stage the person picked holds until the change moves on; then the pane follows the work.
  const stage = view?.stage;
  useEffect(() => setPick(null), [stage]);

  const projectId = view?.change.projectId;
  useEffect(() => {
    if (projectId) api.project(projectId).then((p) => setProjectName(p.project.name), () => {});
  }, [projectId]);

  const { job, running, start, startError } = useJob(() => {
    load();
    refreshSpend();
  });

  if (!view || !stage) return error ? <p className="error page-pad">{error}</p> : <p className="muted page-pad">Loading.</p>;
  const { change, gates, withdrawn } = view;
  const sel = pick ?? stage;
  const now = STAGES.indexOf(stage);
  const asking = view.questions.length > 0;
  const held = ON_DUTY[stage].some((r) => gates[r]?.state === "held");
  const cleared = BEFORE_ACCEPTANCE.every((r) => gates[r]?.state === "cleared");
  const carried = new Set(view.fixChanges.filter((x) => !x.withdrawn).flatMap((x) => x.findingIds));
  const afterDelivery = stage === "operate" ? view.findings.filter((f) => f.status === "open" && !carried.has(f.id)) : [];

  const stops: TrailStop[] = STAGES.map((s, i) => {
    let state: NodeState = i < now ? "done" : i > now ? "todo" : "live";
    if (i === now && !withdrawn) {
      state = stage === "operate" ? (afterDelivery.length ? "you" : "done") : asking || held || stage === "build" || stage === "acceptance" ? "you" : "live";
    }
    const open = view.findings.filter((f) => f.stage === s && unresolved(f)).length;
    return { stage: s, state, open };
  });
  const selState = stops.find((s) => s.stage === sel)!.state;

  // Server order, so a row stays put when its status changes under the person's cursor.
  const findings = view.findings.filter((f) => (sel === "release" ? unresolved(f) : f.stage === sel || (sel === "operate" && afterDelivery.includes(f))));
  const openCount = findings.filter(unresolved).length;
  const duty = ON_DUTY[sel];
  // Open gaps the analyst found in the documents, grouped by document.
  const docGaps = new Map<string, typeof view.findings>();
  for (const f of view.findings) {
    if (f.status !== "open" || f.trigger.type !== "doc" || !f.trigger.document) continue;
    docGaps.set(f.trigger.document, [...(docGaps.get(f.trigger.document) ?? []), f]);
  }
  const isNow = sel === stage;
  const live = isNow && !withdrawn;
  const noCriteria = live && NEEDS_CRITERIA.includes(stage) && view.criteria.length === 0;
  const showRun = live && !noCriteria && stage !== "build" && stage !== "acceptance" && stage !== "operate";
  const showRecheck = live && (stage === "build" || stage === "release" || stage === "operate");
  const instrumentSteps = duty.map((r) => ({ name: ROLES[r].name, done: view.runs.find((x) => x.role === r)?.status === "done" }));

  const accept = (e: FormEvent) => {
    e.preventDefault();
    void start(() => api.accept(id, actor.trim()));
  };

  const openFixChange = async () => {
    setActionError(null);
    try {
      const fix = await api.fixChange(id);
      location.hash = `#/changes/${fix.id}`;
    } catch (e) {
      setActionError(message(e));
    }
  };

  return (
    <div className="change">
      <aside className="rail">
        <a className="back" href={`#/projects/${change.projectId}`}>
          <BackIcon size={15} /> {projectName || "Project"}
        </a>
        <h1 className="rail-title">{change.title}</h1>
        {view.follows && (
          <a className="rail-link" href={`#/changes/${view.follows.id}`}>
            Follows {view.follows.title}
          </a>
        )}
        <div className="rail-meta">
          <Stamp tone="idle">{change.kind === "understand" ? "Baseline" : change.kind === "fix" ? "Fix" : "Feature"}</Stamp>
          {withdrawn && <Stamp tone="held">Withdrawn</Stamp>}
          <a className="btn ghost sm" href={`#/changes/${id}/record`}>
            <RecordIcon size={15} /> Record
          </a>
          {!withdrawn && stage !== "operate" && !running && <Withdraw changeId={id} onDone={load} />}
        </div>
        <Trail stops={stops} selected={sel} pulse={running} onSelect={setPick} />
      </aside>

      <section className="pane" aria-labelledby="stage-title">
        <header className="pane-head">
          <div>
            <h2 id="stage-title">
              {STAGE_NAMES[sel]}
              {selState === "done" && <Stamp tone="cleared">Done</Stamp>}
              {selState === "you" && <Stamp tone="you">Needs you</Stamp>}
              {selState === "todo" && <Stamp tone="idle">Next</Stamp>}
            </h2>
            <p className="pane-line">
              {withdrawn && isNow
                ? `Withdrawn by ${withdrawn.actor}: ${withdrawn.reason}`
                : isNow
                  ? line(stage, view, afterDelivery.length)
                  : selState === "todo"
                    ? "Not reached yet."
                    : "Finished. Its findings stay below."}
            </p>
          </div>
          {(showRun || showRecheck) && (
            <div className="row">
              {showRecheck && (
                <button type="button" className={showRun || afterDelivery.length ? "btn secondary icon" : "btn primary"} disabled={running} onClick={() => start(() => api.recheck(change.projectId))} aria-label="Re-check now" title="Re-check now">
                  <RefreshIcon size={16} />
                  {!showRun && !afterDelivery.length && "Re-check now"}
                </button>
              )}
              {showRun && (
                <button type="button" className={asking ? "btn secondary" : "btn primary"} disabled={running} onClick={() => start(() => api.advance(id))}>
                  <PlayIcon size={15} /> Run next step
                </button>
              )}
            </div>
          )}
        </header>

        <JobNote job={job} startError={startError} />
        {actionError && (
          <p className="error" role="alert">
            {actionError}
          </p>
        )}
        {running && isNow && <Instrument steps={instrumentSteps} />}

        {live && asking && <Questions key={view.questions.join("\n")} changeId={id} questions={view.questions} onSaved={load} />}

        {noCriteria && (
          <div className="card delivered">
            <p>No acceptance criteria were written, so QA has nothing to check.</p>
            <button type="button" className="btn primary" disabled={running} onClick={() => start(() => api.reanalyse(id))}>
              <PlayIcon size={15} /> Run analysis again
            </button>
          </div>
        )}

        {live && stage === "acceptance" && (
          <form className="block accept" onSubmit={accept}>
            <p className="accept-head">
              <strong>Work you can sign</strong>
              <span className="hint">Your name goes in the record as the person who accepted this delivery.</span>
            </p>
            <input aria-label="Accepted by" placeholder="Your name" value={actor} onChange={(e) => setActor(e.target.value)} maxLength={100} autoComplete="name" required />
            <button type="submit" className="btn primary" disabled={!cleared || running || !actor.trim()}>
              <CheckIcon size={16} /> Accept delivery
            </button>
          </form>
        )}

        {sel === "build" && change.kind !== "understand" && <Handoff projectId={change.projectId} />}

        {duty.length > 0 && (
          <ul className="duties" aria-label="On duty">
            {duty.map((r) => (
              <DutyRow key={r} role={r} view={view} working={running && isNow && !instrumentSteps.find((s) => s.name === ROLES[r].name)?.done} />
            ))}
          </ul>
        )}

        {sel === "intake" && (view.documentsRead?.length ?? 0) > 0 && (
          <div className="block">
            <h3 className="block-head">Documents read</h3>
            <ul className="plain-list">
              {view.documentsRead!.map((d) => (
                <li key={d.name} className="row">
                  <code>{d.name}</code>
                  <span className="muted">{d.requirements === 1 ? "1 requirement" : `${d.requirements} requirements`}</span>
                  {d.gaps > 0 && <Stamp tone="held">{d.gaps === 1 ? "1 gap" : `${d.gaps} gaps`}</Stamp>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {sel === "analysis" && docGaps.size > 0 && (
          <div className="block">
            <h3 className="block-head">Document gaps</h3>
            {[...docGaps].map(([doc, list]) => (
              <div key={doc} className="doc-gaps">
                <p>
                  <code>{doc}</code>
                </p>
                <ul className="plain-list">
                  {list.map((f) => (
                    <li key={f.id}>
                      <span className="muted">line {f.trigger.type === "doc" ? f.trigger.line : ""}</span> <q>{f.trigger.type === "doc" ? f.trigger.quote : ""}</q>
                      <br />
                      <a href={`#finding-${f.id}`}>{f.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {sel === "verification" && view.criteria.length > 0 && (
          <div className="block">
            <h3 className="block-head">Acceptance criteria</h3>
            <ul className="criteria">
              {view.criteria.map((k) => (
                <li key={k.id}>
                  <EvidenceStamp state={k.latest} />
                  <span>
                    {k.requirementKeys?.map((key) => (
                      <span key={key} className="key">
                        {key}
                      </span>
                    ))}
                    {k.text}
                    {k.isFailurePath && <span className="muted"> Failure path.</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sel === "operate" && afterDelivery.length > 0 && (
          <div className="card delivered">
            <p>
              {afterDelivery.length === 1 ? "1 finding" : `${afterDelivery.length} findings`} raised after delivery. A fix change carries
              {afterDelivery.length === 1 ? " it" : " them"} through the gates again.
            </p>
            <button type="button" className="btn primary" disabled={running} onClick={openFixChange}>
              <PlusIcon size={16} /> Open fix change
            </button>
          </div>
        )}

        {findings.length > 0 && (
          <div className="block">
            <h3 className="block-head">
              Findings <span className="muted">{openCount > 0 ? `${openCount} holding` : "all settled"}</span>
            </h3>
            <div className="findings">
              {findings.map((f) => (
                <FindingItem key={f.id} finding={f} onChanged={load} />
              ))}
            </div>
          </div>
        )}

        {sel === "operate" && view.fixChanges.length > 0 && (
          <ul className="rows" aria-label="Fix changes">
            {view.fixChanges.map((x) => (
              <li key={x.id}>
                <a href={`#/changes/${x.id}`}>
                  <span className="row-main">
                    <strong>{x.title}</strong>
                    <span className="row-sub">
                      {x.withdrawn ? "Withdrawn" : `Carries ${x.findingIds.length === 1 ? "1 finding" : `${x.findingIds.length} findings`} · ${STAGE_NAMES[x.stage]}`}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {sel === "operate" && selState === "done" && (
          <div className="card delivered">
            <p>Every gate, finding and decision is in the record.</p>
            <a className="btn secondary" href={`#/changes/${id}/record`}>
              <RecordIcon size={16} /> Open record
            </a>
          </div>
        )}
        {selState !== "todo" && duty.length === 0 && findings.length === 0 && sel !== "acceptance" && sel !== "operate" && !(sel === "build" && change.kind !== "understand") && (
          <p className="empty">Nothing to show here.</p>
        )}
      </section>
    </div>
  );
}
