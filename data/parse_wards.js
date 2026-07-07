const fs = require('fs');
const cheerio = require('cheerio');

const contentPath = 'C:\\Users\\nagen\\.gemini\\antigravity\\brain\\8f44cb6c-09fb-408b-9517-c9a381d4f621\\.system_generated\\steps\\160\\content.md';
const html = fs.readFileSync(contentPath, 'utf-8');

const $ = cheerio.load(html);

$('select').each((i, el) => {
  const name = $(el).attr('name') || '';
  const id = $(el).attr('id') || '';
  console.log(`Select [${i}]: id="${id}" name="${name}"`);
  
  const options = $(el).find('option');
  console.log(`  Has ${options.length} options.`);
  if (options.length < 100) {
      options.each((j, opt) => {
          console.log(`    Option: ${$(opt).text().trim()} (${$(opt).val()})`);
      });
  } else {
      console.log(`    (Too many options, first 5 shown)`);
      for(let j=0; j<5; j++) {
          const opt = options.eq(j);
          console.log(`    Option: ${opt.text().trim()} (${opt.val()})`);
      }
  }
});
