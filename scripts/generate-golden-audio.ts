// scripts/generate-golden-audio.ts — synthesize the 5 golden voice clips (H-1)
// via ElevenLabs TTS → assets/golden/gXX.mp3. The clips still exercise the REAL
// pipeline path: GCS upload → Cloud STT (te-IN/hi-IN/en-IN) → extraction.
//
// Usage: ELEVENLABS_API_KEY=... npx tsx scripts/generate-golden-audio.ts [--only G03]
// Optional: ELEVENLABS_VOICE_ID (default: a premade multilingual voice),
//           ELEVENLABS_MODEL (default tries eleven_v3, falls back to
//           eleven_multilingual_v2 — NOTE: multilingual_v2 does NOT support Telugu).
// Free-tier friendly: 5 clips ≈ 60-90 seconds of audio total.
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("ELEVENLABS_API_KEY required"); process.exit(1); }

const ROOT = path.resolve(__dirname, "..");
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"; // premade 'Rachel' — any voice works with multilingual models
const MODELS = process.env.ELEVENLABS_MODEL ? [process.env.ELEVENLABS_MODEL] : ["eleven_v3", "eleven_multilingual_v2"];

// First-person citizen complaints, matched to scripts/golden-set.json expectations
// (ward spoken aloud, severity implied by content). Native script for te/hi.
// Localities match the official 98-ward names pinned in scripts/golden-set.json.
const CLIPS: { id: string; file: string; lang: string; text: string }[] = [
  {
    id: "G03", file: "g03.mp3", lang: "te",
    text: "మధురా నగర్ లో నీళ్ళ సప్లై రోజుకి ఒక్క గంట మాత్రమే వస్తోంది సర్. పొద్దున్న ఆరు గంటలకి వచ్చి ఏడు గంటలకల్లా ఆగిపోతుంది. ట్యాంకులు నింపుకోవడం చాలా కష్టంగా ఉంది, దయచేసి చూడండి.",
  },
  {
    id: "G04", file: "g04.mp3", lang: "te",
    text: "పెందుర్తి పీహెచ్‌సీ లో చాలా రోజుల నుంచి డాక్టర్ లేరు. పేషెంట్లు వచ్చి వెనక్కి వెళ్ళిపోతున్నారు. మా అమ్మకి బీపీ మందులు కావాలంటే ప్రైవేట్ హాస్పిటల్ కి వెళ్ళాల్సి వస్తోంది. ఇది చాలా సీరియస్ ప్రాబ్లం సర్.",
  },
  {
    id: "G08", file: "g08.mp3", lang: "hi",
    text: "नेहरू नगर में नाले से बहुत बदबू आ रही है। हफ़्तों से सफाई नहीं हुई है, घर में बैठना मुश्किल हो गया है। मच्छर भी बहुत बढ़ गए हैं, कृपया जल्दी कुछ कीजिए।",
  },
  {
    id: "G12", file: "g12.mp3", lang: "en",
    text: "The clinic near NRI Hospital has completely run out of basic medicines. BP and diabetes patients are being sent away without their tablets. This has been going on for two weeks now, and elderly people are suffering. Please look into this urgently.",
  },
  {
    id: "G15", file: "g15.mp3", lang: "hi-en",
    text: "Ambedkar Nagar mein nala overflow ho raha hai, poori road par gandha paani bhar gaya hai. Bacche school nahi ja pa rahe hain. Do din se yahi haalat hai, bahut serious problem hai sir.",
  },
];

async function tts(text: string, model: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx > -1 ? process.argv[onlyIdx + 1].split(",") : null;
  mkdirSync(path.join(ROOT, "assets", "golden"), { recursive: true });

  let failed = 0;
  for (const clip of CLIPS.filter((c) => !only || only.includes(c.id))) {
    let done = false;
    for (const model of MODELS) {
      try {
        const audio = await tts(clip.text, model);
        if (audio.length < 5000) throw new Error(`suspiciously small output (${audio.length} bytes)`);
        const out = path.join(ROOT, "assets", "golden", clip.file);
        writeFileSync(out, audio);
        console.log(`✓ ${clip.id} (${clip.lang}) → assets/golden/${clip.file} [${model}, ${(audio.length / 1024).toFixed(0)}KB]`);
        done = true;
        break;
      } catch (e) {
        console.warn(`  ${clip.id} with ${model} failed: ${e}`);
      }
    }
    if (!done) { console.error(`✗ ${clip.id} FAILED on all models`); failed++; }
  }
  if (failed) { console.error(`${failed} clip(s) failed — Telugu items may need eleven_v3 access or Google TTS te-IN fallback`); process.exit(1); }
  console.log("All clips generated. Listen-check them once, then run golden.sh.");
}

main().catch((e) => { console.error(`fatal: ${e}`); process.exit(1); });
