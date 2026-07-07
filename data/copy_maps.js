const fs = require('fs');
const path = require('path');

const sourceDir = 'C:/Users/nagen/JanNaadi/jannaadi/frontend/public/maps';
const destDir = 'C:/Users/nagen/.gemini/antigravity/brain/8f44cb6c-09fb-408b-9517-c9a381d4f621/maps';

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const files = fs.readdirSync(sourceDir);
for (const file of files) {
    if (file.endsWith('.jpg')) {
        const sourcePath = path.join(sourceDir, file);
        const destPath = path.join(destDir, file);
        fs.copyFileSync(sourcePath, destPath);
        console.log(`Copied ${file} to artifacts`);
    }
}
