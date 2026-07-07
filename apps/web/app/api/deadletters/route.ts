// GET /api/deadletters — admin/audit view. USP surface: nothing silent (B6).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await db().query(
      `SELECT d.submission_id, d.failed_stage, d.reason,
              LEFT(COALESCE(s.raw_text, s.transcript, d.raw_response, ''), 200) AS raw_preview,
              d.at
       FROM deadletters d
       JOIN submissions s ON s.id = d.submission_id
       ORDER BY d.at DESC
       LIMIT 200`
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        submission_id: r.submission_id,
        failed_stage: r.failed_stage,
        reason: r.reason,
        raw_preview: r.raw_preview,
        at: r.at,
      })),
    });
  } catch (e) {
    return handleRouteError(e, "GET /api/deadletters");
  }
}
