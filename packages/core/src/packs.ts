import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LegalDuty, Packs, RoleId } from "./types.js";

const ROLES: RoleId[] = ["ba", "architect", "qa", "compliance", "po"];
const LAWS = ["NDPA 2023", "PCI DSS"];
const REQUIRED = ["id", "law", "section", "title", "duty", "sourceUrl", "verifiedOn"] as const;

/** Reads the role packs and the legal pack. Throws a message naming the file or entry id at fault. */
export async function loadPacks(dir: string): Promise<Packs> {
  const role = {} as Record<RoleId, string>;
  for (const r of ROLES) {
    const file = join(dir, `${r}.md`);
    try {
      role[r] = await readFile(file, "utf8");
    } catch {
      throw new Error(`Missing role pack file: ${file}`);
    }
  }
  const legalFile = join(dir, "legal", "ndpa-2023.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(legalFile, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read legal pack ${legalFile}: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new Error(`Legal pack ${legalFile} must be a JSON array`);
  const legal = raw.map((e: Record<string, unknown>, i) => {
    const id = typeof e.id === "string" && e.id ? e.id : `entry #${i}`;
    for (const f of REQUIRED) {
      if (typeof e[f] !== "string" || !e[f]) throw new Error(`Legal entry ${id} is missing ${f}`);
    }
    if (!LAWS.includes(e.law as string)) throw new Error(`Legal entry ${id} has an unknown law: ${String(e.law)}`);
    if (!Array.isArray(e.triggers)) throw new Error(`Legal entry ${id} is missing triggers`);
    return e as unknown as LegalDuty;
  });
  return { role, legal };
}
