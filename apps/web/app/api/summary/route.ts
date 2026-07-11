// GET /api/summary?ward=&category= — MP dashboard KPI/analytics view: resolution
// totals, category rollup, ward rollup, and an 8-week resolved-vs-total trend.
// Admin-only: this surface aggregates across ALL citizens' complaints, not just
// the caller's own — never rely on RLS alone (same defence-in-depth as
// /api/deadletters).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

const CATEGORIES = ["roads", "drainage", "water", "health", "education", "garbage", "streetlights", "other"] as const;
const QueryZ = z.object({
  ward: z.string().min(1).max(80).optional(),
  category: z.enum(CATEGORIES).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");
    if ((session.user as { role?: string }).role !== "admin") return jsonError(403, "forbidden", "admin access required");

    const q = req.nextUrl.searchParams;
    const parsed = QueryZ.safeParse({
      ward: q.get("ward") || undefined,
      category: q.get("category") || undefined,
    });
    if (!parsed.success)
      return jsonError(400, "invalid_category", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const ward = parsed.data.ward ?? null;
    const category = parsed.data.category ?? null;

    // Same status='processed' scope as /api/rank and /api/heatmap — only
    // submissions the pipeline finished classifying count toward analytics.
    // category is a Postgres enum (category_type) — cast to text for comparison,
    // same pattern as api/rank.sql's `c.category::text = $2`.
    const filterSql = `status = 'processed' AND ($1::text IS NULL OR ward = $1) AND ($2::text IS NULL OR category::text = $2)`;
    const params = [ward, category];

    const [totalsRes, categoryRes, wardRes, trendRes] = await Promise.all([
      rlsQuery(
        `SELECT resolution_status, count(*) AS n FROM submissions WHERE ${filterSql} GROUP BY resolution_status`,
        params
      ),
      rlsQuery(
        `SELECT category, count(*) AS total, count(*) FILTER (WHERE resolution_status = 'resolved') AS resolved
         FROM submissions WHERE ${filterSql} GROUP BY category ORDER BY total DESC`,
        params
      ),
      rlsQuery(
        `SELECT ward, count(*) AS total, count(*) FILTER (WHERE resolution_status = 'resolved') AS resolved
         FROM submissions WHERE ${filterSql} GROUP BY ward ORDER BY total DESC LIMIT 8`,
        params
      ),
      rlsQuery(
        `SELECT date_trunc('week', submitted_at) AS week, count(*) AS total,
                count(*) FILTER (WHERE resolution_status = 'resolved') AS resolved
         FROM submissions WHERE ${filterSql} AND submitted_at > now() - interval '8 weeks'
         GROUP BY week ORDER BY week`,
        params
      ),
    ]);

    const totals = { total: 0, open: 0, acknowledged: 0, in_progress: 0, resolved: 0 };
    for (const r of totalsRes.rows) {
      const n = parseInt(r.n, 10);
      totals.total += n;
      totals[r.resolution_status as "open" | "acknowledged" | "in_progress" | "resolved"] = n;
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      totals,
      by_category: categoryRes.rows.map((r) => ({
        category: r.category,
        total: parseInt(r.total, 10),
        resolved: parseInt(r.resolved, 10),
      })),
      by_ward: wardRes.rows.map((r) => ({
        ward: r.ward,
        total: parseInt(r.total, 10),
        resolved: parseInt(r.resolved, 10),
      })),
      trend: trendRes.rows.map((r) => ({
        week: r.week,
        total: parseInt(r.total, 10),
        resolved: parseInt(r.resolved, 10),
      })),
    });
  } catch (e) {
    return handleRouteError(e, "GET /api/summary");
  }
}
