import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpendMeter, SpendProvider } from "./components/SpendMeter";
import { Change } from "./pages/Change";
import { CommitTrace } from "./pages/CommitTrace";
import { DocumentDetail } from "./pages/DocumentDetail";
import { Project, type Section } from "./pages/Project";
import { Projects } from "./pages/Projects";
import { Record } from "./pages/Record";
import { Requirement } from "./pages/Requirement";
import "./styles.css";

/** Hash routes, so the server serves one index.html: projects (and their sections), changes, records, requirements. */
function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function Page({ hash }: { hash: string }) {
  const d = decodeURIComponent;
  let m = /^#\/projects\/([^/]+)\/documents\/([^/]+)$/.exec(hash);
  if (m) return <DocumentDetail key={m[2]} projectId={d(m[1]!)} docId={d(m[2]!)} />;
  m = /^#\/projects\/([^/]+)\/commits\/([^/]+)$/.exec(hash);
  if (m) return <CommitTrace key={m[2]} projectId={d(m[1]!)} sha={d(m[2]!)} />;
  m = /^#\/requirements\/([^/]+)$/.exec(hash);
  if (m) return <Requirement key={m[1]} id={d(m[1]!)} />;
  m = /^#\/projects\/([^/]+)(?:\/(needs-you|documents|trace|connections))?$/.exec(hash);
  if (m) return <Project key={m[1]} id={d(m[1]!)} section={(m[2] as Section | undefined) ?? "changes"} />;
  m = /^#\/changes\/([^/]+)(\/record)?$/.exec(hash);
  if (!m) return <Projects />;
  const id = d(m[1]!);
  return m[2] ? <Record key={id} id={id} /> : <Change key={id} id={id} />;
}

function App() {
  const hash = useHash();
  return (
    <SpendProvider>
      <header className="top">
        <div className="top-inner">
          <a className="brand" href="#/" aria-label="Kryterea Lifecycle Copilot, projects">
            {/* The Kryterea symbol, from Kryterea's brand set (disclosed in BUILT_DURING_HACKATHON.md). */}
            <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
              <rect width="40" height="40" rx="10" fill="var(--brand)" />
              <path d="M11 21.5 L17.5 28 L30 13" fill="none" stroke="var(--on-brand)" strokeWidth="3.2" strokeLinecap="square" />
              <line x1="9" y1="31.5" x2="31" y2="31.5" stroke="var(--on-brand)" strokeWidth="2" opacity="0.55" />
            </svg>
            <b>Kryterea</b>
            <span>Lifecycle Copilot</span>
          </a>
          <SpendMeter />
        </div>
      </header>
      <main>
        <Page hash={hash} />
      </main>
    </SpendProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
