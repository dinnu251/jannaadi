// Error envelope per API.md: { "error": { "code": string, "message": string } }
import { NextResponse } from "next/server";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

// Uniform catch handler — every route failure is loud server-side but opaque to the
// client. Full detail (stack, DB errors, file paths) is logged; the response carries a
// generic message so internals never leak to callers.
export function handleRouteError(e: unknown, where: string) {
  console.error(`[${where}] ${e instanceof Error ? e.stack ?? e.message : e}`);
  return jsonError(500, "internal_error", "an unexpected error occurred");
}
