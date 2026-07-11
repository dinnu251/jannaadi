// Public debug harness for the dashboard heatmap. Replicates DashboardPage's exact
// container structure (3-col flex row → panel → 100% wrapper → lazy Heatmap) so map
// sizing/rendering bugs reproduce here WITHOUT needing an admin login. Synthetic
// points only — no citizen data. Safe to leave routed; remove after the demo if noise.
import { Suspense, lazy } from 'react';

const Heatmap = lazy(() => import('../components/Heatmap'));

const POINTS = Array.from({ length: 60 }, (_, i) => ({
  lat: 17.68 + Math.sin(i * 1.7) * 0.06,
  lng: 83.2 + Math.cos(i * 2.3) * 0.08,
  weight: 1 + (i % 5),
}));

export default function MapTestPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '8px 16px', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
        map-test harness — synthetic points, mirrors DashboardPage layout
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 260, backgroundColor: '#efe9df' }} />
        <div style={{ width: 320, backgroundColor: '#f7f3ec' }} />
        <div style={{ flex: 1, padding: 'var(--spacing-md)', backgroundColor: 'var(--color-background)' }}>
          <div style={{ height: '100%', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
            <Suspense fallback={<div style={{ width: '100%', height: '100%', backgroundColor: '#e2e8f0' }} />}>
              <Heatmap points={POINTS} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
