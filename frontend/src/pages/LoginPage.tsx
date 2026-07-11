// F-15: mobile-first login page. Palette: deep teal #0F5257 primary, warm sand
// #F4EDE4 background, saffron #E8871E accent (CSS vars from index.css).
// Google is the only provider (Auth.js server config in the backend).
// Sign-in button follows Google's branding guidance: white surface, #dadce0
// border, dark label — not a filled brand-coloured button.
import { useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';

export default function LoginPage() {
  const { language } = useLanguage();
  const t = translations[language];
  const { status, data } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Explicit destination (came from a RequireAuth bounce) wins; otherwise land by
  // role — admins (ADMIN_EMAILS) → MP dashboard, citizens → their complaints list.
  const from = (location.state as { from?: string } | null)?.from ?? null;

  useEffect(() => {
    if (status !== 'authenticated') return;
    const role = (data?.user as { role?: string } | undefined)?.role;
    navigate(from ?? (role === 'admin' ? '/dashboard' : '/my-complaints'), { replace: true });
  }, [status, data, from, navigate]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-background)',
        padding: 'var(--spacing-md, 16px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          backgroundColor: 'white',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(15, 82, 87, 0.18)',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {/* Brand band: teal header with the logo mark, matching the app's TopNav */}
        <div style={{ backgroundColor: 'var(--color-primary)', padding: '28px 24px 22px' }}>
          <div
            aria-hidden
            style={{
              width: 60,
              height: 60,
              margin: '0 auto 10px',
              borderRadius: '50%',
              backgroundColor: 'white',
              color: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem',
              fontWeight: 700,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            జ
          </div>
          <h1 style={{ color: 'white', fontSize: '1.35rem', margin: 0 }}>{t.loginTitle}</h1>
        </div>

        <div style={{ padding: '24px' }}>
        <p style={{ color: 'var(--color-text-muted, #5b6b6d)', fontSize: '0.9rem', margin: '0 0 22px', lineHeight: 1.5 }}>
          {t.loginSubtitle}
        </p>

        <button
          // OAuth returns to /login — the effect above then routes by role (the role
          // isn't known until the session comes back, so we can't pick the URL here).
          onClick={() => signIn('google', { callbackUrl: from ?? '/login', redirectTo: from ?? '/login' } as Record<string, string>)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 10,
            border: '1px solid #dadce0',
            cursor: 'pointer',
            backgroundColor: 'white',
            color: '#3c4043',
            fontSize: '0.98rem',
            fontWeight: 600,
            boxShadow: '0 1px 3px rgba(60,64,67,0.15)',
          }}
        >
          {/* Google "G" */}
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41 35.4 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z"/>
          </svg>
          Sign in with Google
        </button>

        <p style={{ marginTop: 20, marginBottom: 0, fontSize: '0.8rem', color: 'var(--color-primary-dark, #0A3C40)', opacity: 0.6 }}>
          Citizens can submit issues <a href="/" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>without signing in</a>.
        </p>
        </div>
      </div>
    </div>
  );
}
