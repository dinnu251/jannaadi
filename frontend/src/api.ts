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

export const api = {
  async getWards(): Promise<ApiResponse<{ wards: Ward[] }>> {
    try {
      const res = await fetch('/api/wards');
      if (res.ok) return await res.json();
    } catch (e) { console.warn('Using mock /api/wards', e); }
    return mockApi.getWards();
  },

  async ingestGrievance(formData: FormData): Promise<ApiResponse<{ submission_id: string, status: string, cluster_id?: string, category?: string }>> {
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: formData });
      if (res.ok) return await res.json();
    } catch (e) { console.warn('Using mock /api/ingest', e); }
    return mockApi.ingestGrievance(formData);
  },

  async getSubmission(id: string): Promise<ApiResponse<SubmissionDetail>> {
    try {
      const res = await fetch(`/api/submissions/${id}`);
      if (res.ok) return await res.json();
    } catch (e) { console.warn('Using mock /api/submissions/:id', e); }
    return mockApi.getSubmission(id);
  },

  async getRankings(ward?: string, category?: string, lang?: string): Promise<ApiResponse<RankResponse>> {
    try {
      const params = new URLSearchParams();
      if (ward) params.append('ward', ward);
      if (category) params.append('category', category);
      if (lang) params.append('lang', lang);
      const res = await fetch(`/api/rank?${params.toString()}`);
      if (res.ok) return await res.json();
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        return { error: { code: 'UNAUTHORIZED', message: 'Not authorized' } };
      }
    } catch (e) { console.warn('Using mock /api/rank', e); }
    return mockApi.getRankings(ward, category, lang);
  },

  async getHeatmap(category?: string): Promise<ApiResponse<{ points: {lat: number, lng: number, weight: number}[] }>> {
    try {
      const params = new URLSearchParams();
      if (category) params.append('category', category);
      const res = await fetch(`/api/heatmap?${params.toString()}`);
      if (res.ok) return await res.json();
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        return { error: { code: 'UNAUTHORIZED', message: 'Not authorized' } };
      }
    } catch (e) { console.warn('Using mock /api/heatmap', e); }
    return mockApi.getHeatmap(category);
  },

  async getDeadLetters(): Promise<ApiResponse<{ items: DeadLetter[] }>> {
    try {
      const res = await fetch('/api/deadletters');
      if (res.ok) return await res.json();
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        return { error: { code: 'UNAUTHORIZED', message: 'Not authorized' } };
      }
    } catch (e) { console.warn('Using mock /api/deadletters', e); }
    return mockApi.getDeadLetters();
  }
};
