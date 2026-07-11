// GET /api/submissions — the signed-in citizen's own complaints, newest first.
// Backs the "My Complaints" page. Auth required (401). Reads go through the RLS DAL
// AND filter by user_id explicitly — RLS alone would hand an admin every row, but
// "my complaints" means *mine* for admins too.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return jsonError(401, "unauthorized", "authentication required");

    const { rows } = await rlsQuery(
      `SELECT LEFT(id::text, 8) AS ref, id, status, channel, category, ward, severity,
              LEFT(COALESCE(summary_en, raw_text, ''), 140) AS summary, submitted_at
       FROM submissions
       WHERE user_id = $1
       ORDER BY submitted_at DESC
       LIMIT 50`,
      [userId]
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        submission_id: r.id,
        ref: r.ref,
        status: r.status,
        channel: r.channel,
        category: r.category,
        ward: r.ward,
        severity: r.severity,
        summary: r.summary,
        submitted_at: r.submitted_at,
      })),
    });
  } catch (e) {
    return handleRouteError(e, "GET /api/submissions");
  }
}
