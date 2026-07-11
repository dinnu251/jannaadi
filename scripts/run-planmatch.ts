// One-shot: refresh clusters.plan_match (e.g. after snippet-format changes).
import { runPlanMatchBatch } from "../worker/planmatch";
runPlanMatchBatch().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
