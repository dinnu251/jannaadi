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
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    g.__jannaadiPool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
