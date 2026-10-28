import { useCallback, useEffect, useState } from "react";
import type { RoleId, Trigger } from "@lifecycle/core";
import { api, message, useJob, useLoad, type ChangeView, type FindingView } from "../api";
import { lawTag, TriggerLine } from "../components/FindingItem";
import { CheckIcon, ChevronIcon, CloseIcon, PlusIcon, QuestionIcon, ShieldIcon } from "../components/Icon";
import { ROLES } from "../components/ProfessionalCard";
import { Stamp, StatusStamp, type Tone } from "../components/Stamp";
import { STAGES } from "../components/Trail";
import { getName, setName } from "../me";
import { CopyButton } from "./Change";

type Profession = Awaited<ReturnType<typeof api.professions>>[number];
type Professions = Partial<Record<RoleId, Profession>>;

/** The gates that hold release. */
const RELEASE_ROLES: RoleId[] = ["ba", "architect", "qa", "compliance"];

const nameOf = (role: RoleId, p: Professions) => p[role]?.name ?? ROLES[role].name;

const whereOf = (t: Trigger) =>
  t.type === "code" ? `${t.file}:${t.line}` : t.type === "doc" ? (t.document ? `${t.document}${t.line ? `:${t.line}` : ""}` : "Document") : t.url;

/** Where, why, the standard behind it, the cost and the fix: the whole finding without its status controls. */
function Facts({ f, p }: { f: FindingView; p: Professions }) {
  const standard = f.law ? `${f.law}, ${f.section}. Not legal advice.` : p[f.role]?.frameworks.join(", ");
  return (
    <>
      <dl className="facts">
        <dt>Where</dt>
        <dd>
          <TriggerLine trigger={f.trigger} />
        </dd>
        <dt>Why it matters</dt>
        <dd>{f.plain}</dd>
        {standard && (
          <>
            <dt>{lawTag(f.law) ?? "Standard"}</dt>
            <dd>{standard}</dd>
          </>
        )}
        <dt>Cost if ignored</dt>
        <dd>{f.costIfIgnored}</dd>
      </dl>
      <div className="prompt">
        <div className="prompt-head">
          <span>The fix</span>
          <CopyButton text={f.fixPrompt} />
        </div>
        <p>{f.fixPrompt}</p>
      </div>
    </>
  );
}

function Running({ view, p }: { view: ChangeView; p: Professions }) {
  return (
    <ul className="rows" aria-label="Professionals at work">
      {Object.values(p).map(({ role, name, frameworks }) => {
        const run = view.runs.find((r) => r.role === role);
        const found = view.findings.filter((f) => f.role === role).length;
        const [tone, label]: [Tone, string] = !run
          ? ["idle", "Waiting"]
          : run.status === "running"
            ? ["live", "Reading"]
            : run.status === "failed"
              ? ["danger", "Stopped"]
              : run.status === "stopped_budget"
                ? ["held", "Paused"]
                : found
                  ? ["held", `Found ${found}`]
                  : ["cleared", "Done"];
        return (
          <li key={role}>
            <div className="item">
              <span className="row-main">
                <strong>{name}</strong>
                <span className="hint">{frameworks[0]}</span>
              </span>
              <Stamp tone={tone}>{label}</Stamp>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Answer = { question: string; text: string; assumed: boolean };

function Answered({ items }: { items: Answer[] }) {
  return (
    <ul className="plain-list">
      {items.map((a, i) => (
        <li key={i}>
          <span className="muted">{a.question}</span> <strong>{a.assumed ? `Kryterea will assume: ${a.text}` : a.text}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Open questions one at a time. They are saved together once the last one is answered. */
function Questions({ view, actor, onSaved }: { view: ChangeView; actor: () => string; onSaved: (items: Answer[]) => void }) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const i = answers.length;
  const question = view.questions[i];
  const offer = view.questionOptions[i];

  const pick = async (text: string, assumed: boolean) => {
    const next = [...answers, { question: question!, text, assumed }];
    setAnswers(next);
    setDraft("");
    if (next.length < view.questions.length) return;
    setSaving(true);
    setError(null);
    try {
      const a = actor();
      await api.answer(view.change.id, { answers: next.map((x) => x.text), assumed: next.map((x) => x.assumed), ...(a && { actor: a }) });
      onSaved(next);
    } catch (e) {
      setError(message(e));
      setAnswers(answers);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="start-block">
      <h2 className="block-head">
        <QuestionIcon size={16} /> {view.questions.length === 1 ? "1 question" : `${view.questions.length} questions`}
      </h2>
      {i > 0 && <Answered items={answers} />}
      {question && !saving && (
        <div className="card assess-card">
          <p>{question}</p>
          {offer ? (
            <div className="assess-options" role="group" aria-label="Answers">
              {offer.options.map((o) => (
                <button key={o} type="button" className="btn secondary" onClick={() => pick(o, false)}>
                  {o}
                </button>
              ))}
              <button type="button" className="btn ghost" onClick={() => pick(offer.options[offer.defaultIndex] ?? offer.options[0]!, true)}>
                I don't know
              </button>
            </div>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) pick(draft.trim(), false);
              }}
            >
              <input aria-label="Your answer" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} className="assess-grow" />
              <button type="submit" className="btn secondary" disabled={!draft.trim()}>
                <CheckIcon size={15} /> Save
              </button>
            </form>
          )}
        </div>
      )}
      {saving && <p className="hint">Saving</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Proposal({ view, index, byId, actor, onDecided }: { view: ChangeView; index: number; byId: Map<string, FindingView>; actor: () => string; onDecided: (recheck: boolean) => void }) {
  const p = view.proposals!.changes[index]!;
  const decision = view.decisions.filter((d) => d.index === index).at(-1);
  const [risk, setRisk] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (accept: boolean) => {
    const a = actor();
    if (!a) return setError("Add your name first.");
    setSaving(true);
    setError(null);
    try {
      if (accept) await api.acceptProposalRisk(view.change.id, index, { actor: a, reason: reason.trim() });
      else await api.approveProposal(view.change.id, index, a);
      onDecided(accept);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const closes = p.findingIds.map((id) => byId.get(id)).filter((f) => f !== undefined);
  return (
    <article className="card assess-card">
      <h3>{p.title}</h3>
      <dl className="facts">
        <dt>For whom</dt>
        <dd>{p.forWhom}</dd>
        <dt>Why</dt>
        <dd>{p.why}</dd>
        {closes.length > 0 && (
          <>
            <dt>Closes</dt>
            <dd>
              <ul className="plain-list">
                {closes.map((f) => (
                  <li key={f.id}>{f.title}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {p.criteria.length > 0 && (
          <>
            <dt>Done when</dt>
            <dd>
              <ul className="plain-list">
                {p.criteria.map((k, j) => (
                  <li key={j}>
                    {k.text} {k.isFailurePath && <span className="tag">Failure path</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      {decision?.decision === "approved" ? (
        <p className="decision row">
          <CheckIcon size={15} /> Approved by <strong>{decision.actor}</strong>
          {decision.fixChangeId && <a href={`#/changes/${encodeURIComponent(decision.fixChangeId)}`}>Open the fix change</a>}
        </p>
      ) : decision?.decision === "accepted_risk" ? (
        <p className="decision">
          Risk accepted by <strong>{decision.actor}</strong>: {decision.reason}
        </p>
      ) : risk ? (
        <div className="row">
          <input aria-label="Reason" placeholder="Why is this risk acceptable?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="assess-grow" />
          <button type="button" className="btn secondary sm" disabled={!reason.trim() || saving} onClick={() => decide(true)}>
            <ShieldIcon size={15} /> Confirm
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setRisk(false)}>
            <CloseIcon size={15} /> Cancel
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn secondary sm" disabled={saving} onClick={() => decide(false)}>
            <CheckIcon size={15} /> Approve
          </button>
          <button type="button" className="btn ghost sm" disabled={saving} onClick={() => setRisk(true)}>
            <ShieldIcon size={15} /> Accept the risk
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

/** A check's result: her problem answered first, what else was found, and the changes written for her. */
export function Assessment({ id }: { id: string }) {
  const professions = useLoad(() => api.professions(), "professions");
  const [view, setView] = useState<ChangeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const [answered, setAnswered] = useState<Answer[]>([]);
  const [name, setNameDraft] = useState(() => getName() ?? "");
  const [askName] = useState(() => !getName());

  const load = useCallback(
    () =>
      api
        .change(id)
        .then(
          (v) => (setView(v), setError(null)),
          (e) => setError(message(e)),
        )
        .finally(() => setLoads((n) => n + 1)),
    [id],
  );
  useEffect(() => void load(), [load]);
  const job = useJob(load);

  // Reached from Start without a job id: poll the view while a run is going or the check has not reached release.
  const busy = view !== null && (view.runs.some((r) => r.status === "running") || STAGES.indexOf(view.stage) < STAGES.indexOf("release"));
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [busy, loads, load]);

  /** The name to sign with, saved for next time. Empty until she gives one. */
  const actor = () => {
    const a = name.trim();
    if (a) setName(a);
    return a;
  };

  if (!view) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading</p>}</div>;

  const p: Professions = Object.fromEntries((professions.data ?? []).map((x) => [x.role, x]));
  const byId = new Map(view.findings.map((f) => [f.id, f]));
  const held = RELEASE_ROLES.filter((r) => view.gates[r]?.state === "held");
  const cleared = RELEASE_ROLES.every((r) => view.gates[r]?.state === "cleared");
  const checked = [...new Set(view.runs.filter((r) => r.status === "done").map((r) => r.role))];

  const answers = new Set(view.proposals?.answersProblem ?? []);
  const yours = [...answers].map((f) => byId.get(f)).filter((f) => f !== undefined);
  // Near duplicates show once, with a count of the rest. Grouping of changes is the writer's, never inferred here.
  const rest = view.findings.filter((f) => f.status === "open" && !answers.has(f.id));
  const restIds = new Set(rest.map((f) => f.id));
  const hidden = new Set<string>();
  const similar = new Map<string, number>();
  for (const group of view.proposals?.duplicates ?? []) {
    const [keep, ...others] = group.filter((f) => restIds.has(f) && !hidden.has(f));
    if (!keep || !others.length) continue;
    similar.set(keep, others.length);
    others.forEach((f) => hidden.add(f));
  }
  const rows = rest.filter((f) => !hidden.has(f.id));
  const n = rows.length;
  const nameField = askName && (
    <input aria-label="Your name" placeholder="Your name" value={name} onChange={(e) => setNameDraft(e.target.value)} maxLength={100} autoComplete="name" className="assess-name" />
  );

  return (
    <div className="page">
      <header className="page-head">
        <div className="stack assess-head">
          <h1>{view.problem ? `You asked: “${view.problem}”` : view.change.title}</h1>
          <p className="row">
            Release
            {held.length ? <Stamp tone="held">Held</Stamp> : cleared ? <Stamp tone="cleared">Cleared</Stamp> : <Stamp tone="idle">Not yet</Stamp>}
            {held.length > 0 && <span className="muted">by {held.map((r) => nameOf(r, p)).join(", ")}</span>}
            <a className="btn ghost sm" href={`#/changes/${encodeURIComponent(view.change.id)}`}>
              Details <ChevronIcon size={15} />
            </a>
          </p>
          {checked.length > 0 && <p className="hint">Checked by {checked.map((r) => nameOf(r, p)).join(", ")}.</p>}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {(job.startError || job.job?.error) && <p className="error">{job.startError ?? job.job?.error}</p>}

      {busy && (
        <section className="start-block">
          <Running view={view} p={p} />
        </section>
      )}

      {view.questions.length > 0 ? (
        <>
          {nameField}
          <Questions
            key={view.questions.join("\n")}
            view={view}
            actor={actor}
            onSaved={(items) => {
              setAnswered(items);
              job.start(() => api.advance(view.change.id));
            }}
          />
        </>
      ) : (
        answered.length > 0 && (
          <section className="start-block">
            <Answered items={answered} />
          </section>
        )
      )}

      {!busy && (
        <>
          {view.problem && (
            <section className="start-block">
              <h2>Your problem</h2>
              {yours.length ? (
                yours.map((f) => (
                  <article key={f.id} className="card assess-card">
                    <p className="eyebrow">{nameOf(f.role, p)}</p>
                    <div className="row">
                      <StatusStamp status={f.status} kind={f.kind} />
                      <h3>{f.title}</h3>
                    </div>
                    <Facts f={f} p={p} />
                  </article>
                ))
              ) : (
                <p className="empty">Nothing we found explains this yet.</p>
              )}
            </section>
          )}

          {n > 0 && (
            <section className="start-block">
              <h2>{view.problem ? `While checking, we found ${n} more you did not ask about` : `We found ${n === 1 ? "1 problem" : `${n} problems`}`}</h2>
              <div className="findings assess-rows">
                {rows.map((f) => (
                  <details key={f.id} className="finding">
                    <summary>
                      <span className="row-main">
                        <span className="finding-title">{f.title}</span>
                        <span className="row-sub">
                          <span>{nameOf(f.role, p)}</span>
                          <span className="mono start-path">{whereOf(f.trigger)}</span>
                          {similar.has(f.id) && <span className="tag">+{similar.get(f.id)} similar</span>}
                        </span>
                      </span>
                      <ChevronIcon size={16} className="caret" />
                    </summary>
                    <div className="finding-body">
                      <Facts f={f} p={p} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {view.proposals && view.proposals.changes.length > 0 && (
            <section className="start-block">
              <h2>Changes Kryterea wrote</h2>
              {view.questions.length === 0 && nameField}
              {view.proposals.changes.map((_, i) => (
                <Proposal
                  key={i}
                  view={view}
                  index={i}
                  byId={byId}
                  actor={actor}
                  onDecided={(recheck) => {
                    void load();
                    // Accepting the risk settles findings, so the gates recompute and the release stamp can turn.
                    if (recheck) void job.start(() => api.advance(view.change.id));
                  }}
                />
              ))}
            </section>
          )}

          <p>
            <a className="btn ghost sm" href={`#/projects/${encodeURIComponent(view.change.projectId)}`}>
              <PlusIcon size={15} /> Add your own change
            </a>
          </p>
        </>
      )}
    </div>
  );
}
