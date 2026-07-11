# Project: Vizag Data Collection for JanNaadi

## Architecture
- Source data collection targets: `india.gov.in` (administrative), `gpdp.nic.in` (demographics), `pppinindia.gov.in` (infrastructure/PPP), `pib.gov.in` (press releases/urban development).
- Network Mode: CODE_ONLY (No external internet access).
- Approach: Search for pre-existing or mock data in the workspace. If absent, design and generate highly realistic, structured dataset files (JSON/Markdown) representing the target source records for Visakhapatnam (Vizag) and integrate them into the application's data directory.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration | Search the workspace for any cached/pre-downloaded files or mock endpoints representing the 4 target domains. Design target data formats. | None | DONE |
| 2 | Data Collection | Gather or synthesize structured records for Visakhapatnam district covering demographics, infrastructure, urban development, and administrative records. | M1 | DONE |
| 3 | Data Integration | Save the records under `data/source_data/` as source datasets for the JanNaadi civic-tech project. | M2 | DONE |
| 4 | Verification & Audit | Verify data completeness, Visakhapatnam links, format correctness, and run forensic audit. | M3 | DONE |

## Code Layout
- Target data folder: `c:\Users\nagen\JanNaadi\jannaadi\data\source_data\`
- Target metadata files: `c:\Users\nagen\JanNaadi\jannaadi\.agents\orchestrator\`

## Interface Contracts
- Demographics data (from gpdp.nic.in): Must contain population, SC/ST, and gender metrics for Vizag/GP level.
- Infrastructure/PPP (from pppinindia.gov.in): Must contain major infrastructure or PPP projects in Vizag (e.g., roads, ports, metro, airport).
- Press releases (from pib.gov.in): Must contain recent administrative announcements, policy schemes, and urban development initiatives in Vizag.
- Administrative records (from india.gov.in): Must contain directory/contact structure of key district administrators in Visakhapatnam.
