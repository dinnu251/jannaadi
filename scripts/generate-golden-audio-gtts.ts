// scripts/generate-golden-audio-gtts.ts
// Generates the 5 golden voice clips using Google Cloud Text-to-Speech.
// Uses Application Default Credentials (gcloud auth application-default login).
//
// Prerequisites (one-time):
//   gcloud services enable texttospeech.googleapis.com --project=jannaadi
//   gcloud auth application-default login
//
// Usage:
//   npx tsx scripts/generate-golden-audio-gtts.ts
//   npx tsx scripts/generate-golden-audio-gtts.ts --only G03,G04
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

// Get ADC token via gcloud
function getToken(): string {
  try {
    return execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
  } catch {
    // Fallback: try GOOGLE_APPLICATION_CREDENTIALS service account
    try {
      return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
    } catch (e) {
      console.error("Could not get Google auth token. Run: gcloud auth application-default login");
      process.exit(1);
    }
  }
}

type Clip = { id: string; file: string; lang: string; gender: "MALE" | "FEMALE"; text: string };

// Exact texts from scripts/generate-golden-audio.ts — ward names spoken aloud
const CLIPS: Clip[] = [
  {
    id: "G03", file: "g03.mp3", lang: "te-IN", gender: "FEMALE",
    text: "మధురవాడ లో నీళ్ళ సప్లై రోజుకి ఒక్క గంట మాత్రమే వస్తోంది సర్. పొద్దున్న ఆరు గంటలకి వచ్చి ఏడు గంటలకల్లా ఆగిపోతుంది. ట్యాంకులు నింపుకోవడం చాలా కష్టంగా ఉంది, దయచేసి చూడండి.",
  },
  {
    id: "G04", file: "g04.mp3", lang: "te-IN", gender: "FEMALE",
    text: "పెందుర్తి పీహెచ్‌సీ లో చాలా రోజుల నుంచి డాక్టర్ లేరు. పేషెంట్లు వచ్చి వెనక్కి వెళ్ళిపోతున్నారు. మా అమ్మకి బీపీ మందులు కావాలంటే ప్రైవేట్ హాస్పిటల్ కి వెళ్ళాల్సి వస్తోంది. ఇది చాలా సీరియస్ ప్రాబ్లం సర్.",
  },
  {
    id: "G08", file: "g08.mp3", lang: "hi-IN", gender: "FEMALE",
    text: "कांचरापालेम में नाले से बहुत बदबू आ रही है। हफ़्तों से सफाई नहीं हुई है, घर में बैठना मुश्किल हो गया है। मच्छर भी बहुत बढ़ गए हैं, कृपया जल्दी कुछ कीजिए।",
  },
  {
    id: "G12", file: "g12.mp3", lang: "en-IN", gender: "FEMALE",
    text: "The clinic in Malkapuram has completely run out of basic medicines. BP and diabetes patients are being sent away without their tablets. This has been going on for two weeks now, and elderly people are suffering. Please look into this urgently.",
  },
  {
    id: "G15", file: "g15.mp3", lang: "hi-IN", gender: "FEMALE",
    text: "Gopalapatnam mein nala overflow ho raha hai, poori road par gandha paani bhar gaya hai. Bacche school nahi ja pa rahe hain. Do din se yahi haalat hai, bahut serious problem hai sir.",
  },
];

async function synthesize(clip: Clip, token: string): Promise<Buffer> {
  const body = JSON.stringify({
    input: { text: clip.text },
    voice: { languageCode: clip.lang, ssmlGender: clip.gender },
    audioConfig: { audioEncoding: "MP3", speakingRate: 0.9 },
  });

  const res = await fetch(
    "https://texttospeech.googleapis.com/v1/text:synthesize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err}`);
  }

  const json = (await res.json()) as { audioContent: string };
  return Buffer.from(json.audioContent, "base64");
}

async function main() {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx > -1 ? process.argv[onlyIdx + 1].split(",") : null;
  const clips = CLIPS.filter((c) => !only || only.includes(c.id));

  mkdirSync(path.join(ROOT, "assets", "golden"), { recursive: true });

  console.log("Getting Google auth token...");
  const token = getToken();
  console.log("✓ Token obtained\n");

  let failed = 0;
  for (const clip of clips) {
    try {
      const audio = await synthesize(clip, token);
      if (audio.length < 2000) throw new Error(`output too small (${audio.length} bytes)`);
      const out = path.join(ROOT, "assets", "golden", clip.file);
      writeFileSync(out, audio);
      console.log(`✓ ${clip.id} (${clip.lang}) → assets/golden/${clip.file} [${(audio.length / 1024).toFixed(0)}KB]`);
    } catch (e) {
      console.error(`✗ ${clip.id} FAILED: ${e}`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n${failed} clip(s) failed.`);
    console.error("If you see 403: run  gcloud auth application-default login");
    console.error("If you see API not enabled: run  gcloud services enable texttospeech.googleapis.com --project=jannaadi");
    process.exit(1);
  }
  console.log("\nAll clips generated. Check assets/golden/ then run scripts/golden.sh.");
}

main().catch((e) => { console.error(`fatal: ${e}`); process.exit(1); });
