import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';
import { api, type RankItem, type Ward, type SummaryResponse, type SubmissionDetail } from '../api';
import { MapPin, BarChart3, AlertCircle, Info, FileText, CheckCircle2, Clock, Eye, Inbox, ChevronDown, ChevronUp, Mic, Camera, MessageSquare } from 'lucide-react';

// deck.gl (used for the live heatmap) is ~250KB gzipped — code-split it out
// of the main bundle so citizen-facing pages (e.g. SubmitPage) don't pay for
// an admin-only dependency.
const Heatmap = lazy(() => import('../components/Heatmap'));

const KpiTile: React.FC<{ icon: React.ReactNode; label: string; value: number; suffix?: string; color: string }> = ({ icon, label, value, suffix, color }) => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--color-background)' }}>
    <div style={{ color, display: 'flex' }}>{icon}</div>
    <div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color, lineHeight: 1.1 }}>
        {value.toLocaleString()}<span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{suffix}</span>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
    </div>
  </div>
);

// 8-week resolved-vs-total trend. Two thin lines share one y-scale (never a
// dual axis) — muted grey for Total, moss for Resolved, with a 10%-opacity
// area wash under Resolved (the "progress" story) and an end-marker + direct
// value label on each line's last point, per the dataviz skill's stat-tile
// sparkline spec (mark specs: 2px lines, >=8px end markers with a 2px surface
// ring, legend required for 2 series).
const TrendSparkline: React.FC<{ trend: { week: string; total: number; resolved: number }[] }> = ({ trend }) => {
  if (trend.length < 2) return null;
  const W = 280, H = 56, PAD = 8;
  const maxVal = Math.max(1, ...trend.map(t => t.total));
  const x = (i: number) => PAD + (i / (trend.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / maxVal) * (H - PAD * 2);
  const linePath = (key: 'total' | 'resolved') =>
    trend.map((t, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(t[key]).toFixed(1)}`).join(' ');
  const areaPath = (key: 'total' | 'resolved') =>
    `${linePath(key)} L ${x(trend.length - 1).toFixed(1)} ${H - PAD} L ${x(0).toFixed(1)} ${H - PAD} Z`;
  const last = trend[trend.length - 1];
  const lastI = trend.length - 1;

  return (
    <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'var(--color-background)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '84px' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>8-Week Trend</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.7rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--color-text-muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--color-text-muted)', display: 'inline-block' }} /> Total {last.total}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--color-success)', fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: 'var(--color-success)', display: 'inline-block' }} /> Resolved {last.resolved}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: 1, height: `${H}px` }} role="img" aria-label={`Weekly trend: total rose to ${last.total}, resolved reached ${last.resolved} in the latest week`}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-text-muted)" strokeOpacity={0.15} strokeWidth={1} />
        <path d={areaPath('resolved')} fill="var(--color-success)" fillOpacity={0.1} stroke="none" />
        <path d={linePath('total')} fill="none" stroke="var(--color-text-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={linePath('resolved')} fill="none" stroke="var(--color-success)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(lastI)} cy={y(last.total)} r={4} fill="var(--color-text-muted)" stroke="var(--color-background)" strokeWidth={2} />
        <circle cx={x(lastI)} cy={y(last.resolved)} r={4} fill="var(--color-success)" stroke="var(--color-background)" strokeWidth={2} />
      </svg>
    </div>
  );
};

// Compact category/ward rollup — resolved count shown as a filled bar against
// total. Rows are CLICKABLE: they apply the corresponding dashboard filter, so the
// breakdown doubles as navigation instead of being a dead read-only table.
const RollupTable: React.FC<{ title: string; rows: { label: string; total: number; resolved: number }[]; icon: React.ReactNode; onPick?: (label: string) => void }> = ({ title, rows, icon, onPick }) => (
  <div className="card" style={{ marginBottom: 'var(--spacing-lg)', backgroundColor: '#F9F7F4' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
      {icon}
      <h4 style={{ margin: 0, color: 'var(--color-text-main)' }}>{title}</h4>
      {onPick && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>click to filter</span>}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
      {rows.map(r => (
        <div
          key={r.label}
          onClick={onPick ? () => onPick(r.label) : undefined}
          style={onPick ? { cursor: 'pointer', borderRadius: '6px', padding: '3px 6px', margin: '-3px -6px', transition: 'background-color 0.12s' } : undefined}
          onMouseEnter={onPick ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(15,82,87,0.06)'; } : undefined}
          onMouseLeave={onPick ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; } : undefined}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '3px' }}>
            <span style={{ textTransform: 'capitalize', textDecoration: onPick ? 'underline dotted rgba(15,82,87,0.35)' : 'none', textUnderlineOffset: '3px' }}>{r.label}</span>
            <span><strong>{r.resolved}</strong><span style={{ color: 'var(--color-text-muted)' }}>/{r.total} resolved</span></span>
          </div>
          <div style={{ height: '5px', width: '100%', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${r.total > 0 ? (r.resolved / r.total * 100) : 0}%`, backgroundColor: 'var(--color-success)' }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Readable, expandable sample report. Was a bare UUID with a DEAD "View full audit
// trail →" link (styled as a link, no onClick — terrible demo optics). Now: fetches
// the real submission, shows the citizen's words + status/channel/severity, and the
// audit-trail link actually expands the pipeline stages inline.
const STATUS_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  processed: { label: '✓ Processed', bg: '#e6f4ea', fg: '#137333' },
  failed: { label: 'Failed', bg: '#fce8e6', fg: '#c5221f' },
};
const CHANNEL_ICON: Record<string, React.ReactNode> = {
  voice: <Mic size={12} />, photo: <Camera size={12} />, text: <MessageSquare size={12} />,
};
const SampleReport: React.FC<{ id: string }> = ({ id }) => {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getSubmission(id).then(res => {
      if (!alive) return;
      if (res.data) setDetail(res.data); else setFailed(true);
    });
    return () => { alive = false; };
  }, [id]);

  const box: React.CSSProperties = { fontSize: '0.8rem', padding: 'var(--spacing-sm)', backgroundColor: 'var(--color-background)', borderRadius: 'var(--border-radius-sm)', border: '1px solid #e2e8f0' };
  if (failed) return <div style={box}><span style={{ color: 'var(--color-text-muted)' }}>Report {id.slice(0, 8)} — details unavailable</span></div>;
  if (!detail) return <div style={box}><span style={{ color: 'var(--color-text-muted)' }}>Loading report {id.slice(0, 8)}…</span></div>;

  const chip = STATUS_CHIP[detail.status] ?? { label: detail.status, bg: '#e8f0fe', fg: '#1a56db' };
  const text = detail.extraction?.summary_original || detail.transcript || detail.raw_text || detail.extraction?.summary_en || '(media-only submission)';
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, backgroundColor: chip.bg, color: chip.fg }}>{chip.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>
          {CHANNEL_ICON[detail.channel]} {detail.channel}{detail.lang ? ` · ${detail.lang}` : ''}{detail.extraction?.severity ? ` · severity ${detail.extraction.severity}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>#{id.slice(0, 8)}</span>
      </div>
      <p style={{ margin: '0 0 6px', lineHeight: 1.45 }}>{text}</p>
      <button
        onClick={() => setShowAudit(s => !s)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
      >
        {showAudit ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showAudit ? 'Hide audit trail' : 'View full audit trail'}
      </button>
      {showAudit && (
        <div style={{ marginTop: 6, borderTop: '1px dashed #e2e8f0', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {(detail.audit ?? []).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-main)', minWidth: 76 }}>{a.stage}</span>
              <span>{new Date(a.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              {a.model && <span>· {a.model}</span>}
              {a.latency_ms != null && <span>· {a.latency_ms}ms</span>}
            </div>
          ))}
          {!(detail.audit ?? []).length && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>No audit events recorded.</span>}
        </div>
      )}
    </div>
  );
};

const DashboardPage: React.FC = () => {
  const { language } = useLanguage();
  const t = translations[language];

  const [wards, setWards] = useState<Ward[]>([]);
  const [filterWard, setFilterWard] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  
  const [items, setItems] = useState<RankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCached, setIsCached] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  const [heatmapPoints, setHeatmapPoints] = useState<{lat: number, lng: number, weight: number}[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);

  const [selectedItem, setSelectedItem] = useState<RankItem | null>(null);

  useEffect(() => {
    api.getWards().then(res => res.data && setWards(res.data.wards));
  }, []);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    // Fetch Rank list
    api.getRankings(filterWard || undefined, filterCategory || undefined, language).then(res => {
      if (res.data) {
        setItems(res.data.items);
      } else {
        // Bug fix: a real fetch failure previously left the list showing stale
        // data with no indication anything was wrong — surface it instead.
        setLoadError(res.error?.message ?? 'Could not load priorities. Please try again.');
      }
      setIsCached(!!res.cached);
      setLoading(false);
    });

    // Fetch Heatmap for category
    api.getHeatmap(filterCategory || undefined, filterWard || undefined).then(res => {
      if (res.data) setHeatmapPoints(res.data.points);
    });

    // KPI/analytics rollup — resolved/open counts, category+ward breakdown
    api.getSummary(filterWard || undefined, filterCategory || undefined).then(res => {
      if (res.data) setSummary(res.data);
    });
  }, [filterWard, filterCategory, language]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, overflow: 'hidden' }}>
      
      {/* Filters Header */}
      <div key="filters" style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
        <h2 style={{ margin: 0, color: 'var(--color-primary)', marginRight: 'auto' }}>{t.dashboardTitle}</h2>
        
        {isCached && <span className="badge badge-cached">Cached Fallback</span>}
        
        <select className="input-field" style={{ width: '200px' }} value={filterWard} onChange={e => setFilterWard(e.target.value)}>
          <option value="">-- {t.allWards} --</option>
          {wards.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
        
        <select className="input-field" style={{ width: '200px' }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">-- {t.allCategories} --</option>
          {/* Bug fix: was missing 'education' and 'other' — 2 of the backend's 8
              valid categories were unreachable from this filter. */}
          <option value="roads">Roads</option>
          <option value="drainage">Drainage</option>
          <option value="water">Water</option>
          <option value="streetlights">Streetlights</option>
          <option value="health">Health</option>
          <option value="garbage">Garbage</option>
          <option value="education">Education</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* KPI Strip — resolved/open counts so MP staff see progress at a glance,
          not just a ranked list. Sourced from /api/summary (admin-only). */}
      {summary && (
        <div key="kpis" style={{ display: 'flex', gap: 'var(--spacing-md)', padding: 'var(--spacing-sm) var(--spacing-md)', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
          <KpiTile icon={<Inbox size={16} />} label="Total" value={summary.totals.total} color="var(--color-primary)" />
          <KpiTile icon={<AlertCircle size={16} />} label="Open" value={summary.totals.open} color="var(--color-text-muted)" />
          <KpiTile icon={<Eye size={16} />} label="Acknowledged" value={summary.totals.acknowledged} color="var(--color-accent)" />
          <KpiTile icon={<Clock size={16} />} label="In Progress" value={summary.totals.in_progress} color="var(--color-warning)" />
          <KpiTile
            icon={<CheckCircle2 size={16} />}
            label="Resolved"
            value={summary.totals.resolved}
            suffix={summary.totals.total > 0 ? ` (${Math.round(summary.totals.resolved / summary.totals.total * 100)}%)` : ''}
            color="var(--color-success)"
          />
          <TrendSparkline trend={summary.trend} />
        </div>
      )}

      <div key="body" style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left Column - Ranking List */}
        <div style={{ width: '35%', borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
          <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', backgroundColor: '#EFEAE2', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            AI-RANKED PRIORITIES
          </div>
          
          <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--spacing-md)' }}>
            {loading ? (
              <p>Loading priorities...</p>
            ) : loadError ? (
              <div role="alert" style={{ padding: 'var(--spacing-sm)', backgroundColor: '#FDECEA', color: 'var(--color-error)', borderRadius: 'var(--border-radius-sm)', fontSize: '0.85rem' }}>
                {loadError}
              </div>
            ) : items.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No priorities match these filters.</p>
            ) : items.map((item, idx) => (
              <div 
                key={item.cluster_id} 
                className="card"
                style={{ 
                  marginBottom: 'var(--spacing-sm)', 
                  cursor: 'pointer',
                  borderLeft: `4px solid ${idx === 0 ? 'var(--color-error)' : idx < 3 ? 'var(--color-accent)' : 'var(--color-primary)'}`,
                  backgroundColor: selectedItem?.cluster_id === item.cluster_id ? 'rgba(15, 82, 87, 0.05)' : 'var(--color-surface)'
                }}
                onClick={() => setSelectedItem(item)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-main)' }}>
                    #{item.rank} {item.title_localized ?? item.title_en}
                  </h4>
                  <span style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>{(item.score * 100).toFixed(0)}</span>
                </div>
                
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={14} /> {item.ward}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle size={14} /> {item.submission_count} reports</span>
                </div>

                {/* T3/F14: "In dev plan" badge */}
                {item.plan_match && !('none' in item.plan_match) && (
                  <div 
                    title={item.plan_match.snippet} 
                    className="badge badge-saffron" 
                    style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <FileText size={12} /> {t.inDevPlan}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Middle Column - Score Breakdown & Detail */}
        <div style={{ width: '30%', borderRight: '1px solid rgba(0,0,0,0.05)', backgroundColor: 'var(--color-surface)', overflowY: 'auto', padding: 'var(--spacing-md)' }}>
          {selectedItem ? (
            <div>
              <h3 style={{ color: 'var(--color-primary)', marginBottom: 'var(--spacing-sm)' }}>Priority Detail</h3>
              <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{selectedItem.title_localized ?? selectedItem.title_en}</p>
              
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)' }}>
                <span className="badge" style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>{selectedItem.category}</span>
                <span className="badge" style={{ backgroundColor: '#e2e8f0', color: 'var(--color-text-main)' }}>{selectedItem.ward}</span>
              </div>

              {/* USP: Score Breakdown Panel */}
              <div className="card" style={{ marginBottom: 'var(--spacing-lg)', backgroundColor: '#F9F7F4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                  <BarChart3 size={18} color="var(--color-primary)" />
                  <h4 style={{ margin: 0, color: 'var(--color-text-main)' }}>Score Breakdown</h4>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                  {Object.entries(selectedItem.score_breakdown).map(([key, val]) => (
                    <div key={key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                        <span style={{ textTransform: 'capitalize' }}>{key}</span>
                        <strong>{(val * 100).toFixed(0)}</strong>
                      </div>
                      <div style={{ height: '6px', width: '100%', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${val * 100}%`, backgroundColor: 'var(--color-primary)' }}></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 'var(--spacing-md)', paddingTop: 'var(--spacing-sm)', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Total Score</span>
                  <strong style={{ fontSize: '1.2rem', color: 'var(--color-accent)' }}>{(selectedItem.score * 100).toFixed(0)}</strong>
                </div>
              </div>

              {/* T3/F14: Dev Plan Match Detail */}
              {selectedItem.plan_match && !('none' in selectedItem.plan_match) && (
                <div className="card" style={{ marginBottom: 'var(--spacing-lg)', borderLeft: '4px solid var(--color-accent)' }}>
                  <h4 style={{ margin: 0, marginBottom: 'var(--spacing-sm)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FileText size={16} /> Existing Dev Plan
                  </h4>
                  <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>{selectedItem.plan_match.doc_title}</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>"{selectedItem.plan_match.snippet}"</p>
                </div>
              )}

              {/* Audit Trail - Sample Submissions */}
              <div>
                <h4 style={{ marginBottom: 'var(--spacing-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={16} /> Sample Reports ({selectedItem.submission_count} total)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                  {selectedItem.sample_submission_ids.map(id => (
                    <SampleReport key={id} id={id} />
                  ))}
                  {!selectedItem.sample_submission_ids.length && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No sample reports available.</span>
                  )}
                </div>
              </div>

            </div>
          ) : summary ? (
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-lg)' }}>
                Select a priority on the left for details, or scan the breakdown below.
              </p>
              <RollupTable title="By Category" rows={summary.by_category.map(c => ({ label: c.category, total: c.total, resolved: c.resolved }))} icon={<BarChart3 size={16} color="var(--color-primary)" />} onPick={(label) => setFilterCategory(label)} />
              <RollupTable title="Top Wards" rows={summary.by_ward.map(w => ({ label: w.ward, total: w.total, resolved: w.resolved }))} icon={<MapPin size={16} color="var(--color-primary)" />} onPick={(label) => setFilterWard(label)} />
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
              Select a priority to view details
            </div>
          )}
        </div>

        {/* Right Column - Map */}
        <div style={{ flex: 1, padding: 'var(--spacing-md)', backgroundColor: 'var(--color-background)' }}>
          <div style={{ height: '100%', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
            <Suspense fallback={<div style={{ width: '100%', height: '100%', backgroundColor: '#e2e8f0' }} />}>
              <Heatmap points={heatmapPoints} />
            </Suspense>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DashboardPage;
