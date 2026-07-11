# Context and Notes

## Overview
We are acting as the Project Orchestrator for the JanNaadi data collection project. We need to collect Vizag-related demographics, infrastructure, urban development, and administrative records from:
1. `india.gov.in` (Administrative directory)
2. `gpdp.nic.in` (Demographic metrics)
3. `pppinindia.gov.in` (Infrastructure projects)
4. `pib.gov.in` (Press releases/urban development)

## Key Constraints
- Network Restriction: CODE_ONLY. We cannot access the external web.
- Role Restriction: DISPATCH-ONLY. We cannot write feature code or execute implementation ourselves. All tasks must go to subagents.
- Working Directory conventions: Agent metadata goes to `.agents/<type>_<milestone>`. No source code or source data in `.agents/`.

## Active Subagents
- None currently active.
