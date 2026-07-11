# Frontend Acceptance Criteria
Owner: Antigravity. Evidence: screenshot/recording artifacts per item, paths in frontend-status.json.

## Citizen submit flow
- [ ] F1: Mobile viewport (390px): text, voice-record, voice-upload, photo submission all functional
- [ ] F2: Language toggle te/hi/en changes all UI strings (i18n file, not hardcoded)
- [ ] F3: Voice upload path works with pre-recorded .wav (demo insurance — mic optional)
- [ ] F4: Submission → confirmation with submission_id, status polling until processed (DEMO_MODE)

## MP dashboard
- [ ] F5: Ranked list renders from /api/rank, filters (ward/category/lang) work
- [ ] F6: Ranking-explanation panel: click item → score_breakdown visualized with weights (USP surface)
- [ ] F7: Heatmap renders 800 points, category filter, Gajuwaka hotspot visually obvious
- [ ] F8: Heatmap API failure → static fallback image, no blank screen
- [ ] F9: Audit trail view: submission detail shows full stage history
- [ ] F10: Dead-letter admin page renders /api/deadletters (USP surface)
- [ ] F11: Dashboard loads < 2s on deployed URL (not localhost)

## Design
- [ ] F12: Palette — civic trust, not startup default. Deep teal primary (#0F5257 range), warm sand neutrals, saffron accent (#E8871E range) for rank/severity signals, red reserved for dead-letters only. No default Tailwind blue/indigo. Verify contrast AA on mobile
- [ ] F13: Non-technical legibility: MP dashboard understandable without explanation (5-min test on one non-tech person)

Cached-response fallback UI (>5s Gemini timeout) styled identically to live; "cached" badge subtle.

## T3 addition (contract-v1.1)
- [ ] F14: "In dev plan" badge (saffron) on ranked items with plan_match; snippet on tap
