# staging/

News leads found by the content refresh job (`.github/workflows/content-refresh.yml`,
`scripts/refresh/`). They are **not published**: the site build only copies `img/` and
`data/`, never this folder.

Each run that finds something new opens a draft pull request with one
`leads-<date>.json` file. Each lead has the headline, link, outlet, date and a
suggested subject. No article text is copied.

To publish a story, have it written up as a bilingual `ARTICLES` entry with
`archivable: true` (it then moves to Archives 30 days after its date) in its own
pull request. Merging or closing the leads PR changes nothing on the site; merged
lead files are only used so later runs don't stage the same story again.
