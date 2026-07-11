// "No app? No problem." — the demo-visible face of the Twilio multi-channel intake.
// Renders a scannable WhatsApp QR (wa.me deep link, join code pre-filled for the
// sandbox) + a call-in number, so judges/citizens can file a complaint from their own
// phone in seconds. Channel config comes from /api/config (env-driven, no rebuild to
// change numbers). Renders nothing when no channels are configured.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { MessageCircle, PhoneCall } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';

type Channels = { whatsappNumber: string; whatsappJoinCode: string; voiceNumber: string };

export default function ChannelsPanel() {
  const { language } = useLanguage();
  const t = translations[language];
  const [channels, setChannels] = useState<Channels | null>(null);
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.channels?.whatsappNumber && setChannels(d.channels))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!channels?.whatsappNumber) return;
    // wa.me wants digits only; pre-fill the sandbox join code when present so a
    // first-time judge is one "send" away from being connected.
    const digits = channels.whatsappNumber.replace(/[^\d]/g, '');
    const text = channels.whatsappJoinCode ? `join ${channels.whatsappJoinCode}` : '';
    const link = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    QRCode.toDataURL(link, { width: 168, margin: 1, color: { dark: '#0F5257' } })
      .then(setQr)
      .catch(() => {});
  }, [channels]);

  if (!channels) return null;

  return (
    <div
      style={{
        marginTop: 'var(--spacing-lg, 24px)',
        padding: 'var(--spacing-md)',
        backgroundColor: 'white',
        borderRadius: 'var(--border-radius-md)',
        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))',
        display: 'flex',
        gap: 'var(--spacing-md)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      {qr && (
        <div style={{ textAlign: 'center' }}>
          <img src={qr} alt="WhatsApp QR" width={140} height={140} style={{ display: 'block', borderRadius: 8 }} />
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{t.channelsScan}</span>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 220 }}>
        <h3 style={{ margin: '0 0 8px', color: 'var(--color-primary)', fontSize: '1.05rem' }}>{t.channelsTitle}</h3>
        <p style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem' }}>
          <MessageCircle size={16} color="#25D366" />
          <span>
            {t.channelsWhatsapp} — <strong>{channels.whatsappNumber}</strong>
            {channels.whatsappJoinCode && (
              <span style={{ color: 'var(--color-text-muted)' }}> (first: “join {channels.whatsappJoinCode}”)</span>
            )}
          </span>
        </p>
        {channels.voiceNumber && (
          <p style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem' }}>
            <PhoneCall size={16} color="var(--color-accent)" />
            <span>
              {t.channelsCall} — <strong>{channels.voiceNumber}</strong>
            </span>
          </p>
        )}
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{t.channelsTrack}</p>
      </div>
    </div>
  );
}
