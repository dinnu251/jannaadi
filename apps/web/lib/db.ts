// Shared pg pool for API routes. Singleton via globalThis so Next.js dev HMR
// doesn't leak connections. The worker keeps its own pool (worker/ingest.ts).
//
// rlsQuery() is the RLS Data Access Layer (PROMPTS task 11): protected routes must
// NOT call db().query() directly — every statement runs inside a transaction that
// first sets app.current_user_id/app.current_user_role from the NextAuth session,
// so db/rls_policies.sql enforces authorization even if a route filter is missed.
import { Pool, QueryResult } from "pg";
import { sessionUser } from "@/auth";

const g = globalThis as unknown as { __jannaadiPool?: Pool };

export function db(): Pool {
  if (!g.__jannaadiPool) {
    // Web app connects as jannaadi_web (non-owner) so RLS policies bite.
    // Worker connects as jannaadi_owner (bypasses RLS — processes all rows).
    const connStr = process.env.WEB_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connStr) throw new Error("WEB_DATABASE_URL (or DATABASE_URL) not set");
    g.__jannaadiPool = new Pool({
      connectionString: connStr,
      max: 10,
      // a DB restart must surface as a loud error, not a silent hang on a dead socket
      connectionTimeoutMillis: 10_000,
      query_timeout: 30_000,
      keepAlive: true,
    });
    g.__jannaadiPool.on("error", (e) => console.error(`[pg pool] idle client error: ${e.message}`));
  }
  return g.__jannaadiPool;
}

// Owner pool — BYPASSES RLS. Use ONLY for queries that are self-scoping by
// construction: the Twilio STATUS lookup filters by sender_ref = HMAC of the
// requesting phone number (a caller can only ever derive their own ref), so it
// can't read anyone else's rows. Anonymous webhooks have no session for the RLS
// DAL, and the DEMO_MODE worker already runs on this same owner connection.
const go = globalThis as unknown as { __jannaadiOwnerPool?: Pool };
export function ownerDb(): Pool {
  if (!go.__jannaadiOwnerPool) {
    const connStr = process.env.DATABASE_URL ?? process.env.WEB_DATABASE_URL;
    if (!connStr) throw new Error("DATABASE_URL not set");
    go.__jannaadiOwnerPool = new Pool({
      connectionString: connStr,
      max: 4,
      connectionTimeoutMillis: 10_000,
      query_timeout: 30_000,
      keepAlive: true,
    });
    go.__jannaadiOwnerPool.on("error", (e) => console.error(`[pg owner pool] idle client error: ${e.message}`));
  }
  return go.__jannaadiOwnerPool;
}

// RLS DAL. BEGIN → set_config(user_id) → set_config(role) → query → COMMIT.
// set_config(..., true) is transaction-local, so the identity can never leak onto
// a pooled connection reused by another request. Rolls back loudly on any error.
export async function rlsQuery(text: string, params: unknown[] = []): Promise<QueryResult> {
  const user = await sessionUser();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [user?.id ?? ""]);
    await client.query("SELECT set_config('app.current_user_role', $1, true)", [user?.role ?? ""]);
    const result = await client.query(text, params as any[]);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
