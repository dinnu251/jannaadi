# Golden Test Set — AI Layer Gate
15 fixed inputs, expected outputs pinned. Run before: video recording, virtual pitch, Delhi demo. 15/15 or no demo.

Model pinned: gemini-2.5-flash-002 (or exact available version — never "latest").

Ward names updated 8 Jul to the official GVMC 98-ward list (see data/wards_clean.json;
decision: real wards replace the 12 placeholders). scripts/golden-set.json is the
executable source of truth for inputs/expectations.

| ID | Lang | Channel | Input sketch | Expected category | Expected ward | Severity range |
|---|---|---|---|---|---|---|
| G01 | te | text | Drainage overflow complaint, Pedagantyada (Gajuwaka area) | drainage | Ward 75 - Pedagantyada | 4–5 |
| G02 | te | text | Street light dead 2 weeks, MVP Sector 12 | streetlights | Ward 19 - MVP Sector-12 | 2–3 |
| G03 | te | voice | Water supply 1hr/day, Madhura Nagar | water | Ward 25 - Madhura Nagar | 3–4 |
| G04 | te | voice | PHC no doctor, Pendurthi | health | Ward 96 - Pendurthi old Village | 4–5 |
| G05 | te | photo+caption | Garbage pile photo, Akkayyapalem | garbage | Ward 43 - Akkayyapalem 80 Feet road | 3–4 |
| G06 | hi | text | Road potholes school route, Seethammadhara | roads | Ward 15 - Seethammadhara Junction | 3–4 |
| G07 | hi | text | School building repair, Bheem Nagar | education | Ward 31 - Bheem Nagar | 3–4 |
| G08 | hi | voice | Drainage smell, Nehru Nagar | drainage | Ward 74 - Nehru Nagar | 3–4 |
| G09 | hi | photo+caption | Broken road photo, Madhusudhan Nagar | roads | Ward 46 - Madhusudhan Nagar | 2–3 |
| G10 | en | text | Water tanker irregular, Bunglow Metta | water | Ward 1 - Bunglow Metta | 3–4 |
| G11 | en | text | Streetlight cluster out, Beach Road area | streetlights | (nearest ward ≤4km of RK Beach, maps_grounding — accept-list in golden-set.json) | 2–3 |
| G12 | en | voice | Clinic medicine stock-out, NRI Hospital area | health | Ward 14 - Near N R I Hospital | 4–5 |
| G13 | te-en mix | text | "Manchi neellu raavatledu sir, 3 days nunchi" style | water | Ward 25 - Madhura Nagar | 3–4 |
| G14 | te-en mix | text | "Road lo pedda gunta undi, accident aiyye chance" | roads | Ward 19 - MVP Sector-12 | 4–5 |
| G15 | hi-en mix | voice | "Nala overflow ho raha hai, bacche school nahi ja pa rahe" | drainage | Ward 47 - Ambedkar Nagar | 4–5 |

Pass rule per item: category exact match, ward exact match, severity within range, summary_en non-empty, valid JSON first attempt or single retry.

Audio files: record once, commit to repo (assets/golden/). Prompt few-shot must include one code-mixed example per language pair.

./scripts/golden.sh → runs all 15 via /api/ingest (DEMO_MODE) → diff against expected → exit 0/1. Wired into pre-demo checklist.
