// Checks the ARTICLES entries in index.html before the site is built.
// Returns a list of problems (empty when everything is fine); build.mjs fails the build on any.
//
// Article text is inserted into the page as HTML (article cards and pages), so it must not
// contain tags: anything that looks like one is refused here.

const LANGS = ['fr', 'en'];
const TAG = /<\s*\/?\s*[a-z!?]/i;
const AUDIENCES = ['students', 'teams', 'firms'];

export function validateArticles(articles, topicKeys) {
  const errors = [];
  if (!Array.isArray(articles) || !articles.length) return ['ARTICLES is empty or missing'];
  const seen = new Set();

  articles.forEach((a, i) => {
    const where = `ARTICLES[${i}]${a && typeof a.id === 'string' ? ` (${a.id})` : ''}`;
    const bad = msg => errors.push(`${where}: ${msg}`);
    if (!a || typeof a !== 'object') return bad('not an object');

    if (typeof a.id !== 'string' || !/^[a-z0-9-]+$/.test(a.id)) bad('id must be lowercase letters, digits and dashes');
    else if (seen.has(a.id)) bad('duplicate id');
    else seen.add(a.id);

    if (typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) || isNaN(Date.parse(a.date))) bad('date must be YYYY-MM-DD');
    if (a.added !== undefined && (typeof a.added !== 'string' || isNaN(Date.parse(a.added)))) bad('added must be an ISO date-time');
    if (!topicKeys.includes(a.topic)) bad(`topic must be one of ${topicKeys.join(', ')}`);
    if (typeof a.verified !== 'boolean') bad('verified must be true or false');
    for (const flag of ['hidden', 'hub', 'archivable']) if (a[flag] !== undefined && typeof a[flag] !== 'boolean') bad(`${flag} must be true or false`);

    const text = (field, s) => {
      if (typeof s !== 'string' || !s.trim()) return bad(`${field} is empty`);
      if (TAG.test(s)) bad(`${field} contains HTML`);
    };
    for (const field of ['title', 'summary', 'topicLabel']) {
      for (const l of LANGS) text(`${field}.${l}`, a[field] && a[field][l]);
    }
    for (const field of ['howto', 'takeaways']) {
      for (const l of LANGS) {
        const list = a[field] && a[field][l];
        if (!Array.isArray(list) || !list.length) { bad(`${field}.${l} must be a non-empty list`); continue; }
        list.forEach((s, j) => text(`${field}.${l}[${j}]`, s));
      }
    }

    // Optional per-audience advice: { students|teams|firms: { fr: [...], en: [...] } }
    if (a.audiences !== undefined) {
      const keys = a.audiences && typeof a.audiences === 'object' ? Object.keys(a.audiences) : [];
      if (!keys.length) bad('audiences must be an object with students, teams and/or firms');
      for (const k of keys) {
        if (!AUDIENCES.includes(k)) { bad(`audiences.${k} is not one of ${AUDIENCES.join(', ')}`); continue; }
        for (const l of LANGS) {
          const list = a.audiences[k] && a.audiences[k][l];
          if (!Array.isArray(list) || !list.length) { bad(`audiences.${k}.${l} must be a non-empty list`); continue; }
          list.forEach((s, j) => text(`audiences.${k}.${l}[${j}]`, s));
        }
      }
    }

    const checkSource = (field, src) => {
      if (!src || typeof src !== 'object') return bad(`${field} is missing`);
      text(`${field}.name`, src.name);
      if (typeof src.url !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(src.url)) bad(`${field}.url must be an https:// link`);
    };
    checkSource('source', a.source);
    if (a.moreSources !== undefined) {
      if (!Array.isArray(a.moreSources) || !a.moreSources.length) bad('moreSources must be a non-empty list');
      else a.moreSources.forEach((src, j) => checkSource(`moreSources[${j}]`, src));
    }
  });
  return errors;
}
