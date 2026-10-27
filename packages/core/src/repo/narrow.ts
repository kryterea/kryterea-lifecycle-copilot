import { readFile } from "node:fs/promises";
import { join } from "node:path";

const STOPWORDS = new Set([
  "about", "after", "also", "been", "does", "each", "from", "have", "into", "just", "more", "most", "must",
  "only", "over", "should", "some", "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "very", "what", "when", "where", "which", "while", "will", "with", "would", "your", "make", "need", "needs",
]);

/**
 * Deterministic, model-free narrowing: score each file by the query keywords it contains,
 * path hits worth 3 and content hits worth 1. Ties keep the input order.
 */
export async function narrowFiles(query: string, dir: string, files: string[], limit = 12): Promise<string[]> {
  const words = [...new Set(query.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOPWORDS.has(w));
  const scored = await Promise.all(
    files.map(async (file, i) => {
      const path = file.toLowerCase();
      let text = "";
      try {
        text = (await readFile(join(dir, file), "utf8")).toLowerCase();
      } catch {
        // unreadable file scores on its path only
      }
      const score = words.reduce((s, w) => s + (path.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0);
      return { file, i, score };
    }),
  );
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.file);
}
