# Deploy to Vercel

This repo is wired for **[Vercel](https://vercel.com)** with `vercel.json` + `npm run vercel-build` (SQLite prebuild + `next build`). You complete setup in the dashboard and Git.

## What works on Vercel

- **Static UI**, **wizard**, **SQLite card search**, **Gemini grading API** whenever `data/app.db` is present at runtime (bundled via `outputFileTracingIncludes`).
- **TAG DIG exemplar slabs** for grading load from **`DIG_EXEMPLAR_BASE_URL`** (HTTPS object storage/CDN). Layout mirrors local `dig_cache`: `{base}/{optional prefix}/{cert_id}/manifest.json` and `{base}/{optional prefix}/{cert_id}/{image file}`. If **`DIG_EXEMPLAR_BASE_URL`** is unset, the app reads from **`DIG_CACHE_ROOT`** / **`data/dig_cache/`** (typical laptop dev).

## SQLite index build on Vercel (`build:index`)

During **`npm run vercel-build`**, **`scripts/vercel-prebuild.cjs`** runs **before** **`next build`** and:

1. **Optional — private inbox archive:** if **`VERCEL_INBOX_TAR_GZ_URL`** (or **`VERCEL_INBOX_ARCHIVE_URL`**) is set on the Vercel project, it downloads that **HTTPS** URL and extracts a **gzip tar** into **`data/inbox/`** (e.g. signed URL to Vercel Blob, S3, or a GitHub release asset).

   Package the two filenames expected by **`src/lib/config.ts`**:

   ```bash
   cd data/inbox
   tar czvf ../../inbox-for-vercel.tgz tag_pop_all_card_urls.txt tag_pop_cert_index.jsonl
   ```

   Upload **`inbox-for-vercel.tgz`** to your host, set **`VERCEL_INBOX_TAR_GZ_URL`** in Vercel (Production / Preview as needed).

   Optional **`VERCEL_INBOX_ARCHIVE_MAX_MB`** (default **750**) caps download size.

2. If **`tag_pop_all_card_urls.txt`** and **`tag_pop_cert_index.jsonl`** exist under **`data/inbox/`** (from Git or step 1), **`npm run build:index`** runs and writes **`data/app.db`** for that deployment.

3. If only **`data/app.db`** is present (committed with **`git add -f`**), **`build:index`** is skipped.

4. If there are no inbox inputs and no **`app.db`**, an **empty-schema** **`app.db`** is created — search stays empty until you add real data (**A**, **B**, or **C** below).

**Git LFS:** `tag_pop_cert_index.jsonl` can exceed GitHub’s **100 MB** per-file cap, so it is tracked with **Git LFS** (see **`.gitattributes`**). On Vercel, enable **Git Large File Storage** in the project’s **Git** settings. **`vercel.json`** uses **`git lfs install && git lfs pull && npm install`** so the real JSONL exists before **`build:index`**. If only the small LFS pointer is checked out, indexing fails silently or with parse errors.

## Remote DIG exemplars (production)

1. **Upload** your local `data/dig_cache/<cert_id>/` trees to object storage (R2, S3, Vercel Blob, etc.) so each cert folder keeps **`manifest.json`** and the image files referenced there (same names as after `ingest-dig`).

2. **Set** **`DIG_EXEMPLAR_BASE_URL`** to the stable HTTPS origin that serves those folders, **without** a trailing slash (e.g. `https://pub-….r2.dev/dig` or your Blob public base).

3. **Locales / datasets:** use **`DIG_EXEMPLAR_PATH_PREFIX`** so English vs Japanese (or versioned drops) live under different prefixes without changing code — e.g. `en`, `ja`, `2026/full`. Resolved URLs become `{base}/{prefix}/{cert_id}/manifest.json`.

4. **Private buckets:** set **`DIG_EXEMPLAR_FETCH_AUTHORIZATION`** to a full **`Authorization`** header value the storage expects (`Bearer …`, vendor token, etc.). Public buckets leave it unset.

5. **`DIG_EXEMPLAR_BASE_URL` wins over disk:** leave it unset locally to keep using **`data/dig_cache/`**; set it on **Vercel** for serverless grading.

## Your checklist

1. **Push this repo** to GitHub (or GitLab / Bitbucket) if it is not hosted yet.

2. **Import** the repo in **[Vercel → Add New → Project](https://vercel.com/new)**.  
   - Root directory: repo root (`tag-pokemon-grader`).  
   - Framework: Next.js (**auto-detected**).  
   - Build command is already **`npm run vercel-build`** from `vercel.json` (**`vercel-prebuild`** can run **`build:index`**, then **`next build`**).

3. **SQLite data** — for **indexed search**, pick one:

   - **Option A:** Commit **`data/inbox/tag_pop_all_card_urls.txt`** and **`data/inbox/tag_pop_cert_index.jsonl`** (paths match **`getCardUrlsPath` / `getCertIndexPath`**). Each Vercel build runs **`npm run build:index`**.

   - **Option B:** Set **`VERCEL_INBOX_TAR_GZ_URL`** to an HTTPS **`.tgz`** of those two files (see **SQLite index build on Vercel** above).

   - **Option C:** Run **`npm run build:index`** locally, then **`git add -f data/app.db`** and commit **`data/app.db`**.

   - **None of the above:** deploy still succeeds with an **empty-schema** DB; search has no rows until you add **A**, **B**, or **C**.

4. **Environment variables** in **Vercel → Project → Settings → Environment Variables** (Production / Preview):

   | Name | Required | Notes |
   |------|-----------|-------|
   | `GEMINI_API_KEY` | Yes | Google AI Studio / Gemini API key. |
   | `GEMINI_MODEL` | No | Defaults in code if unset. |
   | `POKEMONTCG_API_KEY` | No | Helps Pokémon TCG thumbnails; optional. |
   | `VERCEL_INBOX_TAR_GZ_URL` | No | HTTPS URL to gzip-tar of the two inbox files; extract + **`build:index`** on each deploy. |
   | `VERCEL_INBOX_ARCHIVE_MAX_MB` | No | Max download size in MiB (default **750**). |
   | `DIG_EXEMPLAR_BASE_URL` | **Yes for graded exemplars on Vercel** | `https://…` origin mirroring **`dig_cache/<cert_id>/`**. Omit locally to read disk. |
   | `DIG_EXEMPLAR_PATH_PREFIX` | No | Extra path segments before cert folders (`en`, `ja`, …). |
   | `DIG_EXEMPLAR_FETCH_AUTHORIZATION` | No | `Authorization` header for private CDN/storage. |

5. Click **Deploy**. After green: open the **`*.vercel.app`** URL.

6. **Local `vercel deploy` and `data/dig_cache/`** — The CLI walks the tree and applies ignore rules relative to each folder, so a root pattern like `data/dig_cache/**` does **not** strip the thousands of files inside that directory. **Either:** push to Git and let Vercel build from the remote clone (recommended; `dig_cache` stays untracked), **or** keep slabs **outside the repo** by setting **`DIG_CACHE_ROOT`** to an absolute path **outside** `tag-pokemon-grader` so the cache is never uploaded.

7. If **`vercel`** reports **api-upload-free** / **missing_archive** (many small files or rate limits), wait out the cooldown or rely on **Git-connected** deploys. **`--archive=tgz`** can reduce upload chatter once the tree is small enough.

8. **`allowedDevOrigins`** in `next.config.ts` is for dev tunnels only; production is unaffected.

## Optional: CLI

Install [Vercel CLI](https://vercel.com/docs/cli), then from the repo:

```bash
npx vercel login
npx vercel link
npx vercel env pull .env.vercel.preview   # optional
npx vercel deploy --prod --archive=tgz
```

Set the same env vars in the CLI flow or dashboard.

## Limits

- **Function time / egress**: grading fetches manifests + images per exemplar — expect extra latency versus local disk.
- **Secrets**: never commit `.env` or `.env.local`; use dashboard env only.
