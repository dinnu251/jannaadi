// GET /api/deadletters — admin/audit view. USP surface: nothing silent (B6).
// Route stays open per contract, but reads go through the RLS DAL: when the app
// runs as the non-owner jannaadi_web role, the submissions JOIN yields rows only
// for an admin session (citizens: own rows; anonymous: none). Owner connection
// (worker/local default) is unaffected.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Explicit admin gate (defence-in-depth): RLS already limits rows to the caller's
    // role, but this surface exposes raw complaint previews — never rely on RLS alone.
    // If the app is ever mis-run on the owner DB connection, this still holds the line.
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");
    if ((session.user as { role?: string }).role !== "admin") return jsonError(403, "forbidden", "admin access required");

    const { rows } = await rlsQuery(
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
