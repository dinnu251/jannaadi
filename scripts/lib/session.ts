// scripts/lib/session.ts — mint a real Auth.js v5 session cookie for test gates.
// golden.sh / demo-reset.sh / verify-local.ts hit routes protected by await auth();
// they authenticate by encoding a session JWT with the SAME AUTH_SECRET the server
// uses (JWE, next-auth/jwt encode). No bypass exists in app code — a wrong secret
// gets 401 like anyone else. Requires AUTH_SECRET in the environment.
import { encode } from "next-auth/jwt";

export async function mintSessionCookie(
  opts: { role?: "admin" | "citizen"; sub?: string } = {}
): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET required to mint a test session (must match the server's AUTH_SECRET)");
  const { role = "admin", sub = "test-runner" } = opts;
  const secure = (process.env.BASE_URL ?? "http://localhost").startsWith("https");
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  const jwt = await encode({
    token: { sub, role, email: `${sub}@jannaadi.test`, name: sub },
    secret,
    salt: cookieName,
    maxAge: 60 * 60, // 1h — enough for any gate run
  });
  return `${cookieName}=${jwt}`;
}
