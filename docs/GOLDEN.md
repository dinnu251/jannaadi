# Golden Test Set — AI Layer Gate
15 fixed inputs, expected outputs pinned. Run before: video recording, virtual pitch, Delhi demo. 15/15 or no demo.

Model pinned: gemini-2.5-flash-002 (or exact available version — never "latest").

| ID | Lang | Channel | Input sketch | Expected category | Expected ward | Severity range |
|---|---|---|---|---|---|---|
| G01 | te | text | Drainage overflow complaint, Gajuwaka | drainage | Gajuwaka | 4–5 |
| G02 | te | text | Street light dead 2 weeks, MVP Colony | streetlights | MVP Colony | 2–3 |
| G03 | te | voice | Water supply 1hr/day, Madhurawada | water | Madhurawada | 3–4 |
| G04 | te | voice | PHC no doctor, Pendurthi | health | Pendurthi | 4–5 |
| G05 | te | photo+caption | Garbage pile photo, Akkayyapalem | garbage | Akkayyapalem | 3–4 |
| G06 | hi | text | Road potholes school route, Seethammadhara | roads | Seethammadhara | 3–4 |
| G07 | hi | text | School building repair, Gopalapatnam | education | Gopalapatnam | 3–4 |
| G08 | hi | voice | Drainage smell, Kancharapalem | drainage | Kancharapalem | 3–4 |
| G09 | hi | photo+caption | Broken road photo, Maddilapalem | roads | Maddilapalem | 2–3 |
| G10 | en | text | Water tanker irregular, Rushikonda | water | Rushikonda | 3–4 |
| G11 | en | text | Streetlight cluster out, Beach Road area | streetlights | (ward per seed) | 2–3 |
| G12 | en | voice | Clinic medicine stock-out | health | (ward per seed) | 4–5 |
| G13 | te-en mix | text | "Manchi neellu raavatledu sir, 3 days nunchi" style | water | (stated) | 3–4 |
| G14 | te-en mix | text | "Road lo pedda gunta undi, accident aiyye chance" | roads | (stated) | 4–5 |
| G15 | hi-en mix | voice | "Nala overflow ho raha hai, bacche school nahi ja pa rahe" | drainage | (stated) | 4–5 |

Pass rule per item: category exact match, ward exact match, severity within range, summary_en non-empty, valid JSON first attempt or single retry.

Audio files: record once, commit to repo (assets/golden/). Prompt few-shot must include one code-mixed example per language pair.

./scripts/golden.sh → runs all 15 via /api/ingest (DEMO_MODE) → diff against expected → exit 0/1. Wired into pre-demo checklist.
