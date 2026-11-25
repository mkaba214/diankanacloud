// Content refresh job: finds new Guinea news leads on GDELT and stages them for review.
// Never publishes: it writes staging/leads-<date>.json and a PR description; the workflow
// opens a draft pull request with them. staging/ is not part of the site build.
//
//   node scripts/refresh/find-leads.mjs [--since <ISO date>] [--body <file>]
//
// --since: start of the window (the previous successful run); defaults to 3 days ago,
// and is never more than 7 days back. Writes "file=<path>" to $GITHUB_OUTPUT when leads
// were staged, nothing when there is nothing new.
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import vm from 'node:vm';
import { pickLeads, prBody, safeUrl } from './leads.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const STAGING = path.join(ROOT, 'staging');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const now = new Date();
const DAY = 86400000;
let since = new Date(arg('--since') || process.env.SINCE || now - 3 * DAY);
if (isNaN(since) || since > now) since = new Date(now - 3 * DAY);
if (now - since > 7 * DAY) since = new Date(now - 7 * DAY);

// GDELT: Guinean outlets (any subject; classified locally from the headline), then
// international English coverage. The second query is optional: GDELT often times out on it.
const QUERIES = [
  { query: 'sourcecountry:guinea', required: true },
  { query: '(Simandou OR Conakry OR Guinean) sourcelang:english', required: false },
];
const stamp = d => d.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Plain https GET with a generous timeout: GDELT is often slow to answer.
function get(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'diankanacloud-content-refresh' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > 5e6) req.destroy(new Error('response too large')); });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function gdelt(query) {
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  Object.entries({ query, mode: 'artlist', format: 'json', maxrecords: '250', sort: 'datedesc',
    startdatetime: stamp(since), enddatetime: stamp(now) }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { status, body } = await get(u);
      if (status === 429 || /limit requests/i.test(body)) throw new Error('rate limited');
      if (status !== 200) throw new Error(`HTTP ${status}`);
      if (!body.trim()) return [];
      return JSON.parse(body).articles || [];
    } catch (e) {
      console.log(`GDELT "${query}" attempt ${attempt}: ${e.message}`);
      if (attempt < 4) await sleep(20000 * attempt);
    }
  }
  throw new Error(`GDELT query failed: ${query}`);
}

// What the site already has (ARTICLES in index.html) and what is already staged.
function known() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('const ARTICLES = [');
  const end = html.indexOf('const TOPICS', start);
  const articles = vm.runInNewContext(html.slice(start, end).replace('const ARTICLES', 'var ARTICLES') + '\nARTICLES', {}, { timeout: 2000 });
  const titles = articles.flatMap(a => [a.title.fr, a.title.en]);
  const urls = articles.map(a => a.source && a.source.url).filter(Boolean);
  if (fs.existsSync(STAGING)) {
    for (const f of fs.readdirSync(STAGING).filter(f => /^leads-.*\.json$/.test(f))) {
      try {
        for (const l of JSON.parse(fs.readFileSync(path.join(STAGING, f), 'utf8')).leads || []) { titles.push(l.title); urls.push(l.url); }
      } catch { /* a hand-edited file that no longer parses is skipped */ }
    }
  }
  return { titles, urls: urls.map(safeUrl).filter(Boolean) };
}

const raw = [];
for (const [i, q] of QUERIES.entries()) {
  if (i) await sleep(6000); // GDELT allows one request every 5 seconds
  try {
    const list = await gdelt(q.query);
    console.log(`GDELT "${q.query}": ${list.length} articles since ${since.toISOString()}`);
    raw.push(...list);
  } catch (e) {
    if (q.required) { console.error(e.message); process.exit(1); }
    console.log(`${e.message} (optional, skipped)`);
  }
}

const leads = pickLeads(raw, { known: known(), since: since.toISOString(), max: 4 });
if (!leads.length) {
  console.log('No new leads: nothing staged.');
  process.exit(0);
}

const day = now.toISOString().slice(0, 10);
fs.mkdirSync(STAGING, { recursive: true });
let file = path.join(STAGING, `leads-${day}.json`);
for (let n = 2; fs.existsSync(file); n++) file = path.join(STAGING, `leads-${day}-${n}.json`);
const relFile = path.relative(ROOT, file);
fs.writeFileSync(file, JSON.stringify({
  generated: now.toISOString(), window: { from: since.toISOString(), to: now.toISOString() },
  source: 'GDELT (api.gdeltproject.org)', status: 'staged, not reviewed', leads,
}, null, 2) + '\n');
const body = prBody(leads, { from: since.toISOString(), to: now.toISOString(), file: relFile });
if (arg('--body')) fs.writeFileSync(arg('--body'), body + '\n');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `file=${relFile}\n`);
console.log(`Staged ${leads.length} lead(s) in ${relFile}:`);
leads.forEach(l => console.log(`  [${l.topicLabel}] ${l.title} (${l.outlet})`));
