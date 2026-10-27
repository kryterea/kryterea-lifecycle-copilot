import { matchesGlob } from "node:path";
import { isSecretFile } from "../repo/repo.js";
import type { DocSettings } from "../types.js";

const MARKDOWN = /\.mdx?$/i;
const IN_DOCS = /(^|\/)docs\//i;
const DOC_NAME = /prd|spec|requirement/i;
const SKIPPED = /(^|\/)(node_modules|\.git|dist)\//;

const matches = (file: string, globs: string[]) => globs.some((g) => matchesGlob(file, g));

/**
 * Which repo files are the project's documents: Markdown under docs/ or named like a PRD, spec or requirement,
 * plus the project's include globs, minus its exclude globs. Secret files are never documents, whatever the globs say.
 */
export function discoverDocuments(files: string[], settings: DocSettings): string[] {
  return files.filter((raw) => {
    const f = raw.replaceAll("\\", "/");
    if (isSecretFile(f) || SKIPPED.test(f)) return false;
    if (matches(f, settings.exclude)) return false;
    const name = f.split("/").at(-1)!;
    return (MARKDOWN.test(f) && (IN_DOCS.test(f) || DOC_NAME.test(name))) || matches(f, settings.include);
  });
}
