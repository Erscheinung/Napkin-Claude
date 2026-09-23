export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Compact form for tight sidebars: "6 min", "3 h", "2 days", "Jul 21". */
export function agoShort(ms: number, now = Date.now()): string {
  return ago(ms, now).replace(" ago", "").replace("just now", "now");
}

export function tildify(path: string, home: string | undefined): string {
  if (home && (path === home || path.startsWith(home + "/"))) return "~" + path.slice(home.length);
  return path;
}

export function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "burning the midnight oil";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  if (h < 22) return "good evening";
  return "late one, huh";
}

export function shellQuote(p: string): string {
  return /^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

export function relTo(path: string, root: string): string {
  return path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

export const STATUS_LABEL: Record<string, string> = {
  resting: "resting",
  starting: "unfolding…",
  ready: "ready",
  working: "scribbling…",
  needs_you: "needs you",
  done: "done",
};
