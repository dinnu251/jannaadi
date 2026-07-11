// Conversational ward recovery for Twilio inbound. When a complaint can't be tied to
// a ward, we ask the citizen for their locality and stash the original text here keyed
// by their hashed number; their next message supplies the area and we re-ingest the two
// combined. Single-process scope (in-memory, TTL'd) — fine for the demo / one Cloud Run
// instance. For multi-instance prod this belongs in a table (a submission row parked at
// status='awaiting_location'), so a follow-up can hit any instance.
const TTL_MS = 10 * 60 * 1000; // a citizen who answers within 10 min gets threaded

type Pending = { text: string; at: number };
const g = globalThis as unknown as { __twilioPending?: Map<string, Pending> };
function store(): Map<string, Pending> {
  return (g.__twilioPending ??= new Map<string, Pending>());
}

export function setPending(ref: string, text: string): void {
  store().set(ref, { text, at: Date.now() });
}

// Returns the stashed complaint text (and clears it) if one is pending and fresh.
export function takePending(ref: string): string | null {
  const s = store();
  const p = s.get(ref);
  if (!p) return null;
  s.delete(ref);
  return Date.now() - p.at > TTL_MS ? null : p.text;
}
