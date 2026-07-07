// auth.ts — Auth.js v5, Google provider only (task 10).
// Google user id (profile sub) + assigned role ride the JWT into every session;
// the RLS DAL (lib/db.ts) forwards them to Postgres via set_config (task 11).
// Role assignment: emails in ADMIN_EMAILS (comma-separated env) → 'admin' (MP staff);
// everyone else → 'citizen'.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

function roleFor(email: string | null | undefined): "admin" | "citizen" {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return email && admins.includes(email.toLowerCase()) ? "admin" : "citizen";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Cloud Run sits behind a proxy; host validated by the platform
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        token.sub = profile.sub ?? token.sub; // Google account id — the RLS user_id
        token.role = roleFor(profile.email);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        (session.user as any).role = (token as any).role ?? "citizen";
      }
      return session;
    },
  },
});

export type SessionUser = { id: string; role: "admin" | "citizen"; email?: string | null };

// Session shape helper for the DAL and routes. Fail-open (anonymous) with a loud
// log: an auth misconfiguration must never block citizen submissions on the open
// ingest route. Protected routes call auth() directly and still fail loudly.
export async function sessionUser(): Promise<SessionUser | null> {
  try {
    const session = await auth();
    const u = session?.user as (SessionUser & { email?: string }) | undefined;
    return u?.id ? { id: u.id, role: u.role ?? "citizen", email: u.email } : null;
  } catch (e) {
    console.error(`[auth] sessionUser failed (treating as anonymous): ${e}`);
    return null;
  }
}
