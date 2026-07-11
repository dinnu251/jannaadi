// PATCH /api/submissions/:id/status — v1.2. Admin-only. MP staffer updates
// resolution_status; triggers an SMS/WhatsApp to the citizen via Twilio if a
// verified phone is on file. See handovers/API.md "v1.2 additions", PROMPTS.md task 13.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";
import { sendStatusUpdate } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IdZ = z.string().uuid();
const BodyZ = z.object({
  resolution_status: z.enum(["acknowledged", "in_progress", "resolved"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return jsonError(401, "unauthorized", "authentication required");
    if ((session.user as { role?: string }).role !== "admin") return jsonError(403, "forbidden", "admin access required");

    const { id: rawId } = await ctx.params;
    const idParsed = IdZ.safeParse(rawId);
    if (!idParsed.success) return jsonError(400, "bad_request", "id must be a uuid");
    const id = idParsed.data;

    const bodyParsed = BodyZ.safeParse(await req.json().catch(() => null));
    if (!bodyParsed.success) return jsonError(400, "validation_failed", bodyParsed.error.issues.map((i) => i.message).join("; "));
    const { resolution_status, note } = bodyParsed.data;

    // Owner connection (bypasses RLS by design, same as the worker) — the status
    // write must never be blocked by a misconfigured citizen_access policy; the
    // explicit admin-role check above is the real gate for this route.
    const { rows: [updated] } = await db().query(
      "UPDATE submissions SET resolution_status = $1 WHERE id = $2 RETURNING id, phone, phone_verified",
      [resolution_status, id]
    );
    if (!updated) return jsonError(404, "not_found", `no submission ${id}`);

    await db().query(
      "INSERT INTO audit_events (submission_id, stage, detail) VALUES ($1, 'processed', $2)",
      [id, JSON.stringify({ resolution_status_changed_to: resolution_status, note: note ?? null, changed_by: (session.user as { email?: string }).email ?? "admin" })]
    );

    // Status update always commits above; a notification failure is logged, never
    // rolls back the change and never fails the request (PROMPTS.md task 13). Only
    // notify for phone_verified numbers — an unverified phone typed into the form
    // is not a reliable delivery target and shouldn't be trusted for outbound SMS.
    let notified = false;
    if (updated.phone && updated.phone_verified) {
      try {
        await sendStatusUpdate(updated.phone, resolution_status, note ?? null);
        notified = true;
      } catch (e) {
        console.error(`[PATCH /api/submissions/:id/status] Twilio notify failed for ${id}: ${e instanceof Error ? e.message : e}`);
      }
    }

    return NextResponse.json({ submission_id: id, resolution_status, notified });
  } catch (e) {
    return handleRouteError(e, "PATCH /api/submissions/:id/status");
  }
}
