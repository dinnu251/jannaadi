# Reviewer Task: Data Source and Integration Verification

## Objective
Verify the correctness, completeness, structure, and validity of the 4 Vizag-related source datasets generated under `data/source_data`:
1. `gpdp_demographics.json`
2. `pppinindia_infrastructure.json`
3. `pib_press_releases.json`
4. `india_administrative_directory.json`

## Requirements
- Each file must be syntactically valid JSON.
- The content in each file must be explicitly linked to Visakhapatnam (Vizag) district.
- Check that the ward references in the datasets (such as `Ward 4 - Nidigattu panchayat`, `Ward 19 - MVP Sector-12`, `Ward 96 - Pendurthi old Village`) exactly match those in the project's official ward list (`data/wards_clean.json` or `db/seed.sql`).
- Compile your review report and write it to `handoff.md` and `review.md` in your directory.

## 2026-07-08T09:56:20Z
You are teamwork_preview_reviewer. Your working directory is c:\Users\nagen\JanNaadi\jannaadi\.agents\teamwork_preview_reviewer_verification. Read ORIGINAL_REQUEST.md in your directory. Read the written JSON files under c:\Users\nagen\JanNaadi\jannaadi\data\source_data\ and verify their syntax validity, correctness of the Visakhapatnam links, and cross-reference the ward names used in these JSON files against the official list in c:\Users\nagen\JanNaadi\jannaadi\data\wards_clean.json. Output your review report to handoff.md and review.md in your directory.

