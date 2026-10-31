import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertInternalTrackOnly,
  buildInternalAppSharingPreviewMetadata,
  buildTrackUpdatePayload,
  computeNextVersionCode,
  createServiceAccountJwt,
  extractHighestTrackVersionCode,
  parseServiceAccountCredentials,
  queryExistingInternalMaxVersionCode,
  shouldFallbackToDraftRelease,
  uploadBundleToInternalAppSharing,
  uploadBundleToInternalTrack,
} from "../../scripts/play-upload-internal.mjs";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SAMPLE_SA = {
  type: "service_account",
  project_id: "ksiag-play-test",
  private_key_id: "1234567890",
  private_key: privateKey,
  client_email: "play-uploader@ksiag-play-test.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
};

describe("Google Play Internal App Sharing & Internal Testing uploader", () => {
  it("parses raw JSON, base64 JSON, and file paths for PLAY_SERVICE_ACCOUNT_JSON", () => {
    const raw = JSON.stringify(SAMPLE_SA);
    const b64 = Buffer.from(raw, "utf8").toString("base64");

    const parsedRaw = parseServiceAccountCredentials(raw);
    expect(parsedRaw.client_email).toBe(SAMPLE_SA.client_email);

    const parsedB64 = parseServiceAccountCredentials(b64);
    expect(parsedB64.client_email).toBe(SAMPLE_SA.client_email);

    const dir = mkdtempSync(join(tmpdir(), "play-sa-"));
    try {
      const file = join(dir, "sa.json");
      writeFileSync(file, raw);
      const parsedFile = parseServiceAccountCredentials(file);
      expect(parsedFile.client_email).toBe(SAMPLE_SA.client_email);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("signs an RS256 OAuth JWT for androidpublisher scope", () => {
    const creds = parseServiceAccountCredentials(JSON.stringify(SAMPLE_SA));
    const jwt = createServiceAccountJwt(creds, 1_700_000_000);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    expect(payload).toEqual({
      iss: SAMPLE_SA.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
  });

  it("uploads an AAB to Google Play Internal App Sharing and writes dist/android-preview.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "play-ias-"));
    const aabPath = join(dir, "app-release-bundle.aab");
    const metadataPath = join(dir, "dist", "android-preview.json");
    writeFileSync(aabPath, Buffer.alloc(4096, 0x50));

    const calls = [];
    const fakeFetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", headers: init.headers });
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "tok-ias-123" }), { status: 200 });
      }
      if (
        url ===
          "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/internalappsharing/com.jastrakowski.sixsixksiag/artifacts/bundle?uploadType=media" &&
        init.method === "POST"
      ) {
        expect(init.headers["content-type"]).toBe("application/octet-stream");
        return new Response(
          JSON.stringify({
            downloadUrl: "https://play.google.com/apps/test/RQk12345/ah0123456789",
            certificateFingerprint: "B6:91:4A:E2:7E:39:64:25:C7:AB:D7:F0:05:C5:30:9B",
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${init.method} ${url}`);
    };

    try {
      const creds = parseServiceAccountCredentials(JSON.stringify(SAMPLE_SA));
      const logs = [];
      const result = await uploadBundleToInternalAppSharing({
        aabPath,
        packageName: "com.jastrakowski.sixsixksiag",
        credentials: creds,
        branch: "dev",
        commit: "6a6d521eed4aed54bf83eac87aa00adc89202617",
        versionName: "2.0.1793481000-dev.6a6d521",
        versionCode: 1793481000,
        previewMetadataOutPath: metadataPath,
        builtAt: "2026-10-31T21:25:00.000Z",
        fetchImpl: fakeFetch,
        logger: {
          log(msg) {
            logs.push(msg);
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.downloadUrl).toBe("https://play.google.com/apps/test/RQk12345/ah0123456789");

      const written = JSON.parse(readFileSync(metadataPath, "utf8"));
      expect(written).toEqual(
        buildInternalAppSharingPreviewMetadata({
          branch: "dev",
          commit: "6a6d521eed4aed54bf83eac87aa00adc89202617",
          versionName: "2.0.1793481000-dev.6a6d521",
          versionCode: 1793481000,
          downloadUrl: "https://play.google.com/apps/test/RQk12345/ah0123456789",
          certificateFingerprint: "B6:91:4A:E2:7E:39:64:25:C7:AB:D7:F0:05:C5:30:9B",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          builtAt: "2026-10-31T21:25:00.000Z",
        })
      );
      expect(logs.some((l) => l.includes("https://play.google.com/apps/test/RQk12345/ah0123456789"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strictly enforces the internal track only", () => {
    expect(assertInternalTrackOnly("internal")).toBe("internal");
    expect(() => assertInternalTrackOnly("production")).toThrow(/only permits uploads to "internal"/);
    expect(() => assertInternalTrackOnly("beta")).toThrow(/only permits uploads to "internal"/);
    expect(() => assertInternalTrackOnly("alpha")).toThrow(/only permits uploads to "internal"/);
  });

  it("computes a strictly increasing versionCode above any existing track release", () => {
    const trackData = {
      track: "internal",
      releases: [
        { versionCodes: ["2", "15"] },
        { versionCodes: ["1800000050"] },
      ],
    };
    const remoteMax = extractHighestTrackVersionCode(trackData);
    expect(remoteMax).toBe(1_800_000_050);

    expect(
      computeNextVersionCode({
        remoteMaxVersionCode: remoteMax,
        nowEpochSeconds: 1_793_563_800,
      })
    ).toBe(1_800_000_051);

    expect(
      computeNextVersionCode({
        remoteMaxVersionCode: 2,
        nowEpochSeconds: 1_793_563_800,
      })
    ).toBe(1_793_563_800);
  });

  it("detects Play Console draft-app errors and falls back to status='draft'", async () => {
    expect(
      shouldFallbackToDraftRelease(
        400,
        JSON.stringify({
          error: {
            code: 400,
            message: "Only releases with status draft may be created on draft app.",
          },
        })
      )
    ).toBe(true);
    expect(shouldFallbackToDraftRelease(500, "Internal Server Error")).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "play-aab-"));
    const aabPath = join(dir, "app-release-bundle.aab");
    writeFileSync(aabPath, Buffer.alloc(4096, 0x50));

    const calls = [];
    let trackPutCount = 0;

    const fakeFetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", body: init.body });
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "tok-123" }), { status: 200 });
      }
      if (url.endsWith("/edits") && init.method === "POST") {
        return new Response(JSON.stringify({ id: `edit-${calls.length}` }), { status: 200 });
      }
      if (url.includes("/bundles?uploadType=media") && init.method === "POST") {
        return new Response(JSON.stringify({ versionCode: 1793563800, sha256: "deadbeef" }), { status: 200 });
      }
      if (url.endsWith("/tracks/internal") && init.method === "PUT") {
        trackPutCount += 1;
        const parsed = JSON.parse(init.body);
        if (trackPutCount === 1) {
          expect(parsed.releases[0].status).toBe("completed");
          return new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: "Only releases with status draft may be created on draft app.",
              },
            }),
            { status: 400 }
          );
        }
        expect(parsed.releases[0].status).toBe("draft");
        return new Response(JSON.stringify(parsed), { status: 200 });
      }
      if (url.endsWith(":commit") && init.method === "POST") {
        return new Response(JSON.stringify({ id: "committed" }), { status: 200 });
      }
      if (init.method === "DELETE") {
        return new Response("", { status: 204 });
      }
      throw new Error(`Unexpected URL: ${init.method} ${url}`);
    };

    try {
      const creds = parseServiceAccountCredentials(JSON.stringify(SAMPLE_SA));
      const result = await uploadBundleToInternalTrack({
        aabPath,
        packageName: "com.jastrakowski.sixsixksiag",
        credentials: creds,
        releaseName: "2.0.1793563800-dev",
        releaseNotesPl: "Wydanie testowe",
        releaseNotesEn: "Test release",
        fetchImpl: fakeFetch,
        logger: { log() {}, warn() {} },
      });

      expect(result.ok).toBe(true);
      expect(result.track).toBe("internal");
      expect(result.releaseStatus).toBe("draft");
      expect(result.versionCode).toBe(1793563800);
      expect(trackPutCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queries existing internal track and bundle versionCodes", async () => {
    const fakeFetch = async (url, init = {}) => {
      if (url.endsWith("/edits") && init.method === "POST") {
        return new Response(JSON.stringify({ id: "edit-q" }), { status: 200 });
      }
      if (url.endsWith("/edits/edit-q/tracks/internal")) {
        return new Response(
          JSON.stringify({
            track: "internal",
            releases: [{ versionCodes: ["100", "250"] }],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/edits/edit-q/bundles")) {
        return new Response(
          JSON.stringify({
            bundles: [{ versionCode: 240 }, { versionCode: 310 }],
          }),
          { status: 200 }
        );
      }
      if (init.method === "DELETE") {
        return new Response("", { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const maxCode = await queryExistingInternalMaxVersionCode({
      packageName: "com.jastrakowski.sixsixksiag",
      accessToken: "tok",
      fetchImpl: fakeFetch,
    });
    expect(maxCode).toBe(310);

    const payload = buildTrackUpdatePayload({
      versionCode: 311,
      releaseStatus: "completed",
      releaseName: "dev-311",
      releaseNotesPl: "Test PL",
      releaseNotesEn: "Test EN",
    });
    expect(payload).toEqual({
      track: "internal",
      releases: [
        {
          versionCodes: ["311"],
          status: "completed",
          name: "dev-311",
          releaseNotes: [
            { language: "pl-PL", text: "Test PL" },
            { language: "en-US", text: "Test EN" },
          ],
        },
      ],
    });
  });
});
