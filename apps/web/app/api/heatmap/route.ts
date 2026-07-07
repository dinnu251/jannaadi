// GET /api/heatmap?category= — processed submissions bucketed to a ~100m grid.
// Auth required (PROMPTS task: API Route Protection); reads go through the RLS DAL.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

const CATEGORIES = ["roads", "drainage", "water", "health", "education", "garbage", "streetlights", "other"] as const;
const QueryZ = z.object({ category: z.enum(CATEGORIES).optional() });

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");

    const parsed = QueryZ.safeParse({ category: req.nextUrl.searchParams.get("category") || undefined });
    if (!parsed.success) return jsonError(400, "invalid_category", parsed.error.issues.map((i) => i.message).join("; "));
    const category = parsed.data.category ?? null;

    const { rows } = await rlsQuery(
      `SELECT ROUND(lat::numeric, 3)::float AS lat, ROUND(lng::numeric, 3)::float AS lng, COUNT(*)::int AS weight
       FROM submissions
       WHERE status = 'processed' AND lat IS NOT NULL AND lng IS NOT NULL
         AND ($1::text IS NULL OR category::text = $1)
       GROUP BY 1, 2`,
      [category]
    );
    return NextResponse.json({ points: rows });
  } catch (e) {
    return handleRouteError(e, "GET /api/heatmap");
  }
}
