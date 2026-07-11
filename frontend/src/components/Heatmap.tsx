/// <reference types="google.maps" />
import React, { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { ScatterplotLayer } from '@deck.gl/layers';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';

interface HeatmapProps {
  points: { lat: number; lng: number; weight: number }[];
}

// Weight -> heat-gradient RGB. Urgency ramp: warm yellow → brand saffron → deep
// crimson. (The previous moss-green low end read like parks/vegetation against the
// basemap — wrong semantics for "problem density".) Independent of any GPU
// aggregation pass — see the render effect below for why.
function heatColor(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [255, 205, 60],  // low — warm yellow
    [232, 135, 30],  // mid — saffron (brand accent #E8871E)
    [183, 28, 28],   // high — deep crimson
  ];
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const localT = t * (stops.length - 1) - seg;
  const [r1, g1, b1] = stops[seg];
  const [r2, g2, b2] = stops[seg + 1];
  return [r1 + (r2 - r1) * localT, g1 + (g2 - g1) * localT, b1 + (b2 - b1) * localT];
}

let __mountSeq = 0; // diagnosis: distinguishes remount storms from init retries in logs

const Heatmap: React.FC<HeatmapProps> = ({ points }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<InstanceType<typeof GoogleMapsOverlay> | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  // Bumping retryNonce re-runs the init effect — powers the fallback's Retry button.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const mountId = ++__mountSeq;
    let alive = true; // stale async init from an unmounted instance must go inert
    console.log(`[Heatmap] mount #${mountId}`);
    const initMap = async () => {
      let apiKey = "";
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          apiKey = data.mapsApiKey;
        }
      } catch (e) {
        console.error("Failed to fetch maps API key from /api/config", e);
      }

      if (!apiKey) {
        setLoadError(true);
        return;
      }

      // Bug fix: @googlemaps/js-api-loader v2 removed the `Loader` class
      // constructor (it now throws — "no longer available in this version")
      // in favour of standalone setOptions()/importLibrary() functions. The
      // old `new Loader(...)` call threw OUTSIDE this try/catch, so the map
      // silently never rendered and the static fallback below never showed
      // either — this bug meant the heatmap was permanently blank in
      // production with no error visible to the user. Fixed by using the
      // current API and moving all of it inside the try/catch.
      try {
        setOptions({ key: apiKey, v: "weekly" });
        const { Map } = await importLibrary("maps");
        // Center near Gajuwaka for demo
        const center = { lat: 17.6868, lng: 83.1953 };

        // Bug fix: this component is lazy-loaded (Suspense) into a flex panel, so at
        // construction time the container can still be 0×0 / mid-layout. Google Maps
        // snapshots the container size when the Map is created. Wait for the
        // container to report a real, settled size before constructing.
        if (mapRef.current) {
          const el = mapRef.current;
          for (let i = 0; i < 120 && (el.clientWidth < 50 || el.clientHeight < 50); i++) {
            await new Promise(requestAnimationFrame);
          }
        }
        if (!mapRef.current) return;

        // Bug fix (verified live on app.prasyn.com): map initialization intermittently
        // STALLED forever — the outer container div appeared but the .gm-style tree
        // never materialized, no error thrown, so neither the map nor the fallback
        // ever showed ("small map"/blank panel reports). Two hardening measures:
        //   1. Construct the map into a FRESH inner div and attach the deck.gl overlay
        //      only AFTER the map signals readiness ('idle'/tiles) — attaching the
        //      WebGL overlay mid-handshake is the prime stall suspect on this GPU
        //      stack (see the ScatterplotLayer note below for prior WebGL fragility).
        //   2. Watchdog each attempt: if no sized .gm-style within 7s, tear the inner
        //      div down and retry once; after the retry, show the visible fallback —
        //      never hang silently again.
        // ROOT CAUSE (proven live with in-page probes): Chrome fully suspends the
        // rendering pipeline in hidden/occluded tabs — rAF, ResizeObserver and
        // IntersectionObserver all deliver ZERO callbacks — and Google Maps cannot
        // complete initialization without them. Constructing while hidden left the
        // map permanently stalled (or frozen at a bogus size once visible again).
        // Therefore: never construct while hidden; wait for visibility first.
        const waitForVisible = async () => {
          while (document.visibilityState === "hidden") {
            console.log("[Heatmap] tab hidden — deferring map init until visible");
            await new Promise((r) => document.addEventListener("visibilitychange", r, { once: true }));
          }
        };

        const buildOnce = async (attempt: number, useVector = true): Promise<google.maps.Map | null> => {
          await waitForVisible();
          const host = mapRef.current;
          if (!host) return null;
          const inner = document.createElement("div");
          inner.style.cssText = "width:100%;height:100%";
          host.replaceChildren(inner);
          console.log(`[Heatmap] constructing map (attempt ${attempt}, ${useVector ? "vector" : "raster"})`);
          const map = new Map(inner, {
            center,
            zoom: 12,
            // Vector Map ID (registered via the Map Management API) by default. The
            // raster path (no mapId) exists because the vector style-set fetch from
            // gstatic has been observed 503ing in prod, which stalls the vector
            // renderer at renderingType UNINITIALIZED — raster has no style-set
            // dependency and deck falls back to its 2D overlay, which renders fine.
            ...(useVector ? { mapId: "4fac924d524ce2379b755fba" } : {}),
            disableDefaultUI: true,
            zoomControl: true,
          });
          const ready = await new Promise<boolean>((resolve) => {
            let settled = false;
            const done = (ok: boolean, why: string) => {
              if (settled) return;
              settled = true;
              console.log(`[Heatmap] attempt ${attempt}: ${why}`);
              resolve(ok);
            };
            map.addListener("idle", () => done(true, "idle fired"));
            map.addListener("tilesloaded", () => done(true, "tilesloaded fired"));
            let visibleMs = 0; // only VISIBLE time counts — a hidden tab makes no progress
            const poll = () => {
              if (settled) return;
              const gm = inner.querySelector<HTMLElement>(".gm-style");
              if (gm && gm.clientWidth > 0) return done(true, "gm-style present");
              if (document.visibilityState === "visible") visibleMs += 400;
              if (visibleMs > 7000) return done(false, "watchdog timeout — no map after 7s visible");
              setTimeout(poll, 400);
            };
            poll();
          });
          if (!ready) { inner.replaceChildren(); return null; }
          return map;
        };

        // RASTER-FIRST (10 Jul): the registered vector Map ID's style-set fetch from
        // gstatic 503s on 100% of loads (verified over 5 consecutive reloads), which
        // permanently stalls the vector renderer at renderingType UNINITIALIZED and
        // desyncs the deck overlay's projection. Raster has no style-set dependency
        // and the overlay's 2D path renders correctly. Vector stays available via
        // buildOnce(n, true) once the Map ID's style association is fixed in the
        // Cloud console — do NOT re-enable before re-testing that fetch.
        let map = await buildOnce(1, false);
        if (!alive) return;
        if (!map) map = await buildOnce(2, false);
        if (!alive) return;
        if (!map) { setLoadError(true); return; }

        // Bug fix (diagnosed from prod console: "overlay attached; renderingType:
        // UNINITIALIZED"): deck's GoogleMapsOverlay chooses its raster-vs-vector
        // rendering path from map.getRenderingType() AT setMap() time. 'idle' can
        // fire while renderingType is still UNINITIALIZED — attaching then binds a
        // stale projection: heat dots spread over the whole panel, desynced from
        // tiles, and never track pan/zoom. Wait for renderingtype_changed (with a
        // visible-time cap) before attaching.
        const rtOf = (m: google.maps.Map) => m.getRenderingType?.() ?? "UNKNOWN";
        const waitRenderingType = (m: google.maps.Map) =>
          new Promise<boolean>((resolve) => {
            if (rtOf(m) !== "UNINITIALIZED") return resolve(true);
            let settled = false;
            const done = (ok: boolean, why: string) => {
              if (settled) return;
              settled = true;
              console.log(`[Heatmap] renderingType wait: ${why} (now ${rtOf(m)})`);
              resolve(ok);
            };
            m.addListener("renderingtype_changed", () => done(true, "renderingtype_changed"));
            let visibleMs = 0;
            const poll = () => {
              if (settled) return;
              if (rtOf(m) !== "UNINITIALIZED") return done(true, "polled ready");
              if (document.visibilityState === "visible") visibleMs += 300;
              if (visibleMs > 6000) return done(false, "vector renderer stalled (style-set fetch?)");
              setTimeout(poll, 300);
            };
            poll();
          });

        let rtReady = await waitRenderingType(map);
        if (!alive) return;
        if (!rtReady) {
          // Vector pipeline never initialized (observed cause: gstatic FetchableStyleSet
          // 503 for the Map ID's style). Rebuild WITHOUT the mapId — plain raster has no
          // style-set dependency, and the overlay renders via its 2D path.
          console.log("[Heatmap] falling back to raster map (no mapId)");
          map = await buildOnce(3, false);
          if (!map) { setLoadError(true); return; }
          rtReady = await waitRenderingType(map);
          if (!rtReady) { setLoadError(true); return; }
        }

        // Overlay attaches only now — base map initialized AND renderingType known.
        overlayRef.current = new GoogleMapsOverlay({ layers: [] });
        overlayRef.current.setMap(map);
        console.log("[Heatmap] overlay attached; renderingType:", rtOf(map));

        // Belt-and-suspenders: on later panel resizes tell the map and re-center.
        const ro = new ResizeObserver(() => {
          (window as any).google?.maps?.event?.trigger(map, 'resize');
          map!.setCenter(center);
        });
        ro.observe(mapRef.current);
        resizeObsRef.current = ro;
        setMapInstance(map);
      } catch (err) {
        console.error("Map load error", err);
        setLoadError(true);
      }
    };

    initMap();

    return () => {
      alive = false;
      console.log(`[Heatmap] unmount #${mountId}`);
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      overlayRef.current?.setMap(null);
      overlayRef.current?.finalize();
      overlayRef.current = null;
    };
  }, [retryNonce]);

  useEffect(() => {
    if (mapInstance && overlayRef.current) {
      try {
        // Bug fix: google.maps.visualization.HeatmapLayer was fully removed
        // from the Maps JS API (v3.65+, May 2026). Google's recommended
        // replacement is deck.gl's HeatmapLayer via GoogleMapsOverlay — but
        // its GPU aggregation pass (the weightsTexture render-to-texture
        // step) produces an all-zero result on this box's WebGL2/ANGLE/D3D11
        // stack (confirmed live: real per-point weights are correctly bound
        // as vertex attributes, yet the aggregated max-weight readback comes
        // back [0,0], and deck.gl v9.3.6 additionally throws a shader-compile
        // error, "weightsTexture not set: Not found in shader layout", on the
        // same code path — a currently-unfixed upstream bug, fix targeted for
        // v9.4 per visgl/deck.gl#10300/#10301, not yet released). Rather than
        // depend on that aggregation pipeline, render real density directly
        // with ScatterplotLayer: additive-blended, weight-sized/weight-colored
        // circles that visually glow brighter where reports overlap — a
        // genuine live heat visualization, not a fallback, without needing
        // GPU aggregation at all.
        // Weight cap: a single freak bucket (seen live: one 22-weight point vs a
        // 1.28 average) must not become the scale ceiling that flattens every other
        // hotspot AND paints a giant blob bleeding over water/airport terrain.
        const cap = 10;
        const w = (x: number) => Math.min(x, cap);
        const maxWeight = Math.max(1, ...points.map(p => w(p.weight)));
        const layer = new ScatterplotLayer({
          id: 'jannaadi-heatmap',
          data: points,
          getPosition: (p: { lat: number; lng: number }) => [p.lng, p.lat],
          getRadius: (p: { weight: number }) => 90 + (w(p.weight) / maxWeight) * 260, // tighter blur: stays on streets, off the bay
          getFillColor: (p: { weight: number }) => {
            const [r, g, b] = heatColor(w(p.weight) / maxWeight);
            return [r, g, b, 80];
          },
          radiusUnits: 'meters',
          radiusMinPixels: 6,
          radiusMaxPixels: 42,
          stroked: false,
          pickable: false,
          parameters: {
            // Additive blending: overlapping circles brighten instead of
            // occluding each other, producing the classic "hot spot" glow.
            blend: true,
            blendFunc: [770 /* SRC_ALPHA */, 1 /* ONE */],
            blendEquation: 32774 /* FUNC_ADD */,
            depthTest: false,
          },
          updateTriggers: {
            getRadius: maxWeight,
            getFillColor: maxWeight,
          },
        });
        overlayRef.current.setProps({ layers: [layer] });
        console.log(`[Heatmap] layer updated with ${points.length} points`);

        // Re-fit the viewport to the (filtered) data: selecting a ward previously
        // left the camera wherever it was, so the filtered dots rendered off-screen
        // and the heatmap "vanished". Skip when empty (keep current view).
        const g = (window as any).google;
        if (points.length && g?.maps?.LatLngBounds) {
          const bounds = new g.maps.LatLngBounds();
          for (const p of points) bounds.extend({ lat: p.lat, lng: p.lng });
          if (points.length === 1) {
            mapInstance.setCenter({ lat: points[0].lat, lng: points[0].lng });
            mapInstance.setZoom(14);
          } else {
            mapInstance.fitBounds(bounds, 48);
            // fitBounds on a tight cluster can over-zoom into one street — clamp.
            g.maps.event.addListenerOnce(mapInstance, 'idle', () => {
              const z = mapInstance.getZoom();
              if (z != null && z > 15) mapInstance.setZoom(15);
            });
          }
        }
      } catch (err) {
        console.error("deck.gl heat layer render failed", err);
        setLoadError(true);
      }
    }
  }, [points, mapInstance]);

  if (loadError) {
    return (
      <div style={{ width: '100%', height: '100%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--border-radius-md)', position: 'relative', overflow: 'hidden' }}>
        {/* Static Fallback for F8 */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(232, 135, 30, 0.4) 0%, transparent 60%)', opacity: 0.5 }}></div>
        <div style={{ textAlign: 'center', zIndex: 1, padding: 'var(--spacing-md)' }}>
          <h3 style={{ margin: 0, color: 'var(--color-text-muted)' }}>Live map paused</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '6px 0 12px' }}>
            The map couldn't finish loading — this usually happens when the tab was in the
            background while opening. Static hotspot overview shown instead.
          </p>
          <button
            onClick={() => { setLoadError(false); setMapInstance(null); setRetryNonce((n) => n + 1); }}
            style={{
              padding: '8px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
              backgroundColor: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: '0.9rem',
            }}
          >
            ↻ Retry live map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 'var(--border-radius-md)' }} />
  );
};

export default Heatmap;
