/**
 * Teach wrangler 4.149 to publish KJV MP3s from Git LFS pointers.
 * The dashboard deploy command stays `npx wrangler deploy`. `npm install`
 * applies this patch before that process starts.
 *
 * Anchors are the wrangler 4.149.0 bundle. package.json pins that version.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKER = "globalThis.__ksiagAssetOverride";

const REPLACEMENTS = [
  [
    `            manifest[normalizeFilePath(relativeFilepath)] = {
              hash: hashFile(filepath),
              size: filestat.size
            };`,
    `            const ksiagPreload = globalThis.__ksiagAssetOverride?.(filepath, filestat.size);
            manifest[normalizeFilePath(relativeFilepath)] = ksiagPreload ?? {
              hash: hashFile(filepath),
              size: filestat.size
            };`,
  ],
  [
    `    syncAssets = /* @__PURE__ */ __name(async (complianceConfig, accountId, assetDirectory, scriptName, dispatchNamespace) => {
      assert38__default.default(accountId, "Missing accountId");`,
    `    syncAssets = /* @__PURE__ */ __name(async (complianceConfig, accountId, assetDirectory, scriptName, dispatchNamespace) => {
      if (!globalThis.__ksiagAssetOverride) {
        try {
          const ksiagHookUrl = (await import("node:url")).pathToFileURL(
            path29__namespace.join(process.cwd(), "scripts/wrangler-asset-hook.mjs")
          ).href;
          await import(ksiagHookUrl).then((mod) => mod.install());
        } catch (ksiagHookErr) {
          logger.warn(
            "KJV audio asset hook did not load: " + (ksiagHookErr && ksiagHookErr.message ? ksiagHookErr.message : ksiagHookErr)
          );
        }
      }
      assert38__default.default(accountId, "Missing accountId");`,
  ],
  [
    `          const uploadedFiles = [];
          for (const manifestEntry of bucket) {
            uploadedFiles.push(manifestEntry[0]);
          }
          try {
            let res;
            let uploadGeneration;`,
    `          const uploadedFiles = [];
          for (const manifestEntry of bucket) {
            uploadedFiles.push(manifestEntry[0]);
          }
          if (globalThis.__ksiagPrepareBucket) {
            await globalThis.__ksiagPrepareBucket(
              bucket.map((manifestEntry) => [
                path29__namespace.join(assetDirectory, manifestEntry[0]),
                manifestEntry[1]
              ])
            );
          }
          try {
            let res;
            let uploadGeneration;`,
  ],
  [
    `            uploadedAssetsCount += bucket.length;`,
    `            if (globalThis.__ksiagReleaseAssets) {
              await globalThis.__ksiagReleaseAssets(
                bucket.map((manifestEntry) => path29__namespace.join(assetDirectory, manifestEntry[0]))
              );
            }
            uploadedAssetsCount += bucket.length;`,
  ],
];

export function applyWranglerPatch(source) {
  if (source.includes(MARKER)) return source;
  let out = source;
  for (const [before, after] of REPLACEMENTS) {
    const found = out.split(before).length - 1;
    if (found !== 1) {
      throw new Error(
        `Wrangler asset patch expected 1 match for wrangler 4.149.0, found ${found}. Anchor: ${before.slice(0, 90).replace(/\s+/g, " ")}`
      );
    }
    out = out.replace(before, after);
  }
  if (!out.includes(MARKER) || !out.includes("globalThis.__ksiagPrepareBucket")) {
    throw new Error("Wrangler asset patch did not insert the audio hook");
  }
  return out;
}

function cliPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules/wrangler/wrangler-dist/cli.js");
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const target = cliPath();
  if (!existsSync(target)) {
    console.log("wrangler is not installed; skipping the KJV asset-hash patch");
  } else {
    const source = readFileSync(target, "utf8");
    const patched = applyWranglerPatch(source);
    if (patched !== source) {
      writeFileSync(target, patched);
      console.log("Patched wrangler so LFS pointer MP3s use the committed Static Asset hashes.");
    }
  }
}
