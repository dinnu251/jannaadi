// GET /api/wards — the closed ward enum, straight from the single source of truth (seed.sql).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await db().query("SELECT name, lat, lng FROM wards ORDER BY name");
    return NextResponse.json({ wards: rows });
  } catch (e) {
    return handleRouteError(e, "GET /api/wards");
  }
}
