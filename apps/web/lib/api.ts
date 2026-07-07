// Error envelope per API.md: { "error": { "code": string, "message": string } }
import { NextResponse } from "next/server";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

// Uniform catch handler — every route failure is loud and shaped per contract.
export function handleRouteError(e: unknown, where: string) {
  console.error(`[${where}] ${e instanceof Error ? e.stack ?? e.message : e}`);
  return jsonError(500, "internal_error", e instanceof Error ? e.message : String(e));
}
