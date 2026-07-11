# DECK.md — JanNaadi pitch skeleton
10 slides. Every slide earns judging points; weights shown per slide.
Palette: deep teal #0F5257 base, sand #F4EDE4 background, saffron #E8871E data highlights, red #C0392B dead-letters only. Same as app — deck and product read as one system.

---

## 1. Title
- JanNaadi — the constituency's pulse, read daily
- Track 1: People's Priorities | Team | Visakhapatnam
- One hero screenshot: heatmap with Gajuwaka hotspot

## 2. The problem, grounded (Fit 20%)
- MP offices drown in unstructured input: meetings, letters, WhatsApp, portals — no consolidation
- Real stakes: acting on the loudest voice, not the widest need
- One line on Vizag: 98 GVMC wards, 3 languages, paper-first grievance flow

## 3. What we built (Fit 20% + AI 25%)
- Citizen: voice/text/photo in Telugu, Hindi, English, code-mixed — 30 seconds to submit
- AI pipeline: STT → Gemini extraction → dedup clustering → explainable ranking
- MP office: ranked priorities, demand heatmap, drill-down to every citizen voice
- Architecture diagram, one screen

## 4. AI doing real work (AI 25%)
- Enum-constrained Gemini extraction — model cannot invent wards or categories
- pgvector clustering finds demand concentration humans miss across languages
- Metric slide: extraction accuracy on 800 multilingual synthetic inputs (from replay QA diff)
- Multimodal fallback: low-confidence audio → Gemini direct

## 5. USP — defensible AI (AI 25% + Presentation 5%)
- Every ranking auditable: click any priority → the score math + the citizen voices behind it
- Every failure visible: dead-letter view — "silent failure is a lost citizen voice"
- Weights tunable by the MP office, no engineering needed
- Demo beat: score_breakdown panel screenshot

## 6. Live demo (all)
- Golden path, 3 min: Telugu voice → ranked → explanation panel → heatmap → dead-letters
- Fallback ladder ready per DEMO.md

## 7. Inclusivity by design (Inclusivity 15%)
- Telugu-first, Tenglish/Hinglish handled (show G13 input on slide)
- Voice for low-literacy; photo for low-articulation
- Roadmap: WhatsApp Business API + IVR missed-call intake for zero-smartphone citizens

## 8. Pilot in 4 weeks (Deployability 25%)
- Week 1: ward list + MP office onboarding, weight calibration workshop
- Week 2: soft launch, 2 wards, MP office social channels
- Week 3–4: full constituency, weekly priority report cadence
- Cost at pilot scale: Cloud Run scale-to-zero + Cloud SQL ≈ ₹X/month (compute from actual usage)
- Operator credibility line: we run frontline field ops in Vizag today — grievance intake is our daily reality

## 9. Scale path (Deployability 25%)
- Same Postgres wire: Cloud SQL → AlloyDB at >100K submissions, zero code change
- Multi-constituency: ward table + weights per tenant — architecture already isolates config from code
- Data integration: PGRS/grievance portal ingest, data.gov.in demographic joins

## 10. Ask
- Pilot: Visakhapatnam constituency, 4-week scope
- Team + contact
- Repo + deployed URL on-slide

---
Build notes:
- Slides 4–5 are the differentiation; rehearse those transitions hardest
- Every metric on slides must come from replay/golden runs — no invented numbers
- Export screenshots from deployed URL only
