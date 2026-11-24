# Diankana Cloud — diankanacloud.com

Bilingual (FR/EN) guides on tech, mining and oil, published at https://diankanacloud.com.

## How the site is built

- **`index.html` is the only page source.** Articles, About, Contact, Privacy and the Ask search all live in it.
- `npm run build` creates `dist/`: the stylesheet, one ready-made HTML page per address
  (`/`, `/topics/`, `/articles/<id>/` …), `sitemap.xml` and `robots.txt`.
- GitHub Actions (`.github/workflows/pages.yml`) runs the build and publishes `dist/` on every push to `main`.
  You never commit `dist/`.

## Editing

1. Edit `index.html` (for a new article, add an entry to `ARTICLES` with a unique `id`, a `date: "YYYY-MM-DD"`,
   and `verified: false` until it has been reviewed).
2. Preview locally:
   ```bash
   npm install          # first time only
   npm run build
   python3 -m http.server -d dist 8000   # then open http://localhost:8000
   ```
3. Commit and push to `main`; the site updates in about a minute.

## Other files

- `firestore.rules` — security rules for comments and contact messages. Publish changes in the
  Firebase console (Firestore → Rules); pushing to GitHub does not update them.
- `data/wikipedia-guinea.*.json` — text of the Wikipedia "Guinea" article used by Ask (CC BY-SA 4.0).
