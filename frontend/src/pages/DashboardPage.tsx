import React, { useState, useEffect } from 'react';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';
import { api, type RankItem, type Ward } from '../api';
import Heatmap from '../components/Heatmap';
import { MapPin, BarChart3, AlertCircle, Info, FileText } from 'lucide-react';

const DashboardPage: React.FC = () => {
  const { language } = useLanguage();
  const t = translations[language];

  const [wards, setWards] = useState<Ward[]>([]);
  const [filterWard, setFilterWard] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  
  const [items, setItems] = useState<RankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCached, setIsCached] = useState(false);
  
  const [heatmapPoints, setHeatmapPoints] = useState<{lat: number, lng: number, weight: number}[]>([]);
  
  const [selectedItem, setSelectedItem] = useState<RankItem | null>(null);

  useEffect(() => {
    api.getWards().then(res => res.data && setWards(res.data.wards));
  }, []);

  useEffect(() => {
    setLoading(true);
    // Fetch Rank list
    api.getRankings(filterWard || undefined, filterCategory || undefined, language).then(res => {
      if (res.data) setItems(res.data.items);
      setIsCached(!!res.cached);
      setLoading(false);
    });
    
    // Fetch Heatmap for category
    api.getHeatmap(filterCategory || undefined).then(res => {
      if (res.data) setHeatmapPoints(res.data.points);
    });
  }, [filterWard, filterCategory, language]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, overflow: 'hidden' }}>
      
      {/* Filters Header */}
      <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
        <h2 style={{ margin: 0, color: 'var(--color-primary)', marginRight: 'auto' }}>{t.dashboardTitle}</h2>
        
        {isCached && <span className="badge badge-cached">Cached Fallback</span>}
        
        <select className="input-field" style={{ width: '200px' }} value={filterWard} onChange={e => setFilterWard(e.target.value)}>
          <option value="">-- {t.allWards} --</option>
          {wards.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
        
        <select className="input-field" style={{ width: '200px' }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">-- {t.allCategories} --</option>
          <option value="roads">Roads</option>
          <option value="drainage">Drainage</option>
          <option value="water">Water</option>
          <option value="streetlights">Streetlights</option>
          <option value="health">Health</option>
          <option value="garbage">Garbage</option>
        </select>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Column - Ranking List */}
        <div style={{ width: '35%', borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
          <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', backgroundColor: '#EFEAE2', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            AI-RANKED PRIORITIES
          </div>
          
          <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--spacing-md)' }}>
            {loading ? (
              <p>Loading priorities...</p>
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
                    #{item.rank} {item.title_en}
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
              <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{selectedItem.title_en}</p>
              
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
                    <div key={id} style={{ fontSize: '0.8rem', padding: 'var(--spacing-sm)', backgroundColor: 'var(--color-background)', borderRadius: 'var(--border-radius-sm)', border: '1px solid #e2e8f0' }}>
                      <strong>ID:</strong> {id.substring(0,8)}... <br/>
                      <span style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}>View full audit trail &rarr;</span>
                    </div>
                  ))}
                </div>
              </div>

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
            <Heatmap points={heatmapPoints} />
          </div>
        </div>

      </div>
    </div>
  );
};

export default DashboardPage;
