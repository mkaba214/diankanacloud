// Builds the publishable site into dist/.
//
//   npm run build            -> dist/ (what GitHub Pages serves)
//   python3 -m http.server -d dist 8000   -> preview at http://localhost:8000
//
// index.html stays the single source. For every page (/, /topics/, /articles/<id>/ ...)
// the script runs the page's own JavaScript in jsdom and saves the rendered HTML, so each
// address has its real content, title and description for Google and AdSense.
import { JSDOM, VirtualConsole } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://diankanacloud.com';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const rel = p => path.join(ROOT, p);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });

// 1. Stylesheet (Tailwind v3, scans index.html) + content hash for cache busting
execFileSync(path.join(ROOT, 'node_modules/.bin/tailwindcss'),
  ['-c', 'tailwind.config.js', '-i', 'styles/tailwind.input.css', '-o', 'dist/assets/site.css', '--minify'],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
const cssHash = createHash('sha256').update(fs.readFileSync(path.join(DIST, 'assets/site.css'))).digest('hex').slice(0, 10);

// 2. Static files
for (const dir of ['img', 'data']) fs.cpSync(rel(dir), path.join(DIST, dir), { recursive: true });
fs.copyFileSync(rel('CNAME'), path.join(DIST, 'CNAME'));
if (fs.existsSync(rel('ads.txt'))) fs.copyFileSync(rel('ads.txt'), path.join(DIST, 'ads.txt'));

const source = fs.readFileSync(rel('index.html'), 'utf8')
  .replace('href="/assets/site.css"', `href="/assets/site.css?v=${cssHash}"`);
if (!source.includes(`site.css?v=${cssHash}`)) throw new Error('stylesheet <link href="/assets/site.css"> not found in index.html');

// 3. Render one page
const quiet = new VirtualConsole();   // jsdom can't scroll or load Firebase; that's fine here
async function render(urlPath) {
  const dom = new JSDOM(source, { url: SITE + urlPath, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet });
  const { window } = dom;
  await new Promise(r => window.setTimeout(r, 50));
  return dom;
}

function finish(dom, { title, description, canonical, noindex = false }) {
  const { document } = dom.window;
  // drop anything that only makes sense live in a browser
  for (const id of ['comments-wrap', 'ask-answer']) { const e = document.getElementById(id); if (e) e.innerHTML = ''; }
  document.title = title;
  const head = document.head;
  const meta = (attr, key, content) => {
    const m = document.createElement('meta'); m.setAttribute(attr, key); m.setAttribute('content', content); head.appendChild(m);
  };
  meta('name', 'description', description);
  if (noindex) meta('name', 'robots', 'noindex');
  if (canonical) {
    const l = document.createElement('link'); l.rel = 'canonical'; l.href = canonical; head.appendChild(l);
    meta('property', 'og:url', canonical);
  }
  meta('property', 'og:site_name', 'Diankana Cloud');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:type', canonical && canonical.includes('/articles/') ? 'article' : 'website');
  meta('property', 'og:locale', 'fr_FR');
  meta('property', 'og:image', SITE + '/img/og-image.png');
  meta('property', 'og:image:width', '1200');
  meta('property', 'og:image:height', '630');
  meta('name', 'twitter:card', 'summary_large_image');
  const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  dom.window.close();
  return html;
}

function write(urlPath, html) {
  const file = path.join(DIST, urlPath, urlPath.endsWith('.html') ? '' : 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// 4. Pages
const PAGES = {
  '/':          ['Diankana Cloud — Tech · Mines · Pétrole',
                 "Guides pratiques en français et en anglais sur la tech, les mines et le pétrole en Guinée, rédigés avec l'aide de l'IA et vérifiés avant publication."],
  '/topics/':   ['Sujets — Diankana Cloud', 'Tous les guides Diankana Cloud : technologie et certifications cloud, mines (bauxite, fer, or) et pétrole en Guinée.'],
  '/world/':   ['Ce qui se passe dans le monde — Diankana Cloud', "L'actualité internationale qui compte pour la tech, l'énergie et l'économie, résumée simplement en français et en anglais, avec ses sources."],
  '/ask/':      ["Demander à l'IA — Diankana Cloud", "Posez une question sur la Guinée ou sur nos guides : réponses tirées de nos articles et de l'article Wikipédia sur la Guinée."],
  '/about/':    ['À propos — Diankana Cloud', 'Diankana Cloud est le projet personnel de Mohamed Kaba, consultant IT basé à New York, pour partager des guides utiles à la jeunesse guinéenne.'],
  '/contact/':  ['Contact — Diankana Cloud', 'Une idée de sujet, une source à proposer, une correction à signaler ? Écrivez à Diankana Cloud.'],
  '/privacy/':  ['Politique de confidentialité — Diankana Cloud', 'Quelles données Diankana Cloud collecte, pourquoi, où elles sont stockées et comment exercer vos droits.'],
};

const urls = [];
const today = new Date().toISOString().slice(0, 10);
let articles = [];

for (const [urlPath, [title, description]] of Object.entries(PAGES)) {
  const dom = await render(urlPath);
  if (urlPath === '/') articles = dom.window.eval('ARTICLES.map(a => ({id: a.id, date: a.date, title: a.title.fr, summary: a.summary.fr}))');
  write(urlPath, finish(dom, { title, description, canonical: SITE + urlPath }));
  urls.push({ loc: SITE + urlPath, lastmod: today });
}

for (const a of articles) {
  const urlPath = `/articles/${a.id}/`;
  const dom = await render(urlPath);
  const active = dom.window.document.querySelector('.view.active');
  if (!active || active.id !== 'view-article') throw new Error(`article page ${urlPath} did not render`);
  write(urlPath, finish(dom, { title: `${a.title} — Diankana Cloud`, description: a.summary, canonical: SITE + urlPath }));
  urls.push({ loc: SITE + urlPath, lastmod: a.date || today });
}

// 404: the home page, not indexed (GitHub Pages serves it for unknown addresses)
write('/404.html', finish(await render('/'), { title: 'Page introuvable — Diankana Cloud',
  description: "Cette page n'existe pas.", canonical: null, noindex: true }));

// 5. sitemap.xml and robots.txt
fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n') + '\n</urlset>\n');
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`Built ${urls.length} pages + 404 into dist/ (site.css?v=${cssHash})`);
