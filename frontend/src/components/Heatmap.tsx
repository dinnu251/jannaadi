/// <reference types="google.maps" />
import React, { useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';

interface HeatmapProps {
  points: { lat: number; lng: number; weight: number }[];
}

const Heatmap: React.FC<HeatmapProps> = ({ points }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [heatmapLayer, setHeatmapLayer] = useState<any | null>(null);

  useEffect(() => {
    const initMap = async () => {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        setLoadError(true);
        return;
      }

      const loader = new Loader({
        apiKey,
        version: "weekly",
        libraries: ["visualization"]
      });

      try {
        // @ts-expect-error
        const { Map } = await loader.importLibrary("maps");
        // Center near Gajuwaka for demo
        const center = { lat: 17.6868, lng: 83.1953 };
        
        if (mapRef.current) {
          const map = new Map(mapRef.current, {
            center,
            zoom: 12,
            mapId: "DEMO_MAP_ID",
            disableDefaultUI: true,
            zoomControl: true,
          });
          setMapInstance(map);
        }
      } catch (err) {
        console.error("Map load error", err);
        setLoadError(true);
      }
    };

    initMap();
  }, []);

  useEffect(() => {
    if (mapInstance && (window as any).google) {
      // Clear old layer
      if (heatmapLayer) {
        heatmapLayer.setMap(null);
      }

      const heatMapData = points.map(p => ({
        location: new google.maps.LatLng(p.lat, p.lng),
        weight: p.weight
      }));

      const newLayer = new (window as any).google.maps.visualization.HeatmapLayer({
        data: heatMapData,
        radius: 20,
        opacity: 0.8
      });
      
      newLayer.setMap(mapInstance);
      setHeatmapLayer(newLayer);
    }
  }, [points, mapInstance]);

  if (loadError) {
    return (
      <div style={{ width: '100%', height: '100%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--border-radius-md)', position: 'relative', overflow: 'hidden' }}>
        {/* Static Fallback for F8 */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(232, 135, 30, 0.4) 0%, transparent 60%)', opacity: 0.5 }}></div>
        <div style={{ textAlign: 'center', zIndex: 1, padding: 'var(--spacing-md)' }}>
          <h3 style={{ margin: 0, color: 'var(--color-text-muted)' }}>Static Map Fallback</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>API Key missing or network error. Displaying hotspot overview for Gajuwaka.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 'var(--border-radius-md)' }} />
  );
};

export default Heatmap;
