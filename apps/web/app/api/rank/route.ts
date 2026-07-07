// GET /api/rank?ward=&category=&lang= — MP dashboard ranked list (API.md, B2/B9/B10).
// Executes api/rank.sql verbatim: weights live from rank_weights (no redeploy, B10),
// score_breakdown per component (B9). lang param accepted for display symmetry; the
// ranking itself is language-agnostic.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";
import { rankSql } from "@/lib/ranksql";

export const dynamic = "force-dynamic";

const CATEGORIES = ["roads", "drainage", "water", "health", "education", "garbage", "streetlights", "other"] as const;
const QueryZ = z.object({
  ward: z.string().min(1).max(80).optional(),
  category: z.enum(CATEGORIES).optional(),
  lang: z.enum(["te", "hi", "en"]).optional(), // display hint — ranking is language-agnostic
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");

    const q = req.nextUrl.searchParams;
    const parsed = QueryZ.safeParse({
      ward: q.get("ward") || undefined,
      category: q.get("category") || undefined,
      lang: q.get("lang") || undefined,
    });
    if (!parsed.success)
      return jsonError(400, "invalid_category", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const ward = parsed.data.ward ?? null;
    const category = parsed.data.category ?? null;

    const [weightsRes, itemsRes] = await Promise.all([
      rlsQuery("SELECT key, weight FROM rank_weights"),
      rlsQuery(rankSql(), [ward, category]),
    ]);

    const weights = Object.fromEntries(weightsRes.rows.map((r) => [r.key, parseFloat(r.weight)]));

    // sample_submission_ids: 3 most recent processed per cluster, one query for all
    const clusterIds = itemsRes.rows.map((r) => r.cluster_id);
    const samples = new Map<string, string[]>();
    if (clusterIds.length) {
      const { rows } = await rlsQuery(
        `SELECT cluster_id, id FROM (
           SELECT cluster_id, id, row_number() OVER (PARTITION BY cluster_id ORDER BY submitted_at DESC) AS rn
           FROM submissions WHERE status = 'processed' AND cluster_id = ANY($1::uuid[])
         ) t WHERE rn <= 3`,
        [clusterIds]
      );
      for (const r of rows) samples.set(r.cluster_id, [...(samples.get(r.cluster_id) ?? []), r.id]);
    }

    const items = itemsRes.rows.map((r, i) => {
      const pm = r.plan_match; // T3/B15: pass through only real matches, never the {none:true} sentinel
      return {
        cluster_id: r.cluster_id,
        rank: i + 1,
        title_en: r.title_en,
        category: r.category,
        ward: r.ward,
        submission_count: r.submission_count,
        score: parseFloat(r.score),
        score_breakdown: {
          frequency: parseFloat(r.bd_frequency),
          severity: parseFloat(r.bd_severity),
          recency: parseFloat(r.bd_recency),
          demographic: parseFloat(r.bd_demographic),
        },
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        sample_submission_ids: samples.get(r.cluster_id) ?? [],
        plan_match: pm && pm.none !== true ? pm : null,
        centroid: { lat: r.centroid_lat, lng: r.centroid_lng },
      };
    });

    return NextResponse.json({ generated_at: new Date().toISOString(), weights, items });
  } catch (e) {
    return handleRouteError(e, "GET /api/rank");
  }
}
