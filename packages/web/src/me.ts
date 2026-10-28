const KEY = "kryterea.name";

/** The name Ada signs the record with, kept in this browser only. Null when none is saved or storage is blocked. */
export function getName(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function setName(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Storage can be blocked; Start still works for this visit.
  }
}
