const KEY = "kryterea.name";

// Held in memory too, so Start still sticks for this visit when storage throws (otherwise Home would bounce back to Welcome).
let mem: string | null = null;

/** The name Ada signs the record with, kept in this browser only. Null when none is saved or storage is blocked. */
export function getName(): string | null {
  if (mem) return mem;
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function setName(name: string): void {
  mem = name || null;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Storage can be blocked; the in-memory name carries this visit.
  }
}
