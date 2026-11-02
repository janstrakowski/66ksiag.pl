import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(branch, args = []) {
  const env = { ...process.env, WORKERS_CI_BRANCH: branch };
  delete env.PLAY_SERVICE_ACCOUNT_JSON;
  delete env.ANDROID_KEYSTORE_BASE64;
  try {
    const stdout = execFileSync("bash", ["scripts/android-play-internal.sh", ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("Play Internal App Sharing branch gate", () => {
  it("skips prod in preview mode", () => {
    const result = run("prod", ["--if-non-prod-branch"]);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/Branch is 'prod'|Refusing/);
  });

  it("keeps the old flag name as a prod skip", () => {
    const result = run("prod", ["--if-non-main-branch"]);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/Refusing/);
  });

  it("treats main as a preview branch and does not upload without credentials", () => {
    const result = run("main", ["--if-non-prod-branch"]);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Branch is 'main'/);
    expect(result.stdout + result.stderr).toMatch(/skipping Google Play Internal App Sharing upload/);
  });

  it("refuses a direct upload from prod", () => {
    const result = run("prod");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/production branch 'prod'/);
  });
});
