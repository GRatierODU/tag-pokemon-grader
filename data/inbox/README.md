# Inbox inputs for `npm run build:index`

Put these here (or supply them via **`VERCEL_INBOX_TAR_GZ_URL`** on Vercel — see **`DEPLOY_VERCEL.md`**):

- `tag_pop_all_card_urls.txt`
- `tag_pop_cert_index.jsonl`

**Tarball for Vercel env** (paths must be exactly these names at the archive root after extract):

```bash
cd data/inbox
tar czvf ../../inbox-for-vercel.tgz tag_pop_all_card_urls.txt tag_pop_cert_index.jsonl
```

Alternatively, run `npm run build:index` locally and commit `data/app.db` with `git add -f data/app.db`.
