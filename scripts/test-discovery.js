const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Auto-detect the project root directory
const projectRoot = path.join(__dirname, '..');

// Helper to check and load environment variables
function findEnvLocal(startDir) {
  let currentDir = startDir;
  for (let i = 0; i < 4; i++) {
    const checkPath = path.join(currentDir, '.env.local');
    if (fs.existsSync(checkPath)) return { found: true, path: checkPath };
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; 
    currentDir = parentDir;
  }
  return { found: false };
}

function loadEnv() {
  const result = findEnvLocal(__dirname);
  if (!result.found) {
    console.warn("⚠️ Warning: Could not locate your '.env.local' file.");
    return;
  }
  try {
    const envConfig = fs.readFileSync(result.path, 'utf-8');
    envConfig.split(/\r?\n/).forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) return;
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) return;
      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      process.env[key] = value;
    });
  } catch (err) {
    console.error(`❌ Failed to read or parse .env.local: ${err.message}`);
  }
}

loadEnv();

// Helper to recursively locate the credentials file in parent directories if relative path fails
function findCredentialsFile(rawPath) {
  if (!rawPath) return null;
  
  // Strip relative dots and prefixes if any
  const fileName = path.basename(rawPath);
  let currentDir = __dirname;

  for (let i = 0; i < 4; i++) {
    const checkPath = path.join(currentDir, fileName);
    if (fs.existsSync(checkPath)) {
      return checkPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return null;
}

// Install Google Auth library dynamically if missing
try {
  require.resolve('google-auth-library');
} catch (e) {
  console.log("📥 'google-auth-library' missing. Dynamically installing dependency...");
  execSync('npm install google-auth-library', { stdio: 'inherit' });
  console.log("✅ Installed successfully!");
}

const { GoogleAuth } = require('google-auth-library');

async function runDiagnostics() {
  console.log("\n========================================================");
  console.log("🔍 STARTING VERTEX AI SEARCH (DISCOVERY ENGINE) DIAGNOSTICS");
  console.log("========================================================\n");

  const projectId = process.env.GCP_PROJECT;
  const dataStoreId = process.env.PLAN_DATASTORE_ID;
  
  // Resolve key with or without plural 'S' typo in environment definitions
  const credsPathRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIAL;

  console.log(`📋 Configuration Checklist:`);
  console.log(`   - GCP Project: ${projectId ? `✅ "${projectId}"` : '❌ MISSING'}`);
  console.log(`   - Datastore ID: ${dataStoreId ? `✅ "${dataStoreId}"` : '❌ MISSING'}`);
  console.log(`   - Credentials Config Key: ${credsPathRaw ? `✅ "${credsPathRaw}"` : '❌ MISSING'}`);

  if (!projectId || !dataStoreId || !credsPathRaw) {
    console.error("\n❌ Error: Missing configuration parameters in .env.local. Please fix them and rerun.");
    process.exit(1);
  }

  // Attempt to resolve file location recursively
  const absoluteCredsPath = findCredentialsFile(credsPathRaw);

  if (!absoluteCredsPath) {
    console.error(`\n❌ Error: Credentials file NOT found!`);
    console.log(`   We searched for "${path.basename(credsPathRaw)}" recursively in:`);
    let searchDir = __dirname;
    for (let i = 0; i < 4; i++) {
      console.log(`   👉 ${searchDir}`);
      searchDir = path.dirname(searchDir);
    }
    console.log(`\n💡 Recommended Fixes:`);
    console.log(`   1. Ensure the Service Account JSON key you downloaded is placed in either:`);
    console.log(`      - C:\\Users\\nagen\\JanNaadi\\`);
    console.log(`      - C:\\Users\\nagen\\JanNaadi\\jannaadi\\`);
    console.log(`   2. Make sure it is named exactly "${path.basename(credsPathRaw)}".`);
    process.exit(1);
  } else {
    console.log(`   - Credentials File Status: ✅ Physical file found at: ${absoluteCredsPath}`);
  }

  // Setup Google Authentication Client
  const auth = new GoogleAuth({
    keyFilename: absoluteCredsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  console.log("\n🔑 Generating temporary GCP Access Token...");
  let client, accessToken;
  try {
    client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    accessToken = tokenResponse.token;
    console.log("   ✅ Access token generated successfully.");
  } catch (err) {
    console.error(`   ❌ Authentication Failed: ${err.message}`);
    console.log("\n💡 Recommended Fix: Ensure your credentials file contains a valid service account key.");
    process.exit(1);
  }

  // We will test both endpoints: global and us-regional
  const locationsToTest = ['global', 'us'];
  const testQuery = "Madhurawada layout plan";

  for (const location of locationsToTest) {
    console.log(`\n📡 Testing endpoint location: "${location}"...`);
    
    // Discovery Engine Search API URL schema
    const url = `https://discoveryengine.googleapis.com/v1beta/projects/${projectId}/locations/${location}/dataStores/${dataStoreId}/servingConfigs/default_search:search`;
    
    const payload = {
      query: testQuery,
      pageSize: 3,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = { rawText: responseText };
      }

      if (response.ok) {
        console.log(`   🎉 SUCCESS! Connected to "${location}" endpoint.`);
        console.log(`   📝 Found ${responseData.results?.length || 0} matching document results.`);
        console.log(`\n💡 Recommended Configuration:`);
        console.log(`   Your app should query Vertex AI using the location: "${location}".`);
        return;
      } else {
        const errCode = response.status;
        const errMsg = responseData.error?.message || responseText;
        const errStatus = responseData.error?.status || "UNKNOWN";

        console.warn(`   ❌ Request failed (HTTP ${errCode} - ${errStatus})`);
        console.warn(`      Details: ${errMsg}`);

        // Analyze specific error signatures
        if (errCode === 404) {
          console.log(`      👉 Diagnosis: The Data Store ID "${dataStoreId}" was not found in location "${location}".`);
        } else if (errCode === 403) {
          console.log(`      👉 Diagnosis: Unauthorized. Your service account might be missing the "Discovery Engine Viewer" IAM role.`);
        } else if (errCode === 503) {
          console.log(`      👉 Diagnosis: The search engine is currently offline/initializing.`);
          console.log(`         This is normal if you uploaded files within the last 15 minutes. GCP is still indexing.`);
        }
      }
    } catch (err) {
      console.error(`   ❌ Network/Fetch Error: ${err.message}`);
    }
  }

  console.log("\n========================================================");
  console.log("❌ DIAGNOSTICS COMPLETE - ALL ENDPOINTS TRIED");
  console.log("========================================================\n");
  console.log("📋 Summary of Steps to Fix:");
  console.log("1. Double check your Vertex AI Agent Builder Console > Data Stores.");
  console.log("2. Copy the exact text in the 'ID' column (not the display name).");
  console.log("3. Ensure that your Service Account has the 'Discovery Engine Viewer' role in GCP IAM & Admin.");
  console.log("4. Wait 10 minutes for Google to finish index generation if you just imported the files.");
}

runDiagnostics();