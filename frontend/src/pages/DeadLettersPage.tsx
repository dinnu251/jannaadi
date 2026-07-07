import React, { useEffect, useState } from 'react';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';
import { api, type DeadLetter } from '../api';
import { AlertTriangle, Clock } from 'lucide-react';

const DeadLettersPage: React.FC = () => {
  const { language } = useLanguage();
  const t = translations[language];
  const [items, setItems] = useState<DeadLetter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDeadLetters().then(res => {
      if (res.data) setItems(res.data.items);
      setLoading(false);
    });
  }, []);

  return (
    <div style={{ padding: 'var(--spacing-lg)', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)' }}>
        <AlertTriangle color="var(--color-error)" size={28} />
        <h1 style={{ color: 'var(--color-error)', margin: 0 }}>{t.deadlettersTitle}</h1>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
          {items.map(item => (
            <div key={item.submission_id} className="card" style={{ borderLeft: '4px solid var(--color-error)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-sm)' }}>
                <div>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                    Submission: {item.submission_id.substring(0, 12)}...
                    <span className="badge" style={{ backgroundColor: 'var(--color-error)', color: 'white' }}>
                      Stage: {item.failed_stage}
                    </span>
                  </h3>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={14} />
                  {new Date(item.at).toLocaleString()}
                </div>
              </div>
              
              <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <strong>Reason: </strong> <span style={{ fontFamily: 'monospace', color: 'var(--color-error-light)' }}>{item.reason}</span>
              </div>
              
              <div style={{ backgroundColor: '#f8f9fa', padding: 'var(--spacing-sm)', borderRadius: 'var(--border-radius-sm)', overflowX: 'auto' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Raw Preview:</strong>
                <pre style={{ margin: 0, fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                  {item.raw_preview}
                </pre>
              </div>
            </div>
          ))}
          {items.length === 0 && <p>No dead letters found.</p>}
        </div>
      )}
    </div>
  );
};

export default DeadLettersPage;
