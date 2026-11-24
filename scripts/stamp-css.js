// After building assets/site.css, put a content hash in the <link> URL so browsers fetch the new file.
const fs = require('fs'), crypto = require('crypto');
const hash = crypto.createHash('sha256').update(fs.readFileSync('assets/site.css')).digest('hex').slice(0, 10);
const html = fs.readFileSync('index.html', 'utf8');
const out = html.replace(/href="assets\/site\.css(\?v=[0-9a-f]+)?"/, `href="assets/site.css?v=${hash}"`);
if (out === html && !html.includes(`site.css?v=${hash}`)) { console.error('stylesheet <link> not found'); process.exit(1); }
fs.writeFileSync('index.html', out);
console.log('site.css?v=' + hash);
