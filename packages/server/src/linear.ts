import type { OpenItem } from "@lifecycle/core";

const ENDPOINT = "https://api.linear.app/graphql";
const TIMEOUT_MS = 10_000;

const KIND_LABEL: Record<string, string> = { failure_path: "error handling" };
const STATE_LABEL: Record<string, string> = { evidence_found: "Evidence found", gap: "Gap", no_evidence: "No evidence" };

/**
 * One line of model text made safe for a Markdown comment on GitHub or Linear: no line breaks, and the characters
 * that make links, mentions, images, HTML or emphasis are escaped.
 */
export function mdLine(v: unknown, max = 160): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  const capped = s.length > max ? `${s.slice(0, max - 3)}...` : s;
  return capped.replace(/[\\`*_[\]<>@#|!~]/g, "\\$&");
}

export const itemLine = (i: OpenItem) => `- ${KIND_LABEL[i.kind] ?? i.kind} | ${mdLine(i.title)} | ${mdLine(i.where, 200)}`;

/** Linear identifiers in free text (commit messages, branch names), each once, in order. */
export function findIssueKeys(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? [])];
}

/** The comment on a Linear ticket: the requirement it covers, what is open on it, and its evidence. */
export function linearBody(key: string, requirement: string, items: OpenItem[], criteriaStates: string[], sha: string): string {
  const head = `**Kryterea on ${mdLine(key, 20)} ${mdLine(requirement, 200)}**`;
  const at = `Checked at ${sha.slice(0, 7)}.`;
  const criteria = criteriaStates.length ? `Criteria: ${criteriaStates.map((s) => STATE_LABEL[s] ?? "Not checked yet").join(", ")}` : null;
  if (!items.length) return [head, "", `Nothing open for this requirement. ${at}`, ...(criteria ? ["", criteria] : [])].join("\n");
  return [head, "", `${items.length} open:`, ...items.map(itemLine), ...(criteria ? ["", criteria] : []), "", at].join("\n");
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

/** A minimal Linear GraphQL client. Errors carry a readable message and never the key. */
export function linearClient(apiKey: string, fetchFn: typeof fetch = fetch) {
  async function gql(query: string, variables: Record<string, unknown>): Promise<{ data: any; errors: Array<{ message?: string; extensions?: { code?: string } }> }> {
    let res: Response;
    try {
      res = await fetchFn(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("Could not reach Linear.");
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Linear did not accept the API key (${res.status}).`);
    const json = (await res.json().catch(() => null)) as { data?: unknown; errors?: unknown } | null;
    if (!json || (res.status !== 200 && res.status !== 400)) throw new Error(`Linear answered with status ${res.status}.`);
    return { data: json.data ?? null, errors: Array.isArray(json.errors) ? json.errors : [] };
  }

  const fail = (errors: Array<{ message?: string }>) => new Error(`Linear: ${String(errors[0]?.message ?? "unknown error").slice(0, 200)}`);

  return {
    async issue(identifier: string): Promise<LinearIssue | null> {
      const r = await gql("query Issue($id: String!) { issue(id: $id) { id identifier title url } }", { id: identifier });
      if (r.errors.some((e) => e.extensions?.code === "ENTITY_NOT_FOUND" || /not found/i.test(e.message ?? ""))) return null;
      if (r.errors.length) throw fail(r.errors);
      return r.data?.issue ?? null;
    },

    /** Creates the comment, or edits it in place when its id is known. Returns the comment id. */
    async upsertComment(issueId: string, commentId: string | null, body: string): Promise<string> {
      if (commentId) {
        const r = await gql(
          "mutation Update($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success comment { id } } }",
          { id: commentId, input: { body } },
        );
        const id = r.data?.commentUpdate?.comment?.id;
        if (typeof id === "string") return id;
        // Someone deleted the comment: write a new one rather than go quiet.
        if (!r.errors.some((e) => /not found/i.test(e.message ?? ""))) throw fail(r.errors);
      }
      const r = await gql(
        "mutation Create($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }",
        { input: { issueId, body } },
      );
      const id = r.data?.commentCreate?.comment?.id;
      if (typeof id !== "string") throw fail(r.errors);
      return id;
    },
  };
}
