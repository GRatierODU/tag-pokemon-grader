# Inbox inputs for `npm run build:index`

Commit these filenames here so **Vercel** can generate `data/app.db` at build time (see `DEPLOY_VERCEL.md`):

- `tag_pop_all_card_urls.txt`
- `tag_pop_cert_index.jsonl`

Alternatively, build SQLite locally (`npm run build:index`) and commit `data/app.db` with `git add -f data/app.db`.
