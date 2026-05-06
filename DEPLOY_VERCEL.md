# Deploy to Vercel

This repo is wired for **[Vercel](https://vercel.com)** with `vercel.json` + `npm run vercel-build` (SQLite prebuild + `next build`). You complete setup in the dashboard and Git.

## What works on Vercel

- **Static UI**, **wizard**, **SQLite card search**, **Gemini grading API** whenever `data/app.db` is present at runtime (bundled via `outputFileTracingIncludes`).
- **`data/dig_cache/`** for exemplar slabs is normally **ignored by git** and is **large**. **Full DIG-backed grading may fail online** unless you refactor to Blob/R2/object storage or commit a trimmed cache (risking huge deploy size). Errors will appear at grade time when manifests/images are missing.

## Your checklist

1. **Push this repo** to GitHub (or GitLab / Bitbucket) if it is not hosted yet.

2. **Import** the repo in **[Vercel → Add New → Project](https://vercel.com/new)**.  
   - Root directory: repo root (`tag-pokemon-grader`).  
   - Framework: Next.js (**auto-detected**).  
   - Build command is already **`npm run vercel-build`** from `vercel.json` (`vercel-prebuild` + **`next build`**).

3. **SQLite data** — you need **either** committed inbox sources **or** a committed DB:
   - **Option A:** Commit  
     `data/inbox/tag_pop_all_card_urls.txt`  
     `data/inbox/tag_pop_cert_index.jsonl`  
     (paths match `getCardUrlsPath` / `getCertIndexPath` in `src/lib/config.ts`.)  
     Vercel will run **`npm run build:index`** during every build.
   - **Option B:** Run **`npm run build:index`** locally, then **`git add -f data/app.db`** and commit **`data/app.db`** (still listed in `.gitignore` locally; **`git add -f`** forces).

4. **Environment variables** in **Vercel → Project → Settings → Environment Variables** (Production / Preview):

   | Name | Required | Notes |
   |------|-----------|-------|
   | `GEMINI_API_KEY` | Yes | Google AI Studio / Gemini API key. |
   | `GEMINI_MODEL` | No | Defaults in code if unset. |
   | `POKEMONTCG_API_KEY` | No | Helps Pokémon TCG thumbnails; optional. |

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

- **Function size**: bundling **`data/dig_cache`** can exceed limits; prefer search + grade without remote slab cache unless you shrink assets or externalize storage.
- **Secrets**: never commit `.env` or `.env.local`; use dashboard env only.
