const fs = require('fs');
const path = require('path');

const inputPath = 'C:/Users/nagen/.gemini/antigravity/brain/34dd328c-f6ca-4f28-9529-c50794b7f601/.system_generated/steps/39/output.txt';
const inputContent = fs.readFileSync(inputPath, 'utf8');

const jsonMatch = inputContent.match(/```json\n([\s\S]*?)\n```/);
let mapsData = {};
if (jsonMatch) {
    mapsData = JSON.parse(jsonMatch[1]);
} else {
    console.error("Could not parse JSON from subagent output");
    process.exit(1);
}

const outputDir = 'C:/Users/nagen/JanNaadi/jannaadi/frontend/public/maps';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

for (const [mapName, base64Url] of Object.entries(mapsData)) {
    // base64Url is like "data:image/jpeg;base64,/9j/4AAQSk..."
    const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `${mapName}.jpg`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log(`Saved ${filename}`);
}

console.log('All maps decoded and saved!');
