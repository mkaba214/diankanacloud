// News leads for the content refresh job: cleaning, classification, de-duplication, ranking.
// Pure functions (no network), tested in leads.test.mjs. Everything that comes from the web
// is treated as untrusted: tags and markup characters are removed, only http(s) links are kept.

export const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Subjects the site covers. "politique" has no site topic yet: those leads are staged
// with topic null so the reviewer decides where they belong.
export const TOPICS = [
  { key: 'mines', label: 'Mines', weight: 2,
    words: ['bauxite', 'simandou', 'minier', 'miniere', 'mines', 'mine', 'mining', 'miner', 'orpaillage', 'orpailleur',
      'gold', 'tonnes d or', 'tonnes dor', 'iron ore', 'minerai', 'alumine', 'alumina', 'cbg', 'smb', 'gac', 'rio tinto', 'winning consortium'] },
  { key: 'petrole', label: 'Pétrole / énergie', weight: 2,
    words: ['petrole', 'petrolier', 'oil', 'carburant', 'fuel', 'hydrocarbure', 'gasoil', 'essence', 'sonap', 'gaz', 'gas', 'electricite', 'electricity', 'edg', 'barrage', 'souapiti', 'kaleta'] },
  { key: 'finance', label: 'Économie / finance', weight: 2,
    words: ['economie', 'economy', 'economique', 'economic', 'bcrg', 'banque', 'bank', 'budget', 'fmi', 'imf', 'inflation', 'franc guineen',
      'dette', 'debt', 'investissement', 'investment', 'investor', 'croissance', 'growth', 'fintech', 'douane', 'impot', 'tax', 'bourse', 'world bank', 'banque mondiale'] },
  { key: 'tech', label: 'Tech / IT', weight: 2,
    words: ['numerique', 'digital', 'internet', 'telecom', 'telecoms', 'orange guinee', 'mtn', 'technologie', 'technology', 'intelligence artificielle',
      'artificial intelligence', 'cyber', 'data center', 'datacenter', 'startup', 'fibre', 'fiber', 'satellite', 'informatique', 'logiciel', 'software'] },
  { key: null, label: 'Politique', weight: 1,
    words: ['election', 'electoral', 'referendum', 'gouvernement', 'government', 'president', 'ministre', 'minister', 'premier ministre', 'cnt',
      'constitution', 'remaniement', 'decret', 'decree', 'transition', 'opposition', 'parlement', 'parliament', 'legislatives', 'presidentielle'] },
];

// What's coming next rather than background: announcements, plans, launches, deals.
const FORWARD = ['va', 'vont', 'prevoit', 'prevu', 'projet', 'lancement', 'lance', 'annonce', 'plan', 'futur', 'prochain', 'prochaine', 'bientot',
  'construction', 'signe', 'signature', 'accord', 'convention', 'will', 'plans', 'planned', 'launch', 'launches', 'expected', 'upcoming', 'to build',
  'deal', 'agreement', 'approves', 'approuve', 'adopte', 'demarrage', 'start', 'starts', 'begins', 'debut', 'nouveau', 'nouvelle', 'new',
  'etend', 'extends', 'interdiction', 'interdit', 'ban', 'bans', 'reforme', 'reform', 'mesure', 'measures', 'objectif', 'target'];

const NOT_GUINEA = /bissau|equatorial|ecuatorial|papua|new guinea|nouvelle-guinee|guinee equatoriale/;
const STOP = new Set(['les', 'des', 'une', 'pour', 'dans', 'sur', 'avec', 'par', 'est', 'sont', 'qui', 'que', 'aux', 'the', 'and', 'for', 'with',
  'from', 'that', 'this', 'are', 'was', 'its', 'guinee', 'guinea', 'guinean', 'conakry']);

const has = (text, w) => (w.includes(' ') || w.length >= 6 ? text.includes(w) : new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text));
const words = s => fold(s).replace(/['’]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Untrusted text -> plain text: no tags, no markup characters, no control characters.
export function cleanText(s, max = 300) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>"`\\]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// GDELT titles: "Guinée / Lutte contre lorpaillage illicite : le Gouvernement ( PCG ) … – Africa Guinee"
export function cleanTitle(s, domain = '') {
  let t = cleanText(s, 400)
    .replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '(')
    .replace(/(\d),\s(\d{3})\b/g, '$1,$2');
  const site = fold(domain).split('.')[0];
  const parts = t.split(/\s[–—|-]\s/);
  if (parts.length > 1 && site && fold(parts[parts.length - 1]).replace(/[^a-z0-9]/g, '').startsWith(site.replace(/[^a-z0-9]/g, '').slice(0, 6))) {
    t = parts.slice(0, -1).join(' – ');
  }
  return t.slice(0, 300).trim();
}

export function safeUrl(u) {
  try {
    const url = new URL(String(u));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const s = url.toString();
    return s.length <= 1000 && !/[<>"'`\s]/.test(s) ? s : null;
  } catch {
    return null;
  }
}

// Which subject a title is about (best weighted match), or null when it is none of ours.
export function classify(title) {
  const t = words(title);
  let best = null;
  for (const topic of TOPICS) {
    const hits = topic.words.filter(w => has(t, w)).length;
    // the subject's weight decides; extra keyword hits only break ties within it
    const score = hits ? topic.weight + Math.min(hits - 1, 2) * 0.2 : 0;
    if (hits && (!best || score > best.score)) best = { key: topic.key, label: topic.label, score };
  }
  return best;
}

export const aboutGuinea = (title, guineanOutlet) => {
  const t = words(title);
  if (NOT_GUINEA.test(t)) return false;
  return guineanOutlet || /\bguin(ee|ea|ean|eens?|eennes?)\b|conakry|simandou|kamsar|boke|siguiri|kankan|nzerekore|labe|kindia|mamou|bcrg|doumbouya/.test(t);
};

const keyWords = s => new Set(words(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w)));
export function similar(a, b) {
  const x = keyWords(a), y = keyWords(b);
  if (!x.size || !y.size) return false;
  // GDELT drops apostrophes ("lorpaillage" for "l'orpaillage"): a word with a 1-2 letter prefix still matches
  const same = (w, v) => w === v || (Math.min(w.length, v.length) >= 5 && Math.abs(w.length - v.length) <= 2 && (w.endsWith(v) || v.endsWith(w)));
  let common = 0;
  for (const w of x) if (y.has(w) || [...y].some(v => same(w, v))) common++;
  return common / Math.min(x.size, y.size) >= 0.6;
}

// GDELT "20261124T024500Z" -> ISO
export const gdeltDate = s => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
};

// Raw GDELT articles -> ranked, de-duplicated leads (at most `max`, at most 2 per subject).
// `known` = titles and urls already on the site or already staged.
export function pickLeads(raw, { known = { titles: [], urls: [] }, since = null, max = 4 } = {}) {
  const knownUrls = new Set(known.urls.map(safeUrl).filter(Boolean));
  const candidates = [];
  for (const a of raw) {
    const url = safeUrl(a.url);
    const seen = gdeltDate(a.seendate);
    const outlet = cleanText(a.domain, 100);
    const title = cleanTitle(a.title, outlet);
    if (!url || !seen || !title || title.length < 15) continue;
    if (since && seen < since) continue;
    if (!['French', 'English'].includes(a.language)) continue;
    const guinean = a.sourcecountry === 'Guinea';
    if (!aboutGuinea(title, guinean) || NOT_GUINEA.test(fold(outlet))) continue;
    const topic = classify(title);
    if (!topic) continue;
    if (knownUrls.has(url) || known.titles.some(k => similar(k, title))) continue;
    const forward = FORWARD.some(w => has(words(title), w));
    candidates.push({
      title, url, outlet, language: a.language === 'French' ? 'fr' : 'en', seen,
      topic: topic.key, topicLabel: topic.label, forwardLooking: forward,
      score: topic.score + (forward ? 1.5 : 0) + (guinean ? 0.5 : 0),
    });
  }
  candidates.sort((x, y) => y.score - x.score || y.seen.localeCompare(x.seen));
  const out = [], perTopic = {};
  for (const c of candidates) {
    if (out.length >= max) break;
    if (out.some(o => o.url === c.url || similar(o.title, c.title))) continue; // same story from another outlet
    const k = c.topicLabel;
    if ((perTopic[k] || 0) >= 2) continue;
    perTopic[k] = (perTopic[k] || 0) + 1;
    out.push(c);
  }
  return out.map(({ score, ...lead }) => lead);
}

// Markdown for the review PR. Every value is escaped: it is web text.
export function prBody(leads, { from, to, file }) {
  const md = s => String(s).replace(/[\\`*_{}\[\]()#+!|<>~@]/g, c => '\\' + c);
  const rows = leads.map((l, i) =>
    `| ${i + 1} | [${md(l.title)}](${l.url.replace(/\(/g, '%28').replace(/\)/g, '%29')}) | ${md(l.outlet)} | ${l.seen.slice(0, 10)} | ${md(l.topicLabel)}${l.forwardLooking ? ' · à venir' : ''} |`);
  return [
    `**${leads.length} news lead${leads.length > 1 ? 's' : ''} for review** — published between ${from.slice(0, 16).replace('T', ' ')} and ${to.slice(0, 16).replace('T', ' ')} UTC (source: GDELT).`,
    '',
    '| # | Headline | Outlet | Date | Subject |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    `Saved in \`${file}\`. Nothing here is published: \`staging/\` is not part of the site build.`,
    '',
    'To publish one, ask Claude to write it up as a bilingual article (with `archivable: true`); it then goes through its own pull request. Close this one when done.',
  ].join('\n');
}
