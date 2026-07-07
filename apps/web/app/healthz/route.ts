// GET /healthz — each dependency actually probed, never assumed (API.md, B12).
// db: SELECT 1. pubsub: topic 'submissions' exists. gemini: metadata fetch of the
// pinned model. 200 when all ok, 503 when any dependency fails.
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/db";
import { pubsub } from "@/lib/gcp";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
  ]);
}

async function checkDb(): Promise<string> {
  await withTimeout(db().query("SELECT 1"), "db");
  return "ok";
}

async function checkPubsub(): Promise<string> {
  const [exists] = await withTimeout(pubsub().topic(process.env.PUBSUB_TOPIC ?? "submissions").exists(), "pubsub");
  if (!exists) throw new Error("topic 'submissions' does not exist");
  return "ok";
}

async function checkGemini(): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  // pinned model from app_config when the DB is up; env/default fallback keeps the
  // gemini check independent of a db outage (each dependency reported separately)
  let model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-002";
  try {
    const { rows: [r] } = await db().query("SELECT val FROM app_config WHERE key = 'gemini_model'");
    if (r?.val) model = r.val;
  } catch { /* db check reports its own failure */ }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  await withTimeout(ai.models.get({ model }), "gemini");
  return "ok";
}

export async function GET() {
  const [dbR, psR, gmR] = await Promise.allSettled([checkDb(), checkPubsub(), checkGemini()]);
  const val = (r: PromiseSettledResult<string>, name: string) => {
    if (r.status === "fulfilled") return "ok";
    console.error(`[healthz] ${name}: ${r.reason}`);
    return "fail";
  };
  const body = { db: val(dbR, "db"), pubsub: val(psR, "pubsub"), gemini: val(gmR, "gemini") };
  const allOk = Object.values(body).every((v) => v === "ok");
  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}
