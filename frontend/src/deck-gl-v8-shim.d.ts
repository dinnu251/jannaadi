// deck.gl v8.9.x ships TypeScript declarations under typed/ but doesn't wire
// them into package.json's "types" field, so TS can't resolve them via
// normal module resolution. Pinned to v8 (not v9) — see Heatmap.tsx for why.
declare module '@deck.gl/layers';
declare module '@deck.gl/google-maps';
