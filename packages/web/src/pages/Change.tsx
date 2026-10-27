import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { RoleId, StageId } from "@lifecycle/core";
import { api, message, useActor, useJob, type ChangeView } from "../api";
import { ProfessionalCard, ROLE_ORDER } from "../components/ProfessionalCard";
import { JobNote, useSpend } from "../components/SpendMeter";
import { StageStrip } from "../components/StageStrip";

const NEXT: Record<StageId, string> = {
  intake: "The business analyst reads the request and the code first.",
  analysis: "The business analyst writes the acceptance criteria once every question has an answer.",
  design_review: "Compliance and the architect review the design before anything is built.",
  build: "Waiting for your coding agent to build this. Re-check once it has pushed.",
  verification: "QA checks every acceptance criterion against the code.",
  release: "Release waits until every held gate clears. Fix, accept the risk of, or defer each open finding, then re-check.",
  acceptance: "The product owner accepts delivery once every other gate is cleared.",
  operate: "Delivered and accepted. The copilot keeps watching new pushes.",
};

/** The gates that must be cleared before the product owner can accept. */
const BEFORE_ACCEPTANCE: RoleId[] = ["ba", "architect", "qa", "compliance"];

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
    <form className="stack" onSubmit={save} aria-label="Questions from the business analyst">
      {questions.map((q, i) => (
        <label key={i} className="field">
          {q}
          <textarea
            value={answers[i] ?? ""}
            onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
            required
            maxLength={2000}
          />
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="quiet" disabled={answers.some((a) => !a.trim())}>
          Save answers
        </button>
        {saved && <span className="small muted">Answers saved. Run the next step to continue.</span>}
      </div>
    </form>
  );
}

export function Change({ id }: { id: string }) {
  const [view, setView] = useState<ChangeView | null>(null);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  const projectId = view?.change.projectId;
  useEffect(() => {
    if (projectId) api.project(projectId).then((p) => setProjectName(p.project.name), () => {});
  }, [projectId]);

  const { job, running, start, startError } = useJob(() => {
    load();
    refreshSpend();
  });

  if (!view) return error ? <p className="error">{error}</p> : <p className="muted">Loading change.</p>;
  const { change, stage, gates } = view;
  const held = Object.values(gates).some((g) => g?.state === "held");
  const cleared = BEFORE_ACCEPTANCE.every((r) => gates[r]?.state === "cleared");
  const canAccept = stage === "acceptance" && cleared && !running;
  const askBa = view.questions.length > 0 && gates.ba?.state !== "cleared";

  const accept = (e: FormEvent) => {
    e.preventDefault();
    void start(() => api.accept(id, actor.trim()));
  };

  return (
    <>
      <nav className="crumbs">
        <a href="#/">Projects</a> / <a href={`#/projects/${change.projectId}`}>{projectName || "Project"}</a>
      </nav>
      <div className="page-head">
        <div>
          <h1>{change.title}</h1>
          <p>{change.description}</p>
        </div>
        <a href={`#/changes/${id}/record`}>Acceptance record</a>
      </div>

      <section className="sheet" aria-label="Where this change stands">
        <StageStrip stage={stage} working={running} held={held} />
        <div className="next">
          <p>{NEXT[stage]}</p>
          <div className="row">
            {stage !== "build" && stage !== "operate" && stage !== "acceptance" && (
              <button type="button" disabled={running} onClick={() => start(() => api.advance(id))}>
                Run next step
              </button>
            )}
            {(stage === "build" || stage === "release" || stage === "operate") && (
              <button
                type="button"
                className={stage === "build" ? undefined : "quiet"}
                disabled={running}
                onClick={() => start(() => api.recheck(change.projectId))}
              >
                Re-check now
              </button>
            )}
            <JobNote job={job} startError={startError} />
          </div>
          {stage === "acceptance" && (
            <form className="stack" onSubmit={accept} style={{ marginTop: 12 }}>
              <label className="field">
                Accepted by
                <span className="hint">Your name goes into the acceptance record.</span>
                <input value={actor} onChange={(e) => setActor(e.target.value)} maxLength={100} autoComplete="name" required />
              </label>
              <div className="row">
                <button type="submit" disabled={!canAccept || !actor.trim()}>
                  Accept delivery
                </button>
                {!cleared && <span className="small muted">Every gate above the product owner must be cleared first.</span>}
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="sheet" aria-label="Professionals on duty">
        <h2>Who checked what</h2>
        {ROLE_ORDER.map((role) => (
          <ProfessionalCard key={role} role={role} view={view} jobRunning={running} onChanged={load}>
            {role === "ba" && askBa && <Questions key={view.questions.join("\n")} changeId={id} questions={view.questions} onSaved={load} />}
          </ProfessionalCard>
        ))}
      </section>
    </>
  );
}
