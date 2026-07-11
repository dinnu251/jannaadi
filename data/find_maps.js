const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\nagen\\.gemini\\antigravity\\brain\\8f44cb6c-09fb-408b-9517-c9a381d4f621\\.system_generated\\steps\\279\\content.md', 'utf8');

const cheerio = require('cheerio');
const $ = cheerio.load(content);

console.log('--- ALL IMAGES IN PAGE ---');
$('img').each((i, el) => {
    console.log($(el).attr('src'));
});
