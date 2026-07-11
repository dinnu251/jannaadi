// GET /api/submissions/:id — status + extraction + full audit trail (API.md, B8).
// Auth required; reads go through the RLS DAL, so a citizen can only fetch their
// own submissions (404 for others' — RLS filters the row before the route sees it).
// PATCH .../status lives at app/api/submissions/[id]/status/route.ts (v1.2 feedback loop).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rlsQuery } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

const IdZ = z.string().uuid();

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");

    const { id: rawId } = await ctx.params;
    const idParsed = IdZ.safeParse(rawId);
    if (!idParsed.success) return jsonError(400, "bad_request", "id must be a uuid");
    const id = idParsed.data;

    const { rows: [s] } = await rlsQuery("SELECT * FROM submissions WHERE id = $1", [id]);
    if (!s) return jsonError(404, "not_found", `no submission ${id}`);

    const [{ rows: audit }, { rows: [dl] }] = await Promise.all([
      rlsQuery(
        "SELECT stage, at, model, latency_ms, detail FROM audit_events WHERE submission_id = $1 ORDER BY at",
        [id]
      ),
      rlsQuery(
        "SELECT reason FROM deadletters WHERE submission_id = $1 ORDER BY at DESC LIMIT 1",
        [id]
      ),
    ]);

    return NextResponse.json({
      submission_id: s.id,
      status: s.status,
      channel: s.channel,
      lang: s.lang,
      raw_text: s.raw_text,
      transcript: s.transcript,
      extraction: s.category
        ? {
            category: s.category,
            ward: s.ward,
            severity: s.severity,
            summary_en: s.summary_en,
            summary_original: s.summary_original,
          }
        : null,
      cluster_id: s.cluster_id,
      audit: audit.map((a) => ({
        stage: a.stage,
        at: a.at,
        model: a.model,
        latency_ms: a.latency_ms,
        detail: a.detail, // additive: carries stt confidence, retry count, ward_resolved_via (B14)
      })),
      failure_reason: s.status === "failed" ? (dl?.reason ?? "unknown") : null,
      resolution_status: s.resolution_status,
      geo_verified: s.geo_verified,
      duplicate_of: s.duplicate_of,
    });
  } catch (e) {
    return handleRouteError(e, "GET /api/submissions/:id");
  }
}
