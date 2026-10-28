import { useState, type FormEvent } from "react";
import { ChevronIcon } from "../components/Icon";
import { getName, setName } from "../me";

export function Welcome() {
  const [name, setValue] = useState(getName() ?? "");

  const start = (e: FormEvent) => {
    e.preventDefault();
    setName(name.trim());
    location.hash = "#/";
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Kryterea fixes product problems</h1>
          <p className="pane-line">
            Link your repo. Tell us what is wrong, or let us check everything. Professionals find the problems, your coding agent fixes them, and you sign for the result.
          </p>
        </div>
      </header>
      <form className="card form" onSubmit={start}>
        <label>
          <span>Your name</span>
          <input value={name} onChange={(e) => setValue(e.target.value)} required maxLength={200} autoFocus autoComplete="name" />
          <span className="hint">Used on the record.</span>
        </label>
        <div className="row">
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            Start <ChevronIcon size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
