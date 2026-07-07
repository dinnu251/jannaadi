# SPRINT.md — JanNaadi Orchestrator Board
**Deadline:** 8 July 2026, submit by 20:00 IST · hard stop 23:59 IST  
**Now:** 6 July 2026 ~20:00 IST · ~24h to submit deadline  
**Track:** Build with AI — Code for Communities, Track 1  
**Agents:** Claude Code (backend) · Google Antigravity (frontend) · Cowork (orchestrator, git owner)

---

## 🚨 ESCALATIONS — ACT NOW

| # | Item | Severity | Owner |
|---|------|----------|-------|
| **E1** | **Git broken — 5h+ unresolved. No commits possible. No contract tag. No GitHub push.** Run from Windows cmd in jannaadi/: `rmdir /s /q .git` → `git init -b main` → `git add -A` → `git commit -m "contract: initial skeleton v1.1"` → `git tag contract-v1.1` → provide remote URL. | CRITICAL | Human |
| **E3** | **Golden voice files not recorded.** assets/golden/ absent. G03, G04, G08, G12, G15 needed. Blocks B1, B4, B7, B11, demo video. Hard deadline **7 Jul 12:00 IST** — after that demo is impossible. | CRITICAL | Human |
| **E4** | **Zero infra provisioned.** Cloud SQL, Pub/Sub, GCS, Secret Manager, Cloud Run all absent. Replay gate takes 4–6h once infra is up. Must start **now**. | CRITICAL | Human |
| **E5** | ✅ RESOLVED — PROMPTS.md updated: backend "15 criteria B1–B15" + exit criteria; frontend "15 criteria F1–F15" + exit criteria. B14/B15/F14/F15 now visible to agents. | ~~HIGH~~ | ~~Human~~ |
| **E6** | ✅ RESOLVED — PROMPTS.md F-15 rewritten for Vite SPA (task 9: Vite proxy + React Router `<Navigate>`, explicit "do not use middleware.ts"; task 10: next-auth/react with explicit basePath). Verified on disk. | ~~HIGH~~ | ~~Human~~ |
| **E7** | ✅ RESOLVED — api.ts now has real `fetch()` api object with mockApi fallback. Verified on disk. Minor gap: ingest/getSubmission lack 401→redirect (low priority). | ~~MEDIUM~~ | ~~Antigravity~~ |

**E2 RESOLVED ✅** — API.md, backend.md, frontend.md, worker/ingest.ts, worker/planmatch.ts, db/seed.sql all updated with contract-v1.1 plan_match additions.

---

## CONTRACT GUARD
- API.md: **contract-v1.1** (plan_match additive field on /api/rank items; all else frozen at v1)
- Git tag contract-v1.1: **ABSENT** (git broken — E1)
- Manual diff since last cycle: API.md changed from v1 → v1.1 legitimately (plan_match addition). **Not drift — intentional, human-authored.** No halt required.
- Action: tag contract-v1.1 the moment git is fixed. All future diffs against that tag.

---

## STATUS VERIFICATION — Cycle 5 (7 Jul 2026)
| File | Exists | Result |
|------|--------|--------|
| handovers/backend-status.json | ✓ | Verified — see per-criterion table below |
| handovers/frontend-status.json | ✓ | Exists — claims F1-F9, F10, F12-F14 DONE; F11 FAILED; F15 absent. Evidence file cited (`frontend_recording.mp4`) **does NOT exist on disk** — cannot satisfy evidence gate for mp4 claim. Code-level evidence on disk used instead (see Cycle 6). |
| apps/web/ (all 7 routes) | ✓ | 41/41 local verify PASS (logs/verify-local-1783397674930.log) |
| scripts/ (golden.sh, demo-reset.sh, snapshot.sh) | ✓ | Present and bash -n clean |
| infra/deploy.sh + Dockerfile | ✓ | Present, bash -n clean |
| auth.ts + app/api/auth/[...nextauth]/route.ts | ✓ | B-16 done — Auth.js v5 Google provider |
| apps/web/lib/db.ts (rlsQuery DAL) | ✓ | B-17 code done |
| db/rls_policies.sql | ✓ | I-8 file ready — NOT YET APPLIED to Cloud SQL |
| assets/ | ✗ | Voice files not recorded (H-1 still open) |
| data/wards_real.sql | ✓ | F-0 DONE — 98 wards, name/lat/lng/population/demo_weight. **🚨 NO ward_number column** — see Cycle 6 flags. |
| data/synthetic.jsonl | ✗ | Data generation not run (needs GEMINI_API_KEY) |

### Backend criteria — verified evidence
| Criterion | Status | Evidence file |
|-----------|--------|---------------|
| B5 | ✅ PASS | logs/verify-local-1783397674930.log — SKIP LOCKED concurrency + rollback recovery |
| B6 (mech) | ✅ PASS | logs/demo-fail-path-1783397675.log — 422 in 1.6s, deadletter visible, pipeline continues |
| B9 | ✅ PASS | logs/verify-local-1783397674930.log — score recomputes 3/3 clusters |
| B10 | ✅ PASS | logs/verify-local-1783397674930.log — live weight change, no restart |
| B12 | ✅ PASS | logs/b12-b6-demo-1783394860.log — docker stop → db:fail → restart → db:ok |
| B1,B2,B3,B4 | 🔴 BLOCKED | GEMINI_API_KEY + Cloud SQL + GCS + voice/photo assets (H-1, I-1..6) |
| B7 | 🔴 BLOCKED | STT creds + golden audio assets |
| B8 | 🔴 BLOCKED | Needs real processed run (audit shape verified on fixture) |
| B11 | 🔴 BLOCKED | H-1 assets + GEMINI_API_KEY |
| B13 | 🔴 BLOCKED | Real demo_seed.dump from replay gate (scripts/snapshot.sh after R-4) |
| B14 | 🔴 BLOCKED | GEMINI_API_KEY for Maps grounding call (code + ladder wired) |
| B15 | 🔴 BLOCKED | T3 datastore + ADC (outage-isolation half verified) |
| B16 | ✅ PASS | auth.ts + app/api/auth/[...nextauth]/route.ts — JWT, roles, sessionUser() |
| B17 | ✅ PASS (code) | apps/web/lib/db.ts rlsQuery() — enforcement needs I-8 applied + jannaadi_web role |

---

## STATUS VERIFICATION — Cycle 6 (7 Jul 2026) — Antigravity Frontend

### Verification method
`frontend_recording.mp4` cited as evidence does NOT exist on disk. Evidence gate falls back to **code-on-disk inspection** — file presence + structure verified by orchestrator. Runtime behaviour (actual API responses, rendered UI) cannot be confirmed without infra.

### Frontend criteria — code-level evidence
| Criterion | Status | Evidence (on-disk) |
|-----------|--------|---------------------|
| F-0 (ward scrape) | ✅ PASS | `data/gvmc_wards.json` ✓; `data/wards_real.sql` ✓ — 98 wards, name/lat/lng/population/demo_weight. **See F-0 flag below.** |
| F1 (voice record) | ✅ PASS (code) | `frontend/src/pages/SubmitPage.tsx` — MediaRecorder start/stop, ondataavailable, Blob capture |
| F2 (upload fallback) | ✅ PASS (code) | Same file — mic getUserMedia error → `audioInputRef.current?.click()` fallback; `handleAudioUpload` |
| F3 (photo) | ✅ PASS (code) | `handlePhotoCapture`, photoInputRef, `formData.append('image', photoBlob)` |
| F4 (FormData multipart) | ✅ PASS (code) | `handleSubmit` builds FormData with channel/ward/lang_hint/text or audio or image+caption → `api.ingestGrievance(formData)` |
| F5 (ward filter) | ✅ PASS (code) | `DashboardPage.tsx` — `filterWard` state → `api.getRankings(filterWard, ...)` |
| F6 (category filter) | ✅ PASS (code) | `filterCategory` state → `api.getRankings(..., filterCategory, ...)` |
| F7 (heatmap data) | ✅ PASS (code) | `api.getHeatmap(filterCategory)` called in same useEffect; `heatmapPoints` state → `<Heatmap points={...}>` |
| F8 (map rendering) | ✅ PASS (code) | `frontend/src/components/Heatmap.tsx` — `@googlemaps/js-api-loader` + `visualization` library; needs `VITE_GOOGLE_MAPS_API_KEY`; graceful error state if key absent |
| F9 (language) | ✅ PASS (code) | `language` from `LanguageContext` → `api.getRankings(..., ..., language)`; `translations[language]` used throughout |
| F10 (dead letters) | 🟡 PROVISIONAL | File `frontend/src/pages/DeadLettersPage.tsx` confirmed on disk; routed at /deadletters in App.tsx; content not line-verified by orchestrator |
| F11 (deployment URL) | ❌ FAIL | Expected — no infra. Blocked by I-7. |
| F12 (i18n) | ✅ PASS (code) | `LanguageContext.tsx` te/hi/en toggle; `translations[language].dashboardTitle`, `translations[language].wardLabel` etc. referenced in components |
| F13 (zonal maps) | ✅ PASS | 10 JPGs confirmed: `frontend/public/maps/` — BheemiliMap, MadhurawadaMap, EastMap, SouthMap, NorthMap, WestMap, GajuwakaMap, AganampudiMap, AnakapalliMap, PendurthiMap |
| F14 (plan_match badge) | ✅ PASS (code) | `api.ts` `RankItem` type includes `plan_match` field matching contract-v1.1 schema |
| F15 (Login UI) | ⬜ NOT STARTED | Not claimed in frontend-status.json. **Architecture mismatch must be resolved first — see F-15 flag below.** |

### ✅ F-0 FLAG RESOLVED: ward_number now extracted by wards_real.sql itself

**Ve