# Golden media assets (H-1 — blocks B11 and the demo)

## Voice clips — generated via ElevenLabs TTS

Run once with the API key:

    ELEVENLABS_API_KEY=<key> npx tsx scripts/generate-golden-audio.ts

That produces g03/g04 (Telugu), g08 (Hindi), g12 (English), g15 (Hinglish) as
.mp3 here — texts live in scripts/generate-golden-audio.ts and speak the ward
name aloud, matching the expectations pinned in scripts/golden-set.json.
Listen-check each clip once before the demo. If Telugu output is poor
(needs the eleven_v3 model), regenerate just those two with Google TTS te-IN:
`--only G03,G04` after swapping the generator, or record them by phone.

| File | Item | Content |
|---|---|---|
| g03.mp3 | G03 | Telugu — water supply 1hr/day, Madhura Nagar (Ward 25) |
| g04.mp3 | G04 | Telugu — PHC no doctor, Pendurthi (demo golden-path file) |
| g08.mp3 | G08 | Hindi — drainage smell, Nehru Nagar (Ward 74) |
| g12.mp3 | G12 | English — clinic medicine stock-out, NRI Hospital area (Ward 14) |
| g15.mp3 | G15 | Hinglish — nala overflow, bacche school nahi ja pa rahe, Ambedkar Nagar (Ward 47) |

## Photos — still human-provided (2 minutes)

| File | Item | What |
|---|---|---|
| g05.jpg | G05 | Photo of a garbage pile (any representative jpg, <5MB) |
| g09.jpg | G09 | Photo of a broken road / potholes (any representative jpg, <5MB) |

Any phone photo or openly-licensed image works — the caption carries the
ward/category signal; the image just needs to plausibly match it.
