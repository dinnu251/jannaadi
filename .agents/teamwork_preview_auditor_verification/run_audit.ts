import * as fs from 'fs';
import * as path from 'path';

const WARDS_CLEAN_PATH = path.join(__dirname, '../../data/wards_clean.json');
const SOURCE_DATA_DIR = path.join(__dirname, '../../data/source_data');

interface Ward {
  ward_number: number;
  name: string;
  lat: number;
  lng: number;
  population: number;
  demo_weight: number;
}

let wardsList: Ward[] = [];
try {
  wardsList = JSON.parse(fs.readFileSync(WARDS_CLEAN_PATH, 'utf8'));
  console.log(`Loaded ${wardsList.length} wards from clean list.`);
} catch (err: any) {
  console.error(`Failed to load wards_clean.json: ${err.message}`);
  process.exit(1);
}

const wardNames = new Set(wardsList.map(w => w.name));

interface VerificationResult {
  file: string;
  errors: string[];
  warnings: string[];
}

const results: VerificationResult[] = [];

// Helper to check if ward exists
function verifyWardName(wardName: string, file: string, context: string, errors: string[]) {
  if (!wardNames.has(wardName)) {
    errors.push(`Invalid ward name referenced: "${wardName}" in ${context}`);
  }
}

// 1. gpdp_demographics.json Verification
function verifyGpdpDemographics() {
  const file = 'gpdp_demographics.json';
  const filePath = path.join(SOURCE_DATA_DIR, file);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`File does not exist at ${filePath}`);
    results.push({ file, errors, warnings });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.source_url !== 'gpdp.nic.in') errors.push(`Expected source_url to be 'gpdp.nic.in', got '${data.source_url}'`);
    if (data.district !== 'Visakhapatnam') errors.push(`Expected district to be 'Visakhapatnam', got '${data.district}'`);
    if (data.state !== 'Andhra Pradesh') errors.push(`Expected state to be 'Andhra Pradesh', got '${data.state}'`);
    if (data.census_year !== 2011) errors.push(`Expected census_year to be 2011, got ${data.census_year}`);
    
    if (!Array.isArray(data.records)) {
      errors.push(`'records' field must be an array`);
      results.push({ file, errors, warnings });
      return;
    }

    for (let i = 0; i < data.records.length; i++) {
      const rec = data.records[i];
      const context = `records[${i}] (${rec.gp_name || 'unknown'})`;
      
      if (typeof rec.gp_lgd_code !== 'number') errors.push(`${context}: gp_lgd_code must be a number`);
      if (typeof rec.gp_name !== 'string') errors.push(`${context}: gp_name must be a string`);
      if (typeof rec.mandal_name !== 'string') errors.push(`${context}: mandal_name must be a string`);
      if (typeof rec.mapped_gvmc_ward !== 'string') errors.push(`${context}: mapped_gvmc_ward must be a string`);
      
      if (rec.mapped_gvmc_ward) {
        verifyWardName(rec.mapped_gvmc_ward, file, context, errors);
      }

      const demo = rec.demographics;
      if (!demo) {
        errors.push(`${context}: 'demographics' object is missing`);
        continue;
      }

      if (typeof demo.total_population !== 'number') errors.push(`${context}: total_population must be a number`);
      if (!demo.gender || typeof demo.gender.male !== 'number' || typeof demo.gender.female !== 'number') {
        errors.push(`${context}: gender male/female counts must be numbers`);
      } else {
        const sumGender = demo.gender.male + demo.gender.female;
        if (sumGender !== demo.total_population) {
          errors.push(`${context}: male (${demo.gender.male}) + female (${demo.gender.female}) = ${sumGender} does not match total_population (${demo.total_population})`);
        }
      }

      const sv = demo.social_vulnerabilities;
      if (!sv) {
        errors.push(`${context}: social_vulnerabilities object is missing`);
        continue;
      }

      if (typeof sv.sc_count !== 'number') errors.push(`${context}: sc_count must be a number`);
      if (typeof sv.sc_percentage !== 'number') errors.push(`${context}: sc_percentage must be a number`);
      if (typeof sv.st_count !== 'number') errors.push(`${context}: st_count must be a number`);
      if (typeof sv.st_percentage !== 'number') errors.push(`${context}: st_percentage must be a number`);

      if (typeof demo.total_population === 'number' && demo.total_population > 0) {
        if (typeof sv.sc_count === 'number') {
          const expectedScPct = Math.round((sv.sc_count / demo.total_population) * 10000) / 100;
          if (Math.abs(expectedScPct - sv.sc_percentage) > 0.05) {
            errors.push(`${context}: SC percentage mismatch. Got ${sv.sc_percentage}%, expected ~${expectedScPct}% based on sc_count=${sv.sc_count} and population=${demo.total_population}`);
          }
        }
        if (typeof sv.st_count === 'number') {
          const expectedStPct = Math.round((sv.st_count / demo.total_population) * 10000) / 100;
          if (Math.abs(expectedStPct - sv.st_percentage) > 0.05) {
            errors.push(`${context}: ST percentage mismatch. Got ${sv.st_percentage}%, expected ~${expectedStPct}% based on st_count=${sv.st_count} and population=${demo.total_population}`);
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`JSON parsing/exception error: ${err.message}`);
  }

  results.push({ file, errors, warnings });
}

// 2. india_administrative_directory.json Verification
function verifyIndiaAdministrativeDirectory() {
  const file = 'india_administrative_directory.json';
  const filePath = path.join(SOURCE_DATA_DIR, file);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`File does not exist at ${filePath}`);
    results.push({ file, errors, warnings });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.source_url !== 'india.gov.in') errors.push(`Expected source_url to be 'india.gov.in', got '${data.source_url}'`);
    if (data.district !== 'Visakhapatnam') errors.push(`Expected district to be 'Visakhapatnam', got '${data.district}'`);
    if (data.state !== 'Andhra Pradesh') errors.push(`Expected state to be 'Andhra Pradesh', got '${data.state}'`);
    if (data.state_headquarters !== 'Amaravati') errors.push(`Expected state_headquarters to be 'Amaravati', got '${data.state_headquarters}'`);

    if (!Array.isArray(data.officials)) {
      errors.push(`'officials' field must be an array`);
      results.push({ file, errors, warnings });
      return;
    }

    for (let i = 0; i < data.officials.length; i++) {
      const official = data.officials[i];
      const context = `officials[${i}] (${official.designation || 'unknown'})`;

      if (typeof official.designation !== 'string') errors.push(`${context}: designation must be a string`);
      if (typeof official.name !== 'string') errors.push(`${context}: name must be a string`);
      if (typeof official.department !== 'string') errors.push(`${context}: department must be a string`);
      if (typeof official.office_address !== 'string') errors.push(`${context}: office_address must be a string`);
      
      // Address verification
      if (official.office_address && !official.office_address.includes('Visakhapatnam')) {
        warnings.push(`${context}: Office address does not contain 'Visakhapatnam'`);
      }
      
      const pinMatch = official.office_address ? official.office_address.match(/\b\d{6}\b/) : null;
      if (!pinMatch) {
        warnings.push(`${context}: No 6-digit pincode found in office address`);
      } else {
        const pin = pinMatch[0];
        if (!pin.startsWith('530')) {
          warnings.push(`${context}: Pincode ${pin} is outside typical Visakhapatnam municipal area (starts with 530)`);
        }
      }

      const contact = official.contact;
      if (!contact) {
        errors.push(`${context}: contact object is missing`);
        continue;
      }

      if (typeof contact.phone !== 'string') errors.push(`${context}: contact.phone must be a string`);
      if (typeof contact.email !== 'string') errors.push(`${context}: contact.email must be a string`);
      if (typeof contact.website !== 'string') errors.push(`${context}: contact.website must be a string`);

      if (contact.phone && !contact.phone.includes('891') && !contact.phone.includes('892')) {
        warnings.push(`${context}: Phone number ${contact.phone} does not contain Vizag area code (891)`);
      }
    }

  } catch (err: any) {
    errors.push(`JSON parsing/exception error: ${err.message}`);
  }

  results.push({ file, errors, warnings });
}

// 3. pib_press_releases.json Verification
function verifyPibPressReleases() {
  const file = 'pib_press_releases.json';
  const filePath = path.join(SOURCE_DATA_DIR, file);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`File does not exist at ${filePath}`);
    results.push({ file, errors, warnings });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.source_url !== 'pib.gov.in') errors.push(`Expected source_url to be 'pib.gov.in', got '${data.source_url}'`);
    if (data.location_filter !== 'Visakhapatnam') errors.push(`Expected location_filter to be 'Visakhapatnam', got '${data.location_filter}'`);

    if (!Array.isArray(data.press_releases)) {
      errors.push(`'press_releases' field must be an array`);
      results.push({ file, errors, warnings });
      return;
    }

    for (let i = 0; i < data.press_releases.length; i++) {
      const pr = data.press_releases[i];
      const context = `press_releases[${i}] (${pr.release_id || 'unknown'})`;

      if (typeof pr.release_id !== 'string') errors.push(`${context}: release_id must be a string`);
      if (typeof pr.ministry !== 'string') errors.push(`${context}: ministry must be a string`);
      if (typeof pr.date !== 'string') errors.push(`${context}: date must be a string`);
      if (typeof pr.headline !== 'string') errors.push(`${context}: headline must be a string`);
      if (typeof pr.city !== 'string') errors.push(`${context}: city must be a string`);
      if (typeof pr.text !== 'string') errors.push(`${context}: text must be a string`);
      
      if (!Array.isArray(pr.associated_sectors)) errors.push(`${context}: associated_sectors must be an array`);
      if (!Array.isArray(pr.impacted_wards)) {
        errors.push(`${context}: impacted_wards must be an array`);
      } else {
        for (const w of pr.impacted_wards) {
          verifyWardName(w, file, `${context} impacted_ward "${w}"`, errors);
        }
      }

      // Check ISO date format
      if (pr.date && isNaN(Date.parse(pr.date))) {
        errors.push(`${context}: date "${pr.date}" is not a valid date string`);
      }
    }

  } catch (err: any) {
    errors.push(`JSON parsing/exception error: ${err.message}`);
  }

  results.push({ file, errors, warnings });
}

// 4. pppinindia_infrastructure.json Verification
function verifyPppInIndia() {
  const file = 'pppinindia_infrastructure.json';
  const filePath = path.join(SOURCE_DATA_DIR, file);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`File does not exist at ${filePath}`);
    results.push({ file, errors, warnings });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.source_url !== 'pppinindia.gov.in') errors.push(`Expected source_url to be 'pppinindia.gov.in', got '${data.source_url}'`);
    if (data.location_filter !== 'Visakhapatnam') errors.push(`Expected location_filter to be 'Visakhapatnam', got '${data.location_filter}'`);

    if (!Array.isArray(data.projects)) {
      errors.push(`'projects' field must be an array`);
      results.push({ file, errors, warnings });
      return;
    }

    for (let i = 0; i < data.projects.length; i++) {
      const p = data.projects[i];
      const context = `projects[${i}] (${p.project_id || 'unknown'})`;

      if (typeof p.project_id !== 'string') errors.push(`${context}: project_id must be a string`);
      if (typeof p.project_name !== 'string') errors.push(`${context}: project_name must be a string`);
      if (typeof p.sector !== 'string') errors.push(`${context}: sector must be a string`);
      if (typeof p.sub_sector !== 'string') errors.push(`${context}: sub_sector must be a string`);
      if (typeof p.authority !== 'string') errors.push(`${context}: authority must be a string`);
      if (typeof p.private_partner !== 'string') errors.push(`${context}: private_partner must be a string`);
      if (typeof p.project_cost_inr_cr !== 'number') errors.push(`${context}: project_cost_inr_cr must be a number`);
      if (typeof p.ppp_mode !== 'string') errors.push(`${context}: ppp_mode must be a string`);
      if (typeof p.status !== 'string') errors.push(`${context}: status must be a string`);
      if (typeof p.concession_period_years !== 'number') errors.push(`${context}: concession_period_years must be a number`);
      if (p.concession_signing_date !== null && typeof p.concession_signing_date !== 'string') {
        errors.push(`${context}: concession_signing_date must be a string or null`);
      }

      if (!p.coordinates || typeof p.coordinates.lat !== 'number' || typeof p.coordinates.lng !== 'number') {
        errors.push(`${context}: coordinates lat/lng must be numbers`);
      } else {
        // Vizag coordinates are roughly lat: [17.5, 18.2], lng: [82.8, 83.6]
        const lat = p.coordinates.lat;
        const lng = p.coordinates.lng;
        if (lat < 17.0 || lat > 18.5 || lng < 82.5 || lng > 84.0) {
          warnings.push(`${context}: Coordinates (${lat}, ${lng}) seem out of range for Visakhapatnam region`);
        }
      }

      if (typeof p.description !== 'string') errors.push(`${context}: description must be a string`);
    }

  } catch (err: any) {
    errors.push(`JSON parsing/exception error: ${err.message}`);
  }

  results.push({ file, errors, warnings });
}

verifyGpdpDemographics();
verifyIndiaAdministrativeDirectory();
verifyPibPressReleases();
verifyPppInIndia();

console.log('\n--- AUDIT RESULTS ---');
let totalErrors = 0;
let totalWarnings = 0;

for (const res of results) {
  console.log(`\nFile: ${res.file}`);
  if (res.errors.length === 0) {
    console.log('  Errors: NONE');
  } else {
    console.log(`  Errors (${res.errors.length}):`);
    for (const err of res.errors) {
      console.log(`    - ❌ ${err}`);
      totalErrors++;
    }
  }

  if (res.warnings.length === 0) {
    console.log('  Warnings: NONE');
  } else {
    console.log(`  Warnings (${res.warnings.length}):`);
    for (const wrn of res.warnings) {
      console.log(`    - ⚠️ ${wrn}`);
      totalWarnings++;
    }
  }
}

console.log(`\n=================================`);
console.log(`Audit finished with ${totalErrors} errors and ${totalWarnings} warnings.`);
process.exit(totalErrors > 0 ? 1 : 0);
