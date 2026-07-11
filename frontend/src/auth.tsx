// F-15: Auth wiring for the Vite SPA. next-auth/react with an explicit basePath —
// the Auth.js server lives in the backend (apps/web) at /api/auth, same origin via
// the Vite proxy (dev) / the fallback-rewrite serving (prod).
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import { Navigate, useLocation } from 'react-router-dom';

export const AUTH_BASE_PATH = '/api/auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider basePath={AUTH_BASE_PATH} refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}

// React Router client-side guard (replaces Next middleware.ts in the SPA world):
// unauthenticated users hitting protected routes are sent to /login, remembering
// where they came from so login can bounce them back.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
        Checking session…
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
