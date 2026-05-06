"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = process.cwd();

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

const urls = exists("data/inbox/tag_pop_all_card_urls.txt");
const certs = exists("data/inbox/tag_pop_cert_index.jsonl");
const db = exists("data/app.db");

if (urls && certs) {
  console.log("[vercel-prebuild] Found inbox sources → npm run build:index");
  execSync("npm run build:index", {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  if (!exists("data/app.db")) {
    console.error("[vercel-prebuild] build:index did not create data/app.db");
    process.exit(1);
  }
} else if (!db) {
  console.error(
    [
      "[vercel-prebuild] Missing SQLite DB for deployment.",
      "Add one of:",
      '  • data/inbox/tag_pop_all_card_urls.txt + data/inbox/tag_pop_cert_index.jsonl (index is built on Vercel), or',
      "  • data/app.db (run `npm run build:index` locally, then git add -f data/app.db).",
      "See DEPLOY_VERCEL.md.",
    ].join("\n")
  );
  process.exit(1);
} else {
  console.log("[vercel-prebuild] Using committed data/app.db");
}
