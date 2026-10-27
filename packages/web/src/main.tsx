import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpendMeter, SpendProvider } from "./components/SpendMeter";
import { Change } from "./pages/Change";
import { Project } from "./pages/Project";
import { Projects } from "./pages/Projects";
import { Record } from "./pages/Record";
import "./styles.css";

/** Hash routes, so the server serves one index.html: #/, #/projects/:id, #/changes/:id, #/changes/:id/record. */
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
  const m = /^#\/(projects|changes)\/([^/]+)(\/record)?$/.exec(hash);
  if (!m) return <Projects />;
  const id = decodeURIComponent(m[2]!);
  if (m[1] === "projects") return <Project key={id} id={id} />;
  return m[3] ? <Record key={id} id={id} /> : <Change key={id} id={id} />;
}

function App() {
  const hash = useHash();
  return (
    <SpendProvider>
      <header className="top">
        <div className="top-inner">
          <a className="brand" href="#/" aria-label="Kryterea Lifecycle Copilot, projects">
            <span className="brand-mark" aria-hidden="true" />
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
