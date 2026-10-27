import { readFile } from "node:fs/promises";
import { safePath } from "./repo.js";

const STOPWORDS = new Set([
  "about", "after", "also", "been", "does", "each", "from", "have", "into", "just", "more", "most", "must",
  "only", "over", "should", "some", "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "very", "what", "when", "where", "which", "while", "will", "with", "would", "your", "make", "need", "needs",
]);
const READ_CONCURRENCY = 32;

/**
 * Deterministic, model-free narrowing: score each file by the query keywords it contains,
 * path hits worth 3 and content hits worth 1. Ties keep the input order.
 */
export async function narrowFiles(query: string, dir: string, files: string[], limit = 12): Promise<string[]> {
  const words = [...new Set(query.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOPWORDS.has(w));
  const scores = new Array<number>(files.length).fill(0);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < files.length) {
      const i = next++;
      const file = files[i]!;
      const path = file.toLowerCase();
      let text = "";
      const p = safePath(dir, file);
      if (p) {
        try {
          text = (await readFile(p, "utf8")).toLowerCase();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      scores[i] = words.reduce((s, w) => s + (path.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0);
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return files
    .map((file, i) => ({ file, i, score: scores[i]! }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.file);
}
