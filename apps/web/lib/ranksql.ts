// Loads api/rank.sql — the single source of truth for ranking math (B9/B10).
// Tries repo-root-relative candidates so it works from `next dev` (cwd=apps/web),
// the Docker image (cwd=/app), and next start at repo root. Fails loud if absent.
import { readFileSync } from "fs";
import path from "path";

let cached: string | null = null;

export function rankSql(): string {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), "api", "rank.sql"),
    path.join(process.cwd(), "..", "..", "api", "rank.sql"),
    path.join(__dirname, "..", "..", "..", "api", "rank.sql"),
  ];
  for (const p of candidates) {
    try {
      cached = readFileSync(p, "utf8");
      return cached;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(`api/rank.sql not found; tried: ${candidates.join(" | ")}`);
}
