// "My Complaints" — the signed-in citizen's own submissions, newest first.
// Server: GET /api/submissions (session-scoped by user_id + RLS). This closes the
// citizen-tracking loop: submit anywhere (web/WhatsApp/SMS/call with login-linked
// rows), track here. WhatsApp/SMS submissions from a phone (no login) are tracked
// via the STATUS command instead — they have no user_id to show up here.
import { useEffect, useState } from 'react';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';

interface MyComplaint {
  submission_id: string;
  ref: string;
  status: string;
  channel: string;
  category: string | null;
  ward: string | null;
  severity: number | null;
  summary: string;
  submitted_at: string;
}

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  processed: { label: '✓ Registered', bg: '#e6f4ea', fg: '#137333' },
  failed:    { label: 'Needs attention', bg: '#fce8e6', fg: '#c5221f' },
  received:  { label: 'Received', bg: '#e8f0fe', fg: '#1a56db' },
  transcribed: { label: 'Processing', bg: '#fef7e0', fg: '#b06000' },
  extracted:   { label: 'Processing', bg: '#fef7e0', fg: '#b06000' },
  clustered:   { label: 'Processing', bg: '#fef7e0', fg: '#b06000' },
};

const CHANNEL_ICON: Record<string, string> = { text: '📝', voice: '🎙️', photo: '📷' };

export default function MyComplaintsPage() {
  const { language } = useLanguage();
  const t = translations[language];
  const [items, setItems] = useState<MyComplaint[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/submissions')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setItems(d.items ?? []))
      .catch(() => setError(true));
  }, []);

  return (
    <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: 'var(--spacing-md)' }}>
      <h1 style={{ color: 'var(--color-primary)', fontSize: '1.4rem', marginBottom: 'var(--spacing-md)' }}>
        {t.myComplaintsTitle}
      </h1>

      {error && (
        <div className="card" style={{ padding: 'var(--spacing-md)', color: 'var(--color-text-muted)' }}>
          Could not load your complaints. Please try again.
        </div>
      )}

      {!error && items === null && (
        <div style={{ color: 'var(--color-text-muted)' }}>{t.myComplaintsLoading}</div>
      )}

      {!error && items !== null && items.length === 0 && (
        <div className="card" style={{ padding: 'var(--spacing-lg, 24px)', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>{t.myComplaintsEmpty}</p>
          <a href="/" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{t.submitGrievance} →</a>
        </div>
      )}

      {!error && items !== null && items.map((c) => {
        const st = STATUS_STYLE[c.status] ?? { label: c.status, bg: '#e2e8f0', fg: '#334155' };
        const date = new Date(c.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        return (
          <div
            key={c.submission_id}
            className="card"
            style={{
              padding: 'var(--spacing-md)',
              marginBottom: 'var(--spacing-sm, 8px)',
              backgroundColor: 'white',
              borderRadius: 'var(--border-radius-md)',
              boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600, backgroundColor: st.bg, color: st.fg }}>
                {st.label}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                {CHANNEL_ICON[c.channel] ?? ''} Ref {c.ref} · {date}
              </span>
            </div>
            {c.summary && (
              <p style={{ margin: '8px 0 6px', fontSize: '0.95rem', color: 'var(--color-text-main, #1f2937)' }}>{c.summary}</p>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {c.category && (
                <span className="badge" style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>{c.category}</span>
              )}
              {c.ward && (
                <span className="badge" style={{ backgroundColor: '#e2e8f0', color: 'var(--color-text-main, #1f2937)' }}>{c.ward}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
