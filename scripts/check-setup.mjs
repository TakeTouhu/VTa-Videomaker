/**
 * Runs before `npm run dev` and `npm run build`.
 *
 * Without it, a missing install surfaces as Windows' "'vite' is not recognised
 * as an internal or external command", which says nothing about what to do.
 * Uses only Node built-ins, because it has to work when nothing is installed.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Checking for vite specifically catches a half-finished or dev-less install,
// which an existence check on node_modules alone would miss.
const installed = existsSync(join(root, "node_modules", "vite"));

if (!installed) {
  console.error(`
  セットアップがまだ完了していません。

  このフォルダで次を実行してください（初回のみ、数分かかります）:

      npm install

  そのあと、もう一度:

      npm run dev

  Windowsをお使いなら、start-windows.bat をダブルクリックすると
  この手順をまとめて実行します。
`);
  process.exit(1);
}
