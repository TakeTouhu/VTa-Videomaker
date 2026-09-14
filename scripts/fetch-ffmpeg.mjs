/**
 * Downloads ffmpeg and ffprobe into src-tauri/bin so they ship with the app.
 *
 *   npm run fetch-ffmpeg
 *
 * Optional: without it the app falls back to whatever is on PATH. The binaries
 * are gitignored - they are far too large to commit, and every build should
 * fetch a known version rather than carry a stale one.
 *
 * Licensing: the builds fetched here are GPL. Redistributing them with the app
 * means the whole bundle is under the GPL, so make the corresponding source
 * available. Use an LGPL build, or skip bundling, if that does not suit.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(ROOT, "src-tauri", "bin");

/** Pinned so a build is reproducible rather than "whatever is current". */
const SOURCES = {
  win32:
    "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip",
  linux:
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
  darwin: null, // Homebrew or an official build; see the README in src-tauri/bin.
};

const platform = process.platform;
const url = SOURCES[platform];

if (!url) {
  console.error(
    `${platform} 向けの自動取得には対応していません。` +
      `ffmpeg と ffprobe を手動で ${BIN_DIR} に置いてください。`,
  );
  process.exit(1);
}

const exe = platform === "win32" ? ".exe" : "";
mkdirSync(BIN_DIR, { recursive: true });

if (existsSync(join(BIN_DIR, `ffmpeg${exe}`)) && existsSync(join(BIN_DIR, `ffprobe${exe}`))) {
  console.log("ffmpeg と ffprobe はすでに配置されています。");
  process.exit(0);
}

const work = join(tmpdir(), `ave-ffmpeg-${process.pid}`);
mkdirSync(work, { recursive: true });

console.log(`ダウンロード中: ${url}`);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok || !response.body) {
  console.error(`ダウンロードに失敗しました (HTTP ${response.status})`);
  process.exit(1);
}

const archiveName = url.endsWith(".zip") ? "ffmpeg.zip" : "ffmpeg.tar.xz";
const archive = join(work, archiveName);
await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));

console.log("展開中…");
// tar handles both zip and tar.xz, and has shipped with Windows since 10 1803.
execFileSync("tar", ["-xf", archive, "-C", work], { stdio: "inherit" });

/** Finds a named executable anywhere in the extracted tree. */
function findBinary(directory, name) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      const found = findBinary(full, name);
      if (found) return found;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

let moved = 0;
for (const name of [`ffmpeg${exe}`, `ffprobe${exe}`]) {
  const found = findBinary(work, name);
  if (!found) {
    console.error(`展開したアーカイブに ${name} が見つかりませんでした。`);
    continue;
  }
  renameSync(found, join(BIN_DIR, name));
  if (platform !== "win32") execFileSync("chmod", ["+x", join(BIN_DIR, name)]);
  moved += 1;
}

rmSync(work, { recursive: true, force: true });

if (moved === 2) {
  console.log(`配置しました: ${BIN_DIR}`);
} else {
  console.error("一部のファイルを配置できませんでした。");
  process.exit(1);
}
