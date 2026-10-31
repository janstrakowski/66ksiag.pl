#!/usr/bin/env node
/**
 * Upload a signed Android App Bundle (.aab) to Google Play via the
 * Google Play Android Developer API v3 (`androidpublisher.googleapis.com`).
 *
 * Supports two non-production upload modes:
 * 1. Internal App Sharing (`uploadBundleToInternalAppSharing`, default for all
 *    non-`main` branch builds):
 *    POST /upload/androidpublisher/v3/applications/internalappsharing/${packageName}/artifacts/bundle?uploadType=media
 *    Returns `{ downloadUrl, certificateFingerprint, sha256 }` and optionally
 *    writes `dist/android-preview.json` so `https://<branch>.66ksiag.pl/android-preview.json`
 *    exposes the Play Store Internal App Sharing install link.
 * 2. Internal Testing track (`uploadBundleToInternalTrack`, `--mode track`):
 *    Strictly restricted to the `internal` track — refuses any other track.
 *    Automatically falls back from `status: "completed"` to `status: "draft"`
 *    when Play Console reports that the app is still a draft / unreviewed app.
 */
import { createSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ALLOWED_TRACK = "internal";
const DEFAULT_PACKAGE_NAME = "com.jastrakowski.sixsixksiag";
const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://androidpublisher.googleapis.com";
const MAX_PLAY_VERSION_CODE = 2_100_000_000;

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseServiceAccountCredentials(rawInput) {
  if (!rawInput || typeof rawInput !== "string" || !rawInput.trim()) {
    throw new Error(
      "Missing PLAY_SERVICE_ACCOUNT_JSON. Provide the Google Cloud service account JSON (raw JSON, base64-encoded JSON, or a file path)."
    );
  }
  const trimmed = rawInput.trim();
  let jsonText = trimmed;

  if (!trimmed.startsWith("{")) {
    if (existsSync(trimmed) && statSync(trimmed).isFile()) {
      jsonText = readFileSync(trimmed, "utf8");
    } else {
      try {
        const decoded = Buffer.from(trimmed.replace(/\s+/g, ""), "base64").toString("utf8");
        if (decoded.trim().startsWith("{")) {
          jsonText = decoded;
        }
      } catch {
        // Fall through to JSON.parse error message below.
      }
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`PLAY_SERVICE_ACCOUNT_JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("PLAY_SERVICE_ACCOUNT_JSON must parse to a JSON object.");
  }
  if (typeof parsed.client_email !== "string" || !parsed.client_email.includes("@")) {
    throw new Error("PLAY_SERVICE_ACCOUNT_JSON is missing a valid client_email.");
  }
  if (typeof parsed.private_key !== "string" || !parsed.private_key.includes("PRIVATE KEY")) {
    throw new Error("PLAY_SERVICE_ACCOUNT_JSON is missing a valid PEM private_key.");
  }

  return {
    client_email: parsed.client_email.trim(),
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    token_uri: typeof parsed.token_uri === "string" && parsed.token_uri.trim() ? parsed.token_uri.trim() : DEFAULT_TOKEN_URI,
    project_id: typeof parsed.project_id === "string" ? parsed.project_id.trim() : "",
  };
}

export function createServiceAccountJwt(credentials, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: credentials.token_uri || DEFAULT_TOKEN_URI,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(credentials.private_key);
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

export function computeNextVersionCode({
  remoteMaxVersionCode = 0,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
  explicitVersionCode = null,
} = {}) {
  const remoteMax = Number.isFinite(Number(remoteMaxVersionCode)) ? Math.max(0, Math.trunc(Number(remoteMaxVersionCode))) : 0;
  if (explicitVersionCode !== null && explicitVersionCode !== undefined && String(explicitVersionCode).trim() !== "") {
    const parsed = Number.parseInt(String(explicitVersionCode).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_PLAY_VERSION_CODE) {
      throw new Error(`Invalid explicit versionCode: ${explicitVersionCode}`);
    }
    return Math.max(parsed, remoteMax + 1);
  }
  const timestampCode = Math.max(3, Math.trunc(Number(nowEpochSeconds)));
  const next = Math.max(timestampCode, remoteMax + 1);
  if (next > MAX_PLAY_VERSION_CODE) {
    throw new Error(`Computed versionCode ${next} exceeds Google Play limit ${MAX_PLAY_VERSION_CODE}`);
  }
  return next;
}

export function extractHighestTrackVersionCode(trackResponse) {
  if (!trackResponse || typeof trackResponse !== "object" || !Array.isArray(trackResponse.releases)) {
    return 0;
  }
  let maxCode = 0;
  for (const release of trackResponse.releases) {
    if (!release || !Array.isArray(release.versionCodes)) continue;
    for (const code of release.versionCodes) {
      const n = Number.parseInt(String(code), 10);
      if (Number.isFinite(n) && n > maxCode) {
        maxCode = n;
      }
    }
  }
  return maxCode;
}

export function shouldFallbackToDraftRelease(statusCode, errorBodyText) {
  if (statusCode !== 400 && statusCode !== 403 && statusCode !== 422) {
    return false;
  }
  const text = String(errorBodyText || "").toLowerCase();
  return (
    text.includes("draft app") ||
    text.includes("draft release") ||
    text.includes("releases with status draft") ||
    text.includes("only releases with status draft may be created") ||
    text.includes("app is in draft") ||
    text.includes("not yet published") ||
    text.includes("cannot be published") ||
    text.includes("must have status draft")
  );
}

export function assertInternalTrackOnly(track) {
  const normalized = String(track ?? ALLOWED_TRACK).trim();
  if (normalized !== ALLOWED_TRACK) {
    throw new Error(
      `Refusing to upload to Google Play track "${normalized}". This repository only permits uploads to "${ALLOWED_TRACK}" (Internal testing).`
    );
  }
  return ALLOWED_TRACK;
}

export function buildTrackUpdatePayload({
  versionCode,
  releaseStatus = "completed",
  releaseName = "",
  releaseNotesPl = "",
  releaseNotesEn = "",
}) {
  if (releaseStatus !== "completed" && releaseStatus !== "draft") {
    throw new Error(`Unsupported releaseStatus "${releaseStatus}". Expected "completed" or "draft".`);
  }
  const release = {
    versionCodes: [String(versionCode)],
    status: releaseStatus,
  };
  if (releaseName) {
    release.name = String(releaseName);
  }
  const notes = [];
  if (releaseNotesPl) {
    notes.push({ language: "pl-PL", text: String(releaseNotesPl).slice(0, 500) });
  }
  if (releaseNotesEn) {
    notes.push({ language: "en-US", text: String(releaseNotesEn).slice(0, 500) });
  }
  if (notes.length > 0) {
    release.releaseNotes = notes;
  }
  return {
    track: ALLOWED_TRACK,
    releases: [release],
  };
}

export async function fetchAccessToken(credentials, fetchImpl = fetch) {
  const assertion = createServiceAccountJwt(credentials);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetchImpl(credentials.token_uri || DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed (HTTP ${res.status}): ${text}`);
  }
  const parsed = JSON.parse(text);
  if (!parsed.access_token) {
    throw new Error("OAuth response did not include an access_token.");
  }
  return parsed.access_token;
}

async function apiRequest(fetchImpl, accessToken, method, url, { headers = {}, body } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

export async function queryExistingInternalMaxVersionCode({
  packageName = DEFAULT_PACKAGE_NAME,
  accessToken,
  fetchImpl = fetch,
}) {
  const baseUrl = `${API_ROOT}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
  const createRes = await apiRequest(fetchImpl, accessToken, "POST", `${baseUrl}/edits`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!createRes.ok || !createRes.json?.id) {
    throw new Error(
      `Failed to open Google Play edit for ${packageName} (HTTP ${createRes.status}): ${createRes.text}\n` +
        "Make sure the app com.jastrakowski.sixsixksiag is created in Google Play Console, its first AAB has been uploaded on Internal testing, and the service account has Release to testing tracks permissions."
    );
  }
  const editId = createRes.json.id;
  try {
    let maxVersionCode = 0;
    const trackRes = await apiRequest(
      fetchImpl,
      accessToken,
      "GET",
      `${baseUrl}/edits/${encodeURIComponent(editId)}/tracks/${ALLOWED_TRACK}`
    );
    if (trackRes.ok && trackRes.json) {
      maxVersionCode = Math.max(maxVersionCode, extractHighestTrackVersionCode(trackRes.json));
    }
    const bundlesRes = await apiRequest(
      fetchImpl,
      accessToken,
      "GET",
      `${baseUrl}/edits/${encodeURIComponent(editId)}/bundles`
    );
    if (bundlesRes.ok && Array.isArray(bundlesRes.json?.bundles)) {
      for (const b of bundlesRes.json.bundles) {
        const n = Number.parseInt(String(b?.versionCode ?? 0), 10);
        if (Number.isFinite(n) && n > maxVersionCode) {
          maxVersionCode = n;
        }
      }
    }
    return maxVersionCode;
  } finally {
    await apiRequest(fetchImpl, accessToken, "DELETE", `${baseUrl}/edits/${encodeURIComponent(editId)}`).catch(() => {});
  }
}

export function buildInternalAppSharingPreviewMetadata({
  branch = "",
  commit = "",
  versionName = "",
  versionCode = null,
  downloadUrl = "",
  certificateFingerprint = "",
  sha256 = "",
  builtAt = new Date().toISOString(),
} = {}) {
  const numericVersionCode =
    versionCode !== null && versionCode !== undefined && Number.isFinite(Number(versionCode))
      ? Number(versionCode)
      : null;
  return {
    branch: String(branch || ""),
    commit: String(commit || ""),
    versionName: String(versionName || ""),
    versionCode: numericVersionCode,
    downloadUrl: String(downloadUrl || ""),
    certificateFingerprint: String(certificateFingerprint || ""),
    sha256: String(sha256 || ""),
    builtAt: String(builtAt || new Date().toISOString()),
  };
}

export async function uploadBundleToInternalAppSharing({
  aabPath,
  packageName = DEFAULT_PACKAGE_NAME,
  credentials,
  branch = "",
  commit = "",
  versionName = "",
  versionCode = null,
  previewMetadataOutPath = "",
  builtAt = new Date().toISOString(),
  fetchImpl = fetch,
  logger = console,
}) {
  const resolvedAab = resolve(aabPath);
  if (!existsSync(resolvedAab)) {
    throw new Error(`AAB file does not exist: ${resolvedAab}`);
  }
  const aabBytes = readFileSync(resolvedAab);
  if (aabBytes.length < 1024) {
    throw new Error(`AAB file appears invalid or empty (${aabBytes.length} bytes): ${resolvedAab}`);
  }

  const accessToken = await fetchAccessToken(credentials, fetchImpl);
  const uploadUrl = `${API_ROOT}/upload/androidpublisher/v3/applications/internalappsharing/${encodeURIComponent(
    packageName
  )}/artifacts/bundle?uploadType=media`;

  logger.log(
    `[play-upload] Uploading AAB (${(aabBytes.length / (1024 * 1024)).toFixed(
      2
    )} MB) to Google Play Internal App Sharing for ${packageName}…`
  );

  const res = await apiRequest(fetchImpl, accessToken, "POST", uploadUrl, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(aabBytes.length),
    },
    body: aabBytes,
  });

  if (!res.ok || !res.json?.downloadUrl) {
    throw new Error(
      `Failed to upload AAB to Internal App Sharing (HTTP ${res.status}): ${res.text}\n` +
        `Check Google Play Console → Test and release → Setup → Internal app sharing and ensure the service account (${credentials.client_email}) is allowed under "Manage uploaders".`
    );
  }

  const metadata = buildInternalAppSharingPreviewMetadata({
    branch,
    commit,
    versionName,
    versionCode,
    downloadUrl: res.json.downloadUrl,
    certificateFingerprint: res.json.certificateFingerprint || "",
    sha256: res.json.sha256 || "",
    builtAt,
  });

  if (previewMetadataOutPath) {
    const resolvedOut = resolve(previewMetadataOutPath);
    mkdirSync(dirname(resolvedOut), { recursive: true });
    writeFileSync(resolvedOut, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    logger.log(`[play-upload] Wrote Internal App Sharing metadata to ${resolvedOut}`);
  }

  logger.log(`[play-upload] Internal App Sharing downloadUrl: ${metadata.downloadUrl}`);
  return {
    ok: true,
    ...metadata,
  };
}

export async function uploadBundleToInternalTrack({
  aabPath,
  packageName = DEFAULT_PACKAGE_NAME,
  credentials,
  releaseName = "",
  releaseNotesPl = "",
  releaseNotesEn = "",
  preferredStatus = "completed",
  track = ALLOWED_TRACK,
  fetchImpl = fetch,
  logger = console,
}) {
  assertInternalTrackOnly(track);
  const resolvedAab = resolve(aabPath);
  if (!existsSync(resolvedAab)) {
    throw new Error(`AAB file does not exist: ${resolvedAab}`);
  }
  const aabBytes = readFileSync(resolvedAab);
  if (aabBytes.length < 1024) {
    throw new Error(`AAB file appears invalid or empty (${aabBytes.length} bytes): ${resolvedAab}`);
  }

  const accessToken = await fetchAccessToken(credentials, fetchImpl);
  const appBase = `${API_ROOT}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
  const uploadBase = `${API_ROOT}/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;

  const attemptRelease = async (releaseStatus) => {
    logger.log(`[play-upload] Creating Play edit for ${packageName} (track=${ALLOWED_TRACK}, status=${releaseStatus})…`);
    const editRes = await apiRequest(fetchImpl, accessToken, "POST", `${appBase}/edits`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!editRes.ok || !editRes.json?.id) {
      throw new Error(`Failed to create edit (HTTP ${editRes.status}): ${editRes.text}`);
    }
    const editId = editRes.json.id;

    logger.log(`[play-upload] Uploading AAB (${(aabBytes.length / (1024 * 1024)).toFixed(2)} MB) to edit ${editId}…`);
    const bundleRes = await apiRequest(
      fetchImpl,
      accessToken,
      "POST",
      `${uploadBase}/edits/${encodeURIComponent(editId)}/bundles?uploadType=media`,
      {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(aabBytes.length),
        },
        body: aabBytes,
      }
    );
    if (!bundleRes.ok || !bundleRes.json?.versionCode) {
      await apiRequest(fetchImpl, accessToken, "DELETE", `${appBase}/edits/${encodeURIComponent(editId)}`).catch(() => {});
      throw new Error(`Failed to upload AAB bundle (HTTP ${bundleRes.status}): ${bundleRes.text}`);
    }

    const uploadedVersionCode = bundleRes.json.versionCode;
    logger.log(`[play-upload] Uploaded bundle versionCode=${uploadedVersionCode} (sha256=${bundleRes.json.sha256 || "n/a"}).`);

    const trackPayload = buildTrackUpdatePayload({
      versionCode: uploadedVersionCode,
      releaseStatus,
      releaseName: releaseName || `dev-${uploadedVersionCode}`,
      releaseNotesPl,
      releaseNotesEn,
    });

    const trackRes = await apiRequest(
      fetchImpl,
      accessToken,
      "PUT",
      `${appBase}/edits/${encodeURIComponent(editId)}/tracks/${ALLOWED_TRACK}`,
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(trackPayload),
      }
    );
    if (!trackRes.ok) {
      await apiRequest(fetchImpl, accessToken, "DELETE", `${appBase}/edits/${encodeURIComponent(editId)}`).catch(() => {});
      return {
        ok: false,
        status: trackRes.status,
        text: trackRes.text,
        versionCode: uploadedVersionCode,
        releaseStatus,
      };
    }

    const commitRes = await apiRequest(
      fetchImpl,
      accessToken,
      "POST",
      `${appBase}/edits/${encodeURIComponent(editId)}:commit`,
      {
        headers: { "content-type": "application/json" },
      }
    );
    if (!commitRes.ok) {
      // Also try commit with changesNotSentForReview=true if Play Console requires it for unreviewed changes
      if (commitRes.status === 400 && commitRes.text.toLowerCase().includes("changesnotsentforreview")) {
        const retryCommit = await apiRequest(
          fetchImpl,
          accessToken,
          "POST",
          `${appBase}/edits/${encodeURIComponent(editId)}:commit?changesNotSentForReview=true`,
          {
            headers: { "content-type": "application/json" },
          }
        );
        if (retryCommit.ok) {
          return {
            ok: true,
            editId,
            versionCode: uploadedVersionCode,
            releaseStatus,
            track: ALLOWED_TRACK,
            changesNotSentForReview: true,
          };
        }
      }
      await apiRequest(fetchImpl, accessToken, "DELETE", `${appBase}/edits/${encodeURIComponent(editId)}`).catch(() => {});
      return {
        ok: false,
        status: commitRes.status,
        text: commitRes.text,
        versionCode: uploadedVersionCode,
        releaseStatus,
      };
    }

    return {
      ok: true,
      editId,
      versionCode: uploadedVersionCode,
      releaseStatus,
      track: ALLOWED_TRACK,
    };
  };

  const initialStatus = preferredStatus === "draft" ? "draft" : "completed";
  const firstAttempt = await attemptRelease(initialStatus);
  if (firstAttempt.ok) {
    logger.log(
      `[play-upload] Published versionCode=${firstAttempt.versionCode} to Google Play track="${ALLOWED_TRACK}" (status="${firstAttempt.releaseStatus}").`
    );
    return firstAttempt;
  }

  if (initialStatus === "completed" && shouldFallbackToDraftRelease(firstAttempt.status, firstAttempt.text)) {
    logger.warn(
      `[play-upload] Play Console reported app is in draft/unreviewed state (HTTP ${firstAttempt.status}). Automatically retrying with status="draft" on track="${ALLOWED_TRACK}"…`
    );
    const draftAttempt = await attemptRelease("draft");
    if (draftAttempt.ok) {
      logger.log(
        `[play-upload] Published versionCode=${draftAttempt.versionCode} to Google Play track="${ALLOWED_TRACK}" with fallback status="draft".`
      );
      return draftAttempt;
    }
    throw new Error(`Failed to publish draft release on track "${ALLOWED_TRACK}" (HTTP ${draftAttempt.status}): ${draftAttempt.text}`);
  }

  throw new Error(`Failed to publish release on track "${ALLOWED_TRACK}" (HTTP ${firstAttempt.status}): ${firstAttempt.text}`);
}

function parseCliArgs(argv) {
  const opts = {
    mode: process.env.PLAY_UPLOAD_MODE || "internal-sharing",
    aabPath: process.env.ANDROID_AAB_PATH || "android/app-release-bundle.aab",
    packageName: process.env.ANDROID_PACKAGE_NAME || DEFAULT_PACKAGE_NAME,
    track: process.env.PLAY_TRACK || ALLOWED_TRACK,
    preferredStatus: process.env.PLAY_RELEASE_STATUS || "completed",
    releaseName: process.env.PLAY_RELEASE_NAME || "",
    releaseNotesPl: process.env.PLAY_RELEASE_NOTES_PL || "",
    releaseNotesEn: process.env.PLAY_RELEASE_NOTES_EN || "",
    branch: process.env.PLAY_PREVIEW_BRANCH || "",
    commit: process.env.PLAY_PREVIEW_COMMIT || "",
    versionName: process.env.KSIAG_VERSION_NAME || process.env.ANDROID_VERSION_NAME || "",
    versionCode: process.env.KSIAG_VERSION_CODE || process.env.ANDROID_VERSION_CODE || null,
    previewMetadataOutPath: process.env.PLAY_PREVIEW_METADATA_OUT || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--next-version-code") {
      opts.mode = "next-version-code";
    } else if (arg === "--verify-credentials") {
      opts.mode = "verify-credentials";
    } else if (arg === "--internal-sharing") {
      opts.mode = "internal-sharing";
    } else if (arg === "--mode" && argv[i + 1]) {
      opts.mode = argv[++i];
    } else if (arg === "--aab" && argv[i + 1]) {
      opts.aabPath = argv[++i];
    } else if (arg === "--package" && argv[i + 1]) {
      opts.packageName = argv[++i];
    } else if (arg === "--track" && argv[i + 1]) {
      opts.track = argv[++i];
    } else if (arg === "--status" && argv[i + 1]) {
      opts.preferredStatus = argv[++i];
    } else if (arg === "--release-name" && argv[i + 1]) {
      opts.releaseName = argv[++i];
    } else if (arg === "--branch" && argv[i + 1]) {
      opts.branch = argv[++i];
    } else if (arg === "--commit" && argv[i + 1]) {
      opts.commit = argv[++i];
    } else if (arg === "--version-name" && argv[i + 1]) {
      opts.versionName = argv[++i];
    } else if (arg === "--version-code" && argv[i + 1]) {
      opts.versionCode = argv[++i];
    } else if (arg === "--metadata-out" && argv[i + 1]) {
      opts.previewMetadataOutPath = argv[++i];
    }
  }
  return opts;
}

async function runCli() {
  const opts = parseCliArgs(process.argv.slice(2));
  assertInternalTrackOnly(opts.track);

  if (opts.mode === "next-version-code") {
    let remoteMax = 0;
    if (process.env.PLAY_QUERY_REMOTE_VERSION_CODE === "1" && process.env.PLAY_SERVICE_ACCOUNT_JSON?.trim()) {
      try {
        const creds = parseServiceAccountCredentials(process.env.PLAY_SERVICE_ACCOUNT_JSON);
        const token = await fetchAccessToken(creds);
        remoteMax = await queryExistingInternalMaxVersionCode({
          packageName: opts.packageName,
          accessToken: token,
        });
      } catch (err) {
        console.error(
          `[play-upload] Note: could not query remote Play versionCode (${err instanceof Error ? err.message : String(err)}); using epoch timestamp.`
        );
      }
    }
    const nextCode = computeNextVersionCode({
      remoteMaxVersionCode: remoteMax,
      explicitVersionCode: process.env.KSIAG_VERSION_CODE || process.env.ANDROID_VERSION_CODE || null,
    });
    process.stdout.write(`${nextCode}\n`);
    return;
  }

  const credentials = parseServiceAccountCredentials(process.env.PLAY_SERVICE_ACCOUNT_JSON || "");
  if (opts.mode === "verify-credentials") {
    console.log(`Service account email: ${credentials.client_email}`);
    return;
  }

  if (opts.mode === "internal-sharing") {
    await uploadBundleToInternalAppSharing({
      aabPath: opts.aabPath,
      packageName: opts.packageName,
      credentials,
      branch: opts.branch,
      commit: opts.commit,
      versionName: opts.versionName,
      versionCode: opts.versionCode,
      previewMetadataOutPath: opts.previewMetadataOutPath,
    });
    return;
  }

  await uploadBundleToInternalTrack({
    aabPath: opts.aabPath,
    packageName: opts.packageName,
    credentials,
    releaseName: opts.releaseName,
    releaseNotesPl: opts.releaseNotesPl,
    releaseNotesEn: opts.releaseNotesEn,
    preferredStatus: opts.preferredStatus,
    track: opts.track,
  });
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  runCli().catch((err) => {
    console.error(`[play-upload] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
