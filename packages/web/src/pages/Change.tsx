import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { RoleId, StageId } from "@lifecycle/core";
import { api, message, useActor, useJob, type ChangeView, type FindingView } from "../api";
import { FindingItem } from "../components/FindingItem";
import { BackIcon, CheckIcon, PlayIcon, QuestionIcon, RecordIcon, RefreshIcon } from "../components/Icon";
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

/** Still holding release: open, or a deferred legal finding (deferring does not clear the law). */
const unresolved = (f: FindingView) => f.status === "open" || (f.status === "deferred" && f.kind === "legal");

function line(stage: StageId, v: ChangeView): string {
  const asking = v.questions.length > 0 && v.gates.ba?.state !== "cleared";
  const cleared = BEFORE_ACCEPTANCE.every((r) => v.gates[r]?.state === "cleared");
  switch (stage) {
    case "intake":
      return "The analyst reads the request and the code.";
    case "analysis":
      return asking ? "Answer the analyst, then run the next step." : "The analyst writes the acceptance criteria.";
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
      return "Delivered. The copilot keeps watching new pushes.";
  }
}

function Questions({ changeId, questions, onSaved }: { changeId: string; questions: string[]; onSaved: () => void }) {
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.answer(
        changeId,
        answers.map((a) => a.trim()),
      );
      setSaved(true);
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
        {saved && <span className="hint">Saved. Run the next step.</span>}
      </div>
    </form>
  );
}

export function Change({ id }: { id: string }) {
  const [view, setView] = useState<ChangeView | null>(null);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);
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
  const { change, gates } = view;
  const sel = pick ?? stage;
  const now = STAGES.indexOf(stage);
  const asking = view.questions.length > 0 && gates.ba?.state !== "cleared";
  const held = ON_DUTY[stage].some((r) => gates[r]?.state === "held");
  const cleared = BEFORE_ACCEPTANCE.every((r) => gates[r]?.state === "cleared");

  const stops: TrailStop[] = STAGES.map((s, i) => {
    let state: NodeState = i < now ? "done" : i > now ? "todo" : "live";
    if (i === now) state = stage === "operate" ? "done" : asking || held || stage === "build" || stage === "acceptance" ? "you" : "live";
    const open = view.findings.filter((f) => f.stage === s && unresolved(f)).length;
    return { stage: s, state, open };
  });
  const selState = stops.find((s) => s.stage === sel)!.state;

  // Server order, so a row stays put when its status changes under the person's cursor.
  const findings = view.findings.filter((f) => (sel === "release" ? unresolved(f) : f.stage === sel));
  const openCount = findings.filter(unresolved).length;
  const duty = ON_DUTY[sel];
  const isNow = sel === stage;
  const showRun = isNow && stage !== "build" && stage !== "acceptance" && stage !== "operate";
  const showRecheck = isNow && (stage === "build" || stage === "release" || stage === "operate");
  const instrumentSteps = duty.map((r) => ({ name: ROLES[r].name, done: view.runs.find((x) => x.role === r)?.status === "done" }));

  const accept = (e: FormEvent) => {
    e.preventDefault();
    void start(() => api.accept(id, actor.trim()));
  };

  return (
    <div className="change">
      <aside className="rail">
        <a className="back" href={`#/projects/${change.projectId}`}>
          <BackIcon size={15} /> {projectName || "Project"}
        </a>
        <h1 className="rail-title">{change.title}</h1>
        <div className="rail-meta">
          <Stamp tone="idle">{change.kind === "understand" ? "Baseline" : change.kind === "fix" ? "Fix" : "Feature"}</Stamp>
          <a className="btn ghost sm" href={`#/changes/${id}/record`}>
            <RecordIcon size={15} /> Record
          </a>
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
            <p className="pane-line">{isNow ? line(stage, view) : selState === "todo" ? "Not reached yet." : "Finished. Its findings stay below."}</p>
          </div>
          {(showRun || showRecheck) && (
            <div className="row">
              {showRecheck && (
                <button type="button" className={showRun ? "btn secondary icon" : "btn primary"} disabled={running} onClick={() => start(() => api.recheck(change.projectId))} aria-label="Re-check now" title="Re-check now">
                  <RefreshIcon size={16} />
                  {!showRun && "Re-check now"}
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
        {running && isNow && <Instrument steps={instrumentSteps} />}

        {isNow && stage === "acceptance" && (
          <form className="block accept" onSubmit={accept}>
            <input aria-label="Accepted by" placeholder="Your name" value={actor} onChange={(e) => setActor(e.target.value)} maxLength={100} autoComplete="name" required />
            <button type="submit" className="btn primary" disabled={!cleared || running || !actor.trim()}>
              <CheckIcon size={16} /> Accept delivery
            </button>
          </form>
        )}

        {duty.length > 0 && (
          <ul className="duties" aria-label="On duty">
            {duty.map((r) => (
              <DutyRow key={r} role={r} view={view} working={running && isNow && !instrumentSteps.find((s) => s.name === ROLES[r].name)?.done} />
            ))}
          </ul>
        )}

        {(sel === "intake" || sel === "analysis") && asking && <Questions key={view.questions.join("\n")} changeId={id} questions={view.questions} onSaved={load} />}

        {sel === "verification" && view.criteria.length > 0 && (
          <div className="block">
            <h3 className="block-head">Acceptance criteria</h3>
            <ul className="criteria">
              {view.criteria.map((k) => (
                <li key={k.id}>
                  <EvidenceStamp state={k.latest} />
                  <span>
                    {k.text}
                    {k.isFailurePath && <span className="muted"> Failure path.</span>}
                  </span>
                </li>
              ))}
            </ul>
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

        {sel === "operate" && selState === "done" && (
          <div className="card delivered">
            <p>Every gate, finding and decision is in the record.</p>
            <a className="btn secondary" href={`#/changes/${id}/record`}>
              <RecordIcon size={16} /> Open record
            </a>
          </div>
        )}
        {selState !== "todo" && duty.length === 0 && findings.length === 0 && sel !== "acceptance" && sel !== "operate" && (
          <p className="empty">{sel === "build" ? "Findings reach your coding agent over MCP." : "Nothing to show here."}</p>
        )}
      </section>
    </div>
  );
}
