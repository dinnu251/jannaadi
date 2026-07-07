const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('Starting Playwright scraper for GVMC official wards...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.gvmc.gov.in/wss/ItmsCommonReport.htm?ptreg=Rep1', { waitUntil: 'networkidle' });
    
    // get all options in the zone dropdown
    const zones = await page.$$eval('select[name="zone"] option', opts => 
        opts.map(o => ({ value: o.value, text: o.text })).filter(o => o.value && o.value !== 'ALL' && o.text !== 'NO ZONE')
    );
    
    let allWards = [];
    
    for (const zone of zones) {
        console.log(`Selecting ${zone.text} (${zone.value})...`);
        
        // select zone
        await page.selectOption('select[name="zone"]', zone.value);
        
        // wait for wards to populate (dwr / ajax)
        try {
            await page.waitForFunction(() => {
                const wardSelect = document.querySelector('select[name="ward"]');
                return wardSelect && wardSelect.options.length > 2; // > 2 because --Select-- and ALL
            }, { timeout: 3000 });
        } catch(e) {
            console.log('Timeout or no wards for zone ' + zone.text);
        }
        
        const wards = await page.$$eval('select[name="ward"] option', opts => 
            opts.map(o => ({ value: o.value, text: o.text })).filter(o => o.value && o.value !== 'ALL')
        );
        
        console.log(`Found ${wards.length} wards in ${zone.text}`);
        wards.forEach(w => {
            if (!allWards.find(aw => aw.value === w.value)) {
                allWards.push({ ...w, zone: zone.text });
            }
        });
        
        // reset zone so the next select triggers a change properly if needed
        await page.selectOption('select[name="zone"]', '');
        await page.waitForTimeout(500);
    }
    
    console.log(`Total unique wards found: ${allWards.length}`);
    const outputPath = path.join(__dirname, 'gvmc_wards_from_site.json');
    fs.writeFileSync(outputPath, JSON.stringify(allWards, null, 2));
    
  } catch (err) {
    console.error('Error during scraping:', err);
  } finally {
    await browser.close();
  }
})();
