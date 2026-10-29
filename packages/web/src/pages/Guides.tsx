const STEPS: Array<[string, string]> = [
  ["Take", "Link your repo. Kryterea reads it."],
  ["Detect", "Say what is wrong. The right professionals check."],
  ["Find and solve", "Every problem, where it is, why it matters and the fix. The release stays Held until each is fixed or accepted."],
  ["Fix and prove", "Your coding agent fixes over MCP. Kryterea checks again and shows before and after."],
];

export function Guides() {
  return (
    <div className="page">
      <header className="page-head">
        <h1>How Kryterea fixes a product problem</h1>
      </header>
      <ol className="guide">
        {STEPS.map(([title, body]) => (
          <li key={title} className="card">
            <h2>{title}</h2>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
