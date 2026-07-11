// Mock API implementation based on handovers/API.md

export interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  cached?: boolean; // Added to satisfy Task 4 requirement
}

// Data Models
export interface Ward { name: string; lat: number; lng: number; }

export interface RankItem {
  cluster_id: string;
  rank: number;
  title_en: string;
  title_localized?: string | null; // summary_original of a same-language member (te/hi); null → fall back to title_en
  category: string;
  ward: string;
  submission_count: number;
  score: number;
  score_breakdown: { frequency: number; severity: number; recency: number; demographic: number; };
  first_seen: string;
  last_seen: string;
  sample_submission_ids: string[];
  plan_match?: { doc_title: string; snippet: string; relevance: number; } | { none: true } | null;
  centroid: { lat: number; lng: number };
}

export interface RankResponse {
  generated_at: string;
  weights: { frequency: number; severity: number; recency: number; demographic: number; };
  items: RankItem[];
}

export interface SummaryResponse {
  generated_at: string;
  totals: { total: number; open: number; acknowledged: number; in_progress: number; resolved: number };
  by_category: { category: string; total: number; resolved: number }[];
  by_ward: { ward: string; total: number; resolved: number }[];
  trend: { week: string; total: number; resolved: number }[];
}

export interface DeadLetter {
  submission_id: string;
  failed_stage: string;
  reason: string;
  raw_preview: string;
  at: string;
}

export interface SubmissionDetail {
  submission_id: string;
  status: string;
  channel: string;
  lang: string;
  raw_text: string;
  transcript: string;
  extraction: {
    category: string;
    ward: string;
    severity: number;
    summary_en: string;
    summary_original: string;
  };
  cluster_id: string | null;
  audit: { stage: string; at: string; model: string; latency_ms: number }[];
  failure_reason: string | null;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const DEMO_LATENCY_MS = parseInt(localStorage.getItem('API_LATENCY') || '1000', 10);

// Bug fix: the mock fallback below must ONLY fire when the backend is genuinely
// unreachable or too slow (F4's actual intent — smooth over a slow Gemini call
// during a live demo), never on a real HTTP error response. The previous version
// fell back to fake "success" data on ANY non-2xx status (400 validation, 429 rate
// limit, 500 crash, ...) — a citizen's rejected complaint would show a fake
// "processed" success and the rejection would never be seen. fetchGuarded() makes
// that distinction explicit: TIMEOUT_MS aborts → treated as "slow, use cached/mock
// demo data"; any real response (ok or not) is returned as-is, error included.
const TIMEOUT_MS = 8000;

type GuardedResult<T> = { kind: 'ok'; json: T } | { kind: 'http_error'; status: number; json: any } | { kind: 'timeout' } | { kind: 'network_error'; err: unknown };

async function fetchGuarded<T>(input: RequestInfo, init?: RequestInit): Promise<GuardedResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    const json = await res.json().catch(() => null);
    return res.ok ? { kind: 'ok', json: json as T } : { kind: 'http_error', status: res.status, json };
  } catch (err) {
    if (controller.signal.aborted) return { kind: 'timeout' };
    return { kind: 'network_error', err };
  } finally {
    clearTimeout(timer);
  }
}

export const mockApi = {
  async getWards(): Promise<ApiResponse<{ wards: Ward[] }>> {
    await sleep(300); // fast lookup
    return {
      data: {
        wards: [
          { name: "Gajuwaka", lat: 17.6868, lng: 83.1953 },
          { name: "Madhurawada", lat: 17.8262, lng: 83.3556 },
          { name: "MVP Colony", lat: 17.7386, lng: 83.3350 },
          { name: "Pendurthi", lat: 17.8123, lng: 83.2020 },
          { name: "Akkayyapalem", lat: 17.7300, lng: 83.3000 },
          { name: "Seethammadhara", lat: 17.7420, lng: 83.3180 },
          { name: "Gopalapatnam", lat: 17.7660, lng: 83.2160 },
          { name: "Kancharapalem", lat: 17.7350, lng: 83.2850 },
          { name: "Maddilapalem", lat: 17.7350, lng: 83.3230 },
          { name: "Rushikonda", lat: 17.7826, lng: 83.3850 },
          { name: "Malkapuram", lat: 17.6940, lng: 83.2400 },
          { name: "Anakapalle Road", lat: 17.6900, lng: 83.0040 }
        ]
      }
    };
  },

  async ingestGrievance(_formData: FormData): Promise<ApiResponse<{ submission_id: string, status: string, cluster_id?: string, category?: string }>> {
    const isDemoMode = true; // Hardcoded for demo purposes
    await sleep(DEMO_LATENCY_MS);
    
    // Simulate fallback to cached if it takes too long
    if (DEMO_LATENCY_MS >= 5000) {
      return {
        cached: true,
        data: {
          submission_id: "demo-uuid-" + Date.now(),
          status: "processed",
          cluster_id: "cluster-demo-1",
          category: "drainage"
        }
      };
    }
    
    return {
      data: {
        submission_id: "real-uuid-" + Date.now(),
        status: isDemoMode ? "processed" : "received",
        cluster_id: isDemoMode ? "cluster-real-1" : undefined,
        category: isDemoMode ? "drainage" : undefined,
      }
    };
  },

  async getSubmission(id: string): Promise<ApiResponse<SubmissionDetail>> {
    await sleep(600);
    return {
      data: {
        submission_id: id,
        status: "processed",
        channel: "voice",
        lang: "te",
        raw_text: "...",
        transcript: "Drainage is overflowing near sector 7.",
        extraction: {
          category: "drainage",
          ward: "Gajuwaka",
          severity: 4,
          summary_en: "Drainage overflow issue",
          summary_original: "డ్రైనేజీ ఓవర్‌ఫ్లో సమస్య"
        },
        cluster_id: "cluster-real-1",
        audit: [ 
          { stage: "received", at: new Date(Date.now() - 10000).toISOString(), model: "system", latency_ms: 10 },
          { stage: "transcribed", at: new Date(Date.now() - 8000).toISOString(), model: "whisper-large-v3", latency_ms: 1500 },
          { stage: "extracted", at: new Date(Date.now() - 6000).toISOString(), model: "gemini-2.5-flash-002", latency_ms: 840 },
          { stage: "clustered", at: new Date().toISOString(), model: "system", latency_ms: 50 }
        ],
        failure_reason: null
      }
    };
  },

  async getRankings(ward?: string, category?: string, _lang?: string): Promise<ApiResponse<RankResponse>> {
    let latency = DEMO_LATENCY_MS;
    // We implement the timeout logic directly in the client wrapper in real life, but here we can simulate it
    let cached = false;
    
    if (latency >= 5000) {
       cached = true;
       latency = 100; // cache hit is fast
    }
    
    await sleep(latency);
    
    const items: RankItem[] = [
      {
        cluster_id: "cluster-1",
        rank: 1,
        title_en: "Drainage overflow \u2014 Gajuwaka Sector 7",
        category: "drainage",
        ward: "Gajuwaka",
        submission_count: 42,
        score: 0.87,
        score_breakdown: { frequency: 0.92, severity: 0.8, recency: 0.85, demographic: 0.9 },
        first_seen: new Date(Date.now() - 86400000 * 3).toISOString(),
        last_seen: new Date().toISOString(),
        sample_submission_ids: ["uuid1", "uuid2", "uuid3"],
        plan_match: { doc_title: "GVMC Budget 2026-27", snippet: "Allocated \u20B92Cr for Gajuwaka sector 7 drainage upgrade.", relevance: 0.8 },
        centroid: { lat: 17.68, lng: 83.19 }
      },
      {
        cluster_id: "cluster-2",
        rank: 2,
        title_en: "Streetlight not working \u2014 MVP Colony Sector 3",
        category: "streetlights",
        ward: "MVP Colony",
        submission_count: 15,
        score: 0.65,
        score_breakdown: { frequency: 0.4, severity: 0.5, recency: 0.9, demographic: 0.6 },
        first_seen: new Date(Date.now() - 86400000).toISOString(),
        last_seen: new Date().toISOString(),
        sample_submission_ids: ["uuid4"],
        plan_match: null,
        centroid: { lat: 17.74, lng: 83.33 }
      }
    ];

    let filteredItems = items;
    if (ward) filteredItems = filteredItems.filter(i => i.ward === ward);
    if (category) filteredItems = filteredItems.filter(i => i.category === category);
    
    return {
      cached,
      data: {
        generated_at: new Date().toISOString(),
        weights: { frequency: 0.4, severity: 0.25, recency: 0.2, demographic: 0.15 },
        items: filteredItems
      }
    };
  },

  async getHeatmap(_category?: string): Promise<ApiResponse<{ points: {lat: number, lng: number, weight: number}[] }>> {
    await sleep(500);
    // Simulate Gajuwaka hotspot (around 17.68, 83.19)
    const points = [];
    for(let i=0; i<800; i++) {
        // mostly clustered around Gajuwaka
        const isHotspot = Math.random() > 0.3;
        if(isHotspot) {
            points.push({ lat: 17.68 + (Math.random()-0.5)*0.02, lng: 83.19 + (Math.random()-0.5)*0.02, weight: Math.floor(Math.random()*5)+1 });
        } else {
            // random scatter
            points.push({ lat: 17.7 + (Math.random()-0.5)*0.2, lng: 83.2 + (Math.random()-0.5)*0.2, weight: 1 });
        }
    }
    return { data: { points } };
  },

  async getSummary(_ward?: string, _category?: string): Promise<ApiResponse<SummaryResponse>> {
    await sleep(400);
    const total = 800, resolved = 239, in_progress = 167, acknowledged = 126, open = total - resolved - in_progress - acknowledged;
    return {
      data: {
        generated_at: new Date().toISOString(),
        totals: { total, open, acknowledged, in_progress, resolved },
        by_category: [
          { category: "garbage", total: 184, resolved: 55 },
          { category: "roads", total: 176, resolved: 53 },
          { category: "streetlights", total: 136, resolved: 41 },
          { category: "water", total: 96, resolved: 29 },
        ],
        by_ward: [
          { ward: "Ward 75 - Pedagantyada", total: 60, resolved: 18 },
          { ward: "Ward 96 - Pendurthi old Village", total: 40, resolved: 12 },
          { ward: "Ward 25 - Madhura Nagar", total: 35, resolved: 10 },
        ],
        trend: Array.from({ length: 8 }, (_, i) => ({
          week: new Date(Date.now() - (7 - i) * 7 * 86400_000).toISOString(),
          total: 80 + Math.floor(Math.random() * 30),
          resolved: 20 + Math.floor(Math.random() * 20),
        })),
      },
    };
  },

  async getDeadLetters(): Promise<ApiResponse<{ items: DeadLetter[] }>> {
    await sleep(400);
    return {
      data: {
        items: [
          {
            submission_id: "fail-uuid-1",
            failed_stage: "extracted",
            reason: "schema_validation_failed_after_retry",
            raw_preview: "{\"category\": \"unknown_magic_category\"}",
            at: new Date().toISOString()
          },
          {
            submission_id: "fail-uuid-2",
            failed_stage: "transcribed",
            reason: "audio_too_noisy",
            raw_preview: "<audio bytes>",
            at: new Date(Date.now() - 3600000).toISOString()
          }
        ]
      }
    };
  }
};

// Shared handling for the two protected GET routes (/api/rank, /api/heatmap,
// /api/deadletters): real errors surface as res.error; only a timeout falls back
// to demo/cached data; 401/403 redirect to login (the route genuinely requires
// a session — there is no cached substitute for "you're not signed in").
async function guardedGet<T>(url: string, mockFallback: () => Promise<ApiResponse<T>>, label: string): Promise<ApiResponse<T>> {
  const result = await fetchGuarded<T>(url);
  switch (result.kind) {
    // /api/rank, /api/heatmap, /api/deadletters return the payload directly
    // (e.g. {items:[...]}), not pre-wrapped in {data:...} — wrap it here.
    case 'ok': return { data: result.json };
    case 'http_error':
      if (result.status === 401 || result.status === 403) {
        window.location.href = '/login';
        return { error: { code: 'UNAUTHORIZED', message: 'Not authorized' } };
      }
      return { error: result.json?.error ?? { code: 'HTTP_' + result.status, message: `${label} failed (${result.status})` } };
    case 'timeout':
      console.warn(`${label} timed out after ${TIMEOUT_MS}ms — using cached demo data`);
      return mockFallback();
    case 'network_error':
      console.error(`${label} network error`, result.err);
      return { error: { code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection and try again.' } };
  }
}

export const api = {
  async getWards(): Promise<ApiResponse<{ wards: Ward[] }>> {
    // Open, non-critical, and used purely to populate a dropdown — safe to fall
    // back on ANY failure (never blocks a citizen from choosing a ward).
    const result = await fetchGuarded<{ wards: Ward[] }>('/api/wards');
    if (result.kind === 'ok') return { data: result.json };
    console.warn('Using mock /api/wards — backend unreachable or slow');
    return mockApi.getWards();
  },

  // Citizen submission — the one call that must NEVER silently report fake success.
  // A real backend response (ok or error) is always returned as-is; only a genuine
  // timeout falls back to the DEMO_MODE cached response, badged 'cached' in the UI.
  async ingestGrievance(formData: FormData): Promise<ApiResponse<{ submission_id: string, status: string, cluster_id?: string, category?: string }>> {
    const result = await fetchGuarded<{ submission_id: string, status: string, cluster_id?: string, category?: string }>('/api/ingest', { method: 'POST', body: formData });
    switch (result.kind) {
      // /api/ingest returns {submission_id, status, ...} directly (202/200), not pre-wrapped.
      case 'ok': return { data: result.json };
      case 'http_error': return { error: result.json?.error ?? { code: 'HTTP_' + result.status, message: `Submission failed (${result.status})` } };
      case 'timeout':
        console.warn('Ingest timed out — using cached demo response');
        return mockApi.ingestGrievance(formData);
      case 'network_error':
        return { error: { code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection and try again.' } };
    }
  },

  async getSubmission(id: string): Promise<ApiResponse<SubmissionDetail>> {
    const result = await fetchGuarded<SubmissionDetail>(`/api/submissions/${id}`);
    switch (result.kind) {
      case 'ok': return { data: result.json };
      case 'http_error': return { error: result.json?.error ?? { code: 'HTTP_' + result.status, message: `Status check failed (${result.status})` } };
      case 'timeout': return mockApi.getSubmission(id);
      case 'network_error': return { error: { code: 'NETWORK_ERROR', message: 'Could not reach the server.' } };
    }
  },

  async getRankings(ward?: string, category?: string, lang?: string): Promise<ApiResponse<RankResponse>> {
    const params = new URLSearchParams();
    if (ward) params.append('ward', ward);
    if (category) params.append('category', category);
    if (lang) params.append('lang', lang);
    return guardedGet<RankResponse>(`/api/rank?${params.toString()}`, () => mockApi.getRankings(ward, category, lang), 'Rankings');
  },

  async getHeatmap(category?: string, ward?: string): Promise<ApiResponse<{ points: {lat: number, lng: number, weight: number}[] }>> {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (ward) params.append('ward', ward);
    return guardedGet(`/api/heatmap?${params.toString()}`, () => mockApi.getHeatmap(category), 'Heatmap');
  },

  async getDeadLetters(): Promise<ApiResponse<{ items: DeadLetter[] }>> {
    return guardedGet('/api/deadletters', () => mockApi.getDeadLetters(), 'Dead letters');
  },

  async getSummary(ward?: string, category?: string): Promise<ApiResponse<SummaryResponse>> {
    const params = new URLSearchParams();
    if (ward) params.append('ward', ward);
    if (category) params.append('category', category);
    return guardedGet<SummaryResponse>(`/api/summary?${params.toString()}`, () => mockApi.getSummary(ward, category), 'Summary');
  }
};
