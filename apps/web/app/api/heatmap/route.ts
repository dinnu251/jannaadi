// GET /api/heatmap?category= — processed submissions bucketed to a ~100m grid.
// Auth required (PROMPTS task: API Route Protection); reads go through the RLS DAL.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

const CATEGORIES = ["roads", "drainage", "water", "health", "education", "garbage", "streetlights", "other"] as const;
const QueryZ = z.object({
  category: z.enum(CATEGORIES).optional(),
  ward: z.string().min(1).max(80).optional(), // additive: heatmap follows the dashboard's ward filter
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");

    const parsed = QueryZ.safeParse({
      category: req.nextUrl.searchParams.get("category") || undefined,
      ward: req.nextUrl.searchParams.get("ward") || undefined,
    });
    if (!parsed.success) return jsonError(400, "invalid_category", parsed.error.issues.map((i) => i.message).join("; "));
    const category = parsed.data.category ?? null;
    const ward = parsed.data.ward ?? null;

    // Geo sanity gate: only plot points within 3km of their OWN ward's centroid.
    // The synthetic seed data once carried random bbox coordinates (half of that
    // bbox is the Bay of Bengal — dots at sea, live on the demo), and Maps-grounded
    // coords can occasionally land far from the resolved ward. A complaint whose
    // pin contradicts its ward is a data bug, not a heat signal.
    const { rows } = await rlsQuery(
      `SELECT ROUND(s.lat::numeric, 3)::float AS lat, ROUND(s.lng::numeric, 3)::float AS lng, COUNT(*)::int AS weight
       FROM submissions s
       JOIN wards w ON w.name = s.ward
       WHERE s.status = 'processed' AND s.lat IS NOT NULL AND s.lng IS NOT NULL
         AND ($1::text IS NULL OR s.category::text = $1)
         AND ($2::text IS NULL OR s.ward = $2)
         AND 6371 * acos( least(1.0,
               cos(radians(s.lat)) * cos(radians(w.lat)) * cos(radians(w.lng) - radians(s.lng))
               + sin(radians(s.lat)) * sin(radians(w.lat)) ) ) <= 3
       GROUP BY 1, 2`,
      [category, ward]
    );
    return NextResponse.json({ points: rows });
  } catch (e) {
    return handleRouteError(e, "GET /api/heatmap");
  }
}
