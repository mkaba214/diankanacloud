// node --test scripts/refresh/leads.test.mjs  (no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, cleanTitle, safeUrl, classify, aboutGuinea, similar, gdeltDate, pickLeads, prBody } from './leads.mjs';

const art = (title, extra = {}) => ({
  title, url: `https://africaguinee.com/${encodeURIComponent(title.slice(0, 20))}`, domain: 'africaguinee.com',
  seendate: '20261124T024500Z', language: 'French', sourcecountry: 'Guinea', ...extra,
});

test('cleanText strips tags, markup characters and control characters', () => {
  assert.equal(cleanText('Bauxite <script>alert(1)</script> news'), 'Bauxite alert(1) news');
  assert.equal(cleanText('a<b "c" `d`\u0000e'), 'ab c d e');
  assert.equal(cleanText('x'.repeat(500)).length, 300);
});

test('cleanTitle fixes GDELT spacing and drops the outlet suffix', () => {
  assert.equal(cleanTitle('Pharmacie centrale de Guinée ( PCG ) : le Dr perd son poste … – Africa Guinee', 'africaguinee.com'),
    'Pharmacie centrale de Guinée (PCG) : le Dr perd son poste …');
  assert.equal(cleanTitle('La Police veut rapprocher ses agents – Guinee7 . com', 'guinee7.com'), 'La Police veut rapprocher ses agents');
  assert.equal(cleanTitle('Détournement de 3 , 135 tonnes dor', 'x.com'), 'Détournement de 3,135 tonnes dor');
});

test('safeUrl keeps only plain http(s) links', () => {
  assert.equal(safeUrl('https://guinee7.com/a?b=1'), 'https://guinee7.com/a?b=1');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.org', 'https://user:pw@x.org', 'not a url']) {
    assert.equal(safeUrl(bad), null, bad);
  }
  assert.equal(safeUrl('https://x.org/"onmouseover'), 'https://x.org/%22onmouseover', 'quotes come out encoded');
});

test('classify picks the site subject; politics only when nothing else fits', () => {
  assert.equal(classify('Guinée / Lutte contre lorpaillage illicite').key, 'mines');
  assert.equal(classify('Simandou : premier navire de minerai de fer').key, 'mines');
  assert.equal(classify('Prix du carburant à la pompe').key, 'petrole');
  assert.equal(classify('La BCRG relève son taux directeur').key, 'finance');
  assert.equal(classify('Orange Guinée lance la fibre à Kankan').key, 'tech');
  const p = classify('Remaniement : le président nomme un nouveau ministre');
  assert.equal(p.key, null);
  assert.equal(p.label, 'Politique');
  assert.ok(classify('Remaniement au ministère : nouveau ministre des Mines').key === 'mines', 'a site subject beats politics');
  assert.equal(classify('Procès pour viol au TPI de Dixinn'), null);
  assert.equal(classify('Golden retriever wins dog show'), null, 'short keywords match whole words only');
});

test('aboutGuinea rejects the other Guineas', () => {
  assert.ok(aboutGuinea('Guinea bauxite exports rise', false));
  assert.ok(aboutGuinea('Les mines de Boké', true));
  assert.ok(!aboutGuinea('Guinea-Bissau election results', false));
  assert.ok(!aboutGuinea('Equatorial Guinea oil output', true));
  assert.ok(!aboutGuinea('Papua New Guinea mining law', false));
  assert.ok(!aboutGuinea('Ghana gold output', false));
});

test('similar spots the same story told twice', () => {
  assert.ok(similar('Lutte contre lorpaillage illicite : le Gouvernement étend linterdiction',
    'Orpaillage illicite : le gouvernement étend l’interdiction à tout le pays'));
  assert.ok(!similar('Bauxite : les exportations augmentent', 'Carburant : hausse du prix à la pompe'));
});

test('gdeltDate', () => {
  assert.equal(gdeltDate('20261124T024500Z'), '2026-11-24T02:45:00Z');
  assert.equal(gdeltDate('bad'), null);
});

test('pickLeads: relevant, new, deduplicated, at most 4 and 2 per subject', () => {
  const raw = [
    art('Bauxite : la CBG va construire un nouveau port à Kamsar'),
    art('Bauxite : la CBG va construire un nouveau port à Kamsar – Africa Guinee', { url: 'https://guinee7.com/cbg', domain: 'guinee7.com' }),
    art('Simandou : le premier train de minerai de fer est arrivé'),
    art('Orpaillage illicite : interdiction étendue à tout le pays'),
    art('Prix du carburant : la SONAP annonce une baisse'),
    art('La BCRG prévoit une nouvelle politique monétaire'),
    art('Procès pour viol au tribunal de Dixinn'),
    art('Guinea-Bissau election : results', { language: 'English', sourcecountry: 'Guinea-Bissau' }),
    art('Equatorial Guinea oil output rises sharply', { language: 'English', sourcecountry: 'Equatorial Guinea' }),
    art('Pétrole : nouvelle station à Kindia', { language: 'Spanish' }),
    art('Ancien article sur la bauxite de Boké', { seendate: '20261101T000000Z' }),
    art('Bad link bauxite story of the day', { url: 'javascript:alert(1)' }),
  ];
  const leads = pickLeads(raw, { since: '2026-11-20T00:00:00Z', known: { titles: ['Simandou : le premier train de minerai de fer est arrivé'], urls: [] } });
  const titles = leads.map(l => l.title);
  assert.equal(leads.length, 4);
  assert.equal(titles.filter(t => /CBG/.test(t)).length, 1, 'same story from two outlets staged once');
  assert.ok(!titles.some(t => /premier train/.test(t)), 'already on the site');
  assert.ok(!titles.some(t => /viol|Bissau|Equatorial|Kindia|Ancien|Bad link/.test(t)));
  assert.ok(leads.filter(l => l.topic === 'mines').length <= 2);
  for (const l of leads) {
    assert.deepEqual(Object.keys(l).sort(), ['forwardLooking', 'language', 'outlet', 'seen', 'title', 'topic', 'topicLabel', 'url']);
    assert.match(l.url, /^https:\/\//);
  }
  assert.deepEqual(pickLeads([], {}), [], 'nothing new -> nothing staged');
});

test('prBody escapes web text and never mentions anyone', () => {
  const body = prBody([{ title: 'Hack [x](javascript:1) @someone | `code`', url: 'https://x.org/a(b)', outlet: 'x.org',
    seen: '2026-11-24T02:45:00Z', topicLabel: 'Mines', forwardLooking: true }], { from: '2026-11-22T00:00:00Z', to: '2026-11-25T00:00:00Z', file: 'staging/x.json' });
  assert.ok(body.includes('\\[x\\]\\(javascript:1\\)'));
  assert.ok(body.includes('\\@someone'));
  assert.ok(body.includes('(https://x.org/a%28b%29)'));
  assert.ok(!/\| `code` \|/.test(body));
});
