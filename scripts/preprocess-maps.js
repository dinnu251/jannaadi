const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GoogleGenAI } = require('@google/genai');

const projectRoot = path.join(__dirname, '..');

// Helper to check and load environment variables
function findEnvLocal(startDir) {
  let currentDir = startDir;
  let scannedDirsLog = [];

  for (let i = 0; i < 4; i++) {
    const checkPath = path.join(currentDir, '.env.local');
    scannedDirsLog.push(currentDir);

    if (fs.existsSync(checkPath)) {
      return { found: true, path: checkPath };
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; 
    currentDir = parentDir;
  }

  return { found: false, scannedPaths: scannedDirsLog };
}

function loadEnv() {
  const result = findEnvLocal(__dirname);
  
  if (!result.found) {
    console.warn(`⚠️ Warning: Could not locate your exact '.env.local' file.`);
    return;
  }

  const envPath = result.path;
  console.log(`📂 Found and loading .env.local at: ${envPath}`);

  try {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    const lines = envConfig.split(/\r?\n/);
    let loadedCount = 0;

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) return;

      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) return;

      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.substring(1, value.length - 1);
      } else {
        const commentIndex = value.indexOf('#');
        if (commentIndex !== -1) {
          value = value.substring(0, commentIndex).trim();
        }
      }

      process.env[key] = value;
      loadedCount++;
    });

    console.log(`✅ Loaded ${loadedCount} environment variables from .env.local`);
  } catch (err) {
    console.error(`❌ Failed to read or parse .env.local: ${err.message}`);
  }
}

loadEnv();

const aiKey = process.env.GEMINI_API_KEY;
if (!aiKey) {
  console.error("❌ Error: GEMINI_API_KEY is not defined in .env.local. Please check your configuration.");
  process.exit(1);
}

// Initialize the Google Gen AI SDK client
const ai = new GoogleGenAI({ apiKey: aiKey });

async function callWithRetry(fn, retries = 5, delay = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errStr = error.message || '';
      const isRetryable = 
        errStr.includes('503') || 
        errStr.includes('429') || 
        errStr.includes('UNAVAILABLE') || 
        errStr.includes('RESOURCE_EXHAUSTED');

      if (isRetryable && attempt < retries) {
        console.warn(`⚠️ API busy or rate-limited. Retrying attempt ${attempt}/${retries} in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
      } else {
        throw error;
      }
    }
  }
}

function optimizePdfSize(sourcePath, destPath) {
  console.log(`🛠️ Detecting large masterplan. Verifying 'pdf-lib' toolset availability...`);
  try {
    require.resolve('pdf-lib');
  } catch (e) {
    console.log(`📥 'pdf-lib' not found. Dynamically injecting dependency into your local node_modules...`);
    execSync('npm install pdf-lib', { stdio: 'inherit' });
    console.log(`✅ 'pdf-lib' successfully loaded!`);
  }

  const { PDFDocument } = require('pdf-lib');
  
  return (async () => {
    console.log(`📖 Loading visual document layout structures...`);
    const sourceBytes = fs.readFileSync(sourcePath);
    const srcDoc = await PDFDocument.load(sourceBytes);
    const totalPages = srcDoc.getPageCount();
    
    console.log(`📄 Total pages in document: ${totalPages}`);
    
    // Create an optimized representation containing the first 25 pages
    // Municipal maps and plans pack legends, local coordinates, and summaries in the initial chapters
    const pagesToExtractCount = Math.min(25, totalPages);
    console.log(`✂️ Slicing and exporting the first ${pagesToExtractCount} pages to stay under Gemini's 50MB processing threshold...`);
    
    const subDoc = await PDFDocument.create();
    const copiedPages = await subDoc.copyPages(srcDoc, Array.from({ length: pagesToExtractCount }, (_, i) => i));
    copiedPages.forEach(page => subDoc.addPage(page));
    
    const optimizedBytes = await subDoc.save();
    fs.writeFileSync(destPath, optimizedBytes);
    
    const optimizedStats = fs.statSync(destPath);
    console.log(`📊 Downsized PDF generated: ${(optimizedStats.size / 1024 / 1024).toFixed(2)}MB (Safe for Gemini inference)`);
  })();
}

async function processVisualPdf(pdfFileName) {
  const plansDir = path.join(projectRoot, 'data/raw-plans/');
  const pdfPath = path.join(plansDir, pdfFileName);
  const outputFileName = pdfFileName.replace(/\.pdf$/i, '.txt');
  const outputPath = path.join(plansDir, outputFileName);

  if (fs.existsSync(outputPath)) {
    console.log(`⏭️ Skipping ${pdfFileName} (Sidecar text profile already exists).`);
    return;
  }
  
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF file not found at path: ${pdfPath}`);
    return;
  }

  console.log(`\n🔍 Found visual PDF: ${pdfFileName}`);
  const stats = fs.statSync(pdfPath);
  const fileSizeMB = stats.size / 1024 / 1024;
  console.log(`💾 File size: ${fileSizeMB.toFixed(2)}MB`);

  let targetPdfPath = pdfPath;
  let isOptimizedTempCreated = false;
  const tempPdfPath = path.join(plansDir, `temp_opt_${pdfFileName}`);

  // Auto-healing logic for files over Gemini's 50MB processing limit
  if (stats.size > 52428800) {
    console.warn(`⚠️ Warning: ${pdfFileName} is ${fileSizeMB.toFixed(2)}MB, exceeding Gemini's 50MB processing limit.`);
    try {
      await optimizePdfSize(pdfPath, tempPdfPath);
      targetPdfPath = tempPdfPath;
      isOptimizedTempCreated = true;
    } catch (optError) {
      console.error(`❌ PDF downsize extraction failed: ${optError.message}. Proceeding with original...`);
    }
  }

  let fileRef = null;

  try {
    // 1. Upload the optimized PDF to Google's file staging system
    console.log(`📤 Uploading file to Google Files API staging pool...`);
    fileRef = await callWithRetry(() => ai.files.upload({
      file: targetPdfPath,
      mimeType: 'application/pdf'
    }));

    // 2. Poll the status from Google's servers to guarantee the file is ACTIVE before indexing
    console.log(`⏳ Verifying staging status on Google servers...`);
    let fileInfo = await ai.files.get({ name: fileRef.name });
    let state = fileInfo.state;

    while (state === 'PROCESSING' || !state) {
      console.log('⏳ Google servers are still generating OCR & rendering visual layers for this map. Waiting 10s...');
      await new Promise(resolve => setTimeout(resolve, 10000)); 
      fileInfo = await ai.files.get({ name: fileRef.name });
      state = fileInfo.state;
    }

    if (state !== 'ACTIVE') {
      throw new Error(`Google Cloud file processing returned status: ${state}.`);
    }

    const prompt = `
      Analyze this developmental plan blueprint/map of Visakhapatnam (Vizag) in high detail.
      Extract and write a dense, search-optimized text summary containing:
      1. Geographic boundaries and specific localities/wards mentioned or depicted.
      2. Infrastructure scopes (e.g., roads, sewerage lines, pipelines, flyovers, schools, water treatment plants).
      3. Project names, developmental budgets, or department labels mentioned in the legends/headers.
      4. Explicitly list key landmarks shown (e.g., Madhurawada, Rushikonda, Gajuwaka).
      Provide this in clean, unstructured paragraphs so that a keyword-based search engine can index it easily.
    `;

    console.log(`🧠 Processing complete! Analyzing ${pdfFileName} using Gemini 2.5 Flash...`);
    
    // 3. Process the file using Gemini 2.5 Flash
    const response = await callWithRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { fileData: { fileUri: fileRef.uri, mimeType: fileRef.mimeType } }
          ]
        }
      ]
    }));

    const outputText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) throw new Error("Received an empty response from Gemini!");

    // 4. Write out the index summary
    fs.writeFileSync(outputPath, outputText, 'utf-8');
    console.log(`✅ Successfully generated sidecar profile: ${outputFileName}`);

  } catch (error) {
    console.error(`❌ Failed to process ${pdfFileName}:`, error.message || error);
  } finally {
    // 5. Clean up the staged file from Google servers to save cloud quota space
    if (fileRef) {
      try {
        await ai.files.delete({ name: fileRef.name });
      } catch (cleanupErr) {
        // Silently capture cleanup exceptions
      }
    }
    // Clean up local temp downsized file
    if (isOptimizedTempCreated && fs.existsSync(tempPdfPath)) {
      try {
        fs.unlinkSync(tempPdfPath);
        console.log(`🧹 Cleaned up temporary downsized file.`);
      } catch (e) {
        // Silently ignore unlink error
      }
    }
  }
}

const plansDir = path.join(projectRoot, 'data/raw-plans/');
if (!fs.existsSync(plansDir)) {
  fs.mkdirSync(plansDir, { recursive: true });
  console.log(`📁 data/raw-plans directory created. Place your map PDFs there and rerun the script.`);
} else {
  const files = fs.readdirSync(plansDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.log(`ℹ️ Place your masterplan PDFs inside "data/raw-plans/" to start pre-processing.`);
  } else {
    (async () => {
      console.log(`✨ Starting batch processing of ${files.length} plans...`);
      for (const file of files) {
        await processVisualPdf(file);
      }
      console.log("\n⚡ Preprocessing complete! Please upload both your original .pdf maps and the generated .txt summaries to your Google Cloud Storage bucket.");
    })();
  }
}