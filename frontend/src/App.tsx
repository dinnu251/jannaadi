import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useSession, signOut } from 'next-auth/react';
import { LogIn, LogOut } from 'lucide-react';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { translations, type LanguageCode } from './i18n';
import { AuthProvider, RequireAuth } from './auth';
import SubmitPage from './pages/SubmitPage';
import DashboardPage from './pages/DashboardPage';
import DeadLettersPage from './pages/DeadLettersPage';
import MyComplaintsPage from './pages/MyComplaintsPage';
import MapTestPage from './pages/MapTestPage';
import LoginPage from './pages/LoginPage';

function TopNav() {
  const { language, setLanguage } = useLanguage();
  const t = translations[language];
  // Role-aware nav: the session already carries `role` (set server-side from
  // ADMIN_EMAILS in apps/web/auth.ts) — admins see Dashboard/Admin, signed-in
  // citizens see My Complaints, anonymous visitors see just the submit page.
  // This is presentation only; the API + RLS enforce access regardless.
  const { data, status } = useSession();
  const role = (data?.user as { role?: string } | undefined)?.role;
  const linkStyle = { color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' } as const;

  return (
    <header style={{
      backgroundColor: 'var(--color-primary)',
      color: 'white',
      padding: 'var(--spacing-md)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
        <Link to="/" style={{ color: 'white', fontWeight: 'bold', fontSize: '1.25rem' }}>{t.appTitle}</Link>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          {status === 'authenticated' && role !== 'admin' && (
            <Link to="/my-complaints" style={linkStyle}>{t.myComplaintsTitle}</Link>
          )}
          {role === 'admin' && (
            <>
              <Link to="/dashboard" style={linkStyle}>Dashboard</Link>
              <Link to="/deadletters" style={linkStyle}>Admin</Link>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
        {(['te', 'hi', 'en'] as LanguageCode[]).map(code => (
          <button
            key={code}
            onClick={() => setLanguage(code)}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              backgroundColor: language === code ? 'rgba(255,255,255,0.2)' : 'transparent',
              color: 'white',
              textTransform: 'uppercase',
              fontSize: '0.8rem',
              fontWeight: 'bold'
            }}
          >
            {code}
          </button>
        ))}
        {/* Auth control: prominent Login when signed out; identity chip + Logout when in */}
        {status === 'unauthenticated' && (
          <Link
            to="/login"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 999,
              backgroundColor: 'white', color: 'var(--color-primary)',
              fontSize: '0.85rem', fontWeight: 700, marginLeft: 8,
            }}
          >
            <LogIn size={15} /> {t.navLogin}
          </Link>
        )}
        {status === 'authenticated' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
            <span
              title={data?.user?.email ?? ''}
              style={{
                width: 28, height: 28, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase',
              }}
            >
              {(data?.user?.name ?? data?.user?.email ?? '?').slice(0, 1)}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.15)', color: 'white',
                border: '1px solid rgba(255,255,255,0.35)', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: 600,
              }}
            >
              <LogOut size={14} /> {t.navLogout}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <BrowserRouter>
          <div id="app-container" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <TopNav />
            <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <Routes>
                {/* citizen intake stays open — no session required to submit */}
                <Route path="/" element={<SubmitPage />} />
                <Route path="/login" element={<LoginPage />} />
                {/* F-15: MP dashboard + admin views behind the client-side guard;
                    the API enforces 401/RLS server-side regardless */}
                {/* Dev/debug: public heatmap harness replicating the dashboard's flex
                    panel — lets rendering bugs be reproduced without an admin login.
                    No citizen data: synthetic points only. */}
                <Route path="/map-test" element={<MapTestPage />} />
                <Route path="/my-complaints" element={<RequireAuth><MyComplaintsPage /></RequireAuth>} />
                <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
                <Route path="/deadletters" element={<RequireAuth><DeadLettersPage /></RequireAuth>} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
