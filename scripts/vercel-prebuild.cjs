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
  console.log(
    "[vercel-prebuild] No inbox CSV/JSONL and no app.db → empty SQLite schema"
  );
  execSync("npx tsx scripts/ensure-empty-db.ts", {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
} else {
  console.log("[vercel-prebuild] Using committed data/app.db");
}
