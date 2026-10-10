/**
 * Zapis planu w chmurze bez konta.
 * Kod (32 B): 16 B identyfikatora slotu + 16 B klucza AES-128-GCM.
 * Ten sam klucz, przez HKDF, jest ziarnem podpisu Ed25519 żądania.
 * Serwer trzyma tylko klucz publiczny i odrzuca żądanie bez ważnego podpisu.
 * Na serwer idzie identyfikator, podpis i szyfrogram ≤ 64 B.
 * Jawny rekord ma 24 B — postęp planu i miejsce czytania, nie magazyn plików.
 */

import {
  accruePlan,
  buildChapterList,
  dailyQuota,
  defaultPlan,
  loadPlan,
  savePlan,
  todayKey,
} from "./plan.js";
import { loadPlaces, savePlaces } from "./place.js";

const CLOUD_KEY = "ksiag-cloud-v1";
const EPOCH_MS = Date.UTC(2020, 0, 1);
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TOKEN_BYTES = 32;
const ID_BYTES = 16;
const PLAIN_V1 = 16;
const PLAIN_V2 = 24;
export const SYNC_MAX_BYTES = 64;
export const SYNC_MIN_BYTES = 29;

const GOALS = ["bible", "st", "nt", "range"];

let pushTimer = null;
let statusListener = null;
let lastStatus = "";

export function setStatusListener(fn) {
  statusListener = fn;
}

export function lastSyncStatus() {
  return lastStatus;
}

function emitStatus(code) {
  lastStatus = code || "";
  statusListener?.(lastStatus);
}

export function minutesSinceEpoch(ms = Date.now()) {
  return Math.max(0, Math.min(0xffffff, Math.floor((ms - EPOCH_MS) / 60000)));
}

function dayNumber(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return 0;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.max(0, Math.min(0xffff, Math.round((utc - EPOCH_MS) / 86400000)));
}

function dayKey(n) {
  const d = new Date(EPOCH_MS + n * 86400000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function bookIndex(id) {
  const n = parseInt(String(id || "").slice(0, 2), 10);
  return n >= 1 && n <= 66 ? n - 1 : 0;
}

function bookIdAt(books, index, fallback) {
  const found = books?.find((b) => bookIndex(b.id) === index);
  return found?.id || fallback;
}

function clamp(n, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function writeU16(buf, off, n) {
  const v = clamp(n, 0, 0xffff);
  buf[off] = v & 255;
  buf[off + 1] = (v >> 8) & 255;
}

function readU16(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}

function writeU24(buf, off, n) {
  const v = clamp(n, 0, 0xffffff);
  buf[off] = v & 255;
  buf[off + 1] = (v >> 8) & 255;
  buf[off + 2] = (v >> 16) & 255;
}

function readU24(buf, off) {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
}

function writePlace(buf, off, place) {
  if (!place?.book || !place.chapter) {
    buf[off] = 255;
    buf[off + 1] = 0;
    return;
  }
  buf[off] = bookIndex(place.book);
  buf[off + 1] = clamp(place.chapter, 1, 255);
}

function readPlace(books, buf, off) {
  if (buf[off] === 255 || !buf[off + 1]) return null;
  const book = bookIdAt(books, buf[off], null);
  if (!book) return null;
  return { book, chapter: buf[off + 1] };
}

function applyCommon(bytes, books, local) {
  const base = { ...(local || defaultPlan()) };
  const goal = GOALS[bytes[1] & 3] || "bible";
  const cursor = readU16(bytes, 8);
  const day = dayKey(readU16(bytes, 10));
  return {
    base,
    plan: {
      ...base,
      enabled: !!(bytes[1] & 8),
      goal,
      mode: bytes[1] & 4 ? "time" : "chapters",
      chaptersPerDay: clamp(bytes[2], 1, 255),
      minutesPerDay: clamp(bytes[3], 1, 255),
      fromBook: bookIdAt(books, bytes[4], base.fromBook),
      fromChapter: clamp(bytes[5], 1, 255),
      toBook: bookIdAt(books, bytes[6], base.toBook),
      toChapter: clamp(bytes[7], 1, 255),
      cursor,
      day,
      readToday: [],
      notifications: !!base.notifications,
      startNotifiedDay: base.startNotifiedDay ?? null,
    },
  };
}

/**
 * 24 B: plan, zaległa porcja, oraz ostatni rozdział zwykłego czytania (BG i KJV).
 * Wersja 1 (16 B) nadal się otwiera.
 */
export function encodePlan(plan, updatedMin, places = loadPlaces()) {
  const bytes = new Uint8Array(PLAIN_V2);
  const goal = GOALS.indexOf(plan.goal);
  bytes[0] = 2;
  bytes[1] =
    (goal < 0 ? 0 : goal) |
    (plan.mode === "time" ? 4 : 0) |
    (plan.enabled ? 8 : 0) |
    (plan.beyond ? 16 : 0);
  bytes[2] = clamp(plan.chaptersPerDay, 1, 255);
  bytes[3] = clamp(plan.minutesPerDay, 1, 255);
  bytes[4] = bookIndex(plan.fromBook);
  bytes[5] = clamp(plan.fromChapter, 1, 255);
  bytes[6] = bookIndex(plan.toBook);
  bytes[7] = clamp(plan.toChapter, 1, 255);
  writeU16(bytes, 8, plan.cursor || 0);
  writeU16(bytes, 10, dayNumber(plan.day || todayKey()));
  const doneCount = Array.isArray(plan.readToday) ? plan.readToday.length : plan.doneToday || 0;
  const quota = dailyQuota(plan);
  const owed = plan.owed == null ? Math.max(0, quota - Math.min(doneCount, quota)) : plan.owed;
  const pile = plan.pile || owed + Math.min(doneCount, quota);
  bytes[12] = clamp(doneCount, 0, 255);
  writeU16(bytes, 13, owed);
  writeU16(bytes, 15, pile);
  writeU24(bytes, 17, updatedMin || 0);
  writePlace(bytes, 20, places?.["bg-1879"]);
  writePlace(bytes, 22, places?.["kjv-1769"]);
  return bytes;
}

function readTodayFrom(books, plan, count) {
  if (!books?.length || !count || plan.day !== todayKey()) return [];
  const list = buildChapterList(books, plan);
  const cursor = plan.cursor || 0;
  const n = Math.min(count, cursor, list.length);
  return list.slice(cursor - n, cursor);
}

/**
 * Odtwarza plan. Powiadomienia zostają z `local` — są ustawieniem urządzenia.
 * Dzisiejsze zaliczenia to `count` rozdziałów tuż przed kursorem (zapis idzie tylko do przodu).
 */
function finishDecoded(plan, count, books) {
  const today = todayKey();
  if (plan.day !== today && plan.owed == null) {
    const quota = dailyQuota(plan);
    plan.owed = Math.max(0, quota - Math.min(count, quota));
  }
  plan.readToday = plan.day === today ? readTodayFrom(books, plan, count) : [];
  return accruePlan(plan);
}

export function decodePlan(bytes, books, local) {
  if (!bytes || (bytes[0] !== 1 && bytes[0] !== 2)) return null;
  if (bytes[0] === 1 && bytes.length < PLAIN_V1) return null;
  if (bytes[0] === 2 && bytes.length < PLAIN_V2) return null;
  const { plan } = applyCommon(bytes, books, local);
  const count = bytes[12];
  let places = null;
  if (bytes[0] === 2) {
    plan.beyond = !!(bytes[1] & 16);
    plan.doneToday = count;
    plan.owed = readU16(bytes, 13);
    plan.pile = readU16(bytes, 15);
    places = {
      "bg-1879": readPlace(books, bytes, 20),
      "kjv-1769": readPlace(books, bytes, 22),
    };
  }
  return {
    plan: finishDecoded(plan, count, books),
    updatedMin: bytes[0] === 1 ? readU24(bytes, 13) : readU24(bytes, 17),
    places,
  };
}

function encodeBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of text) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  return out.length === TOKEN_BYTES ? new Uint8Array(out) : null;
}

export function parseToken(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  const hashAt = s.lastIndexOf("#");
  if (hashAt >= 0) s = s.slice(hashAt + 1);
  s = s.replace(/^cloud=/i, "");
  s = s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== 52) return null;
  const bytes = decodeBase32(s);
  if (!bytes) return null;
  const id = bytes.slice(0, ID_BYTES);
  const key = bytes.slice(ID_BYTES);
  const idHex = [...id].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { bytes, id, key, idHex, canonical: encodeBase32(bytes) };
}

export function formatToken(canonical) {
  const parsed = parseToken(canonical);
  const text = parsed ? parsed.canonical : "";
  return text.replace(/(.{4})/g, "$1 ").trim();
}

export function generateToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return parseToken(encodeBase32(bytes));
}

export function tokenFromHash(hash) {
  const parsed = parseToken(hash || "");
  return parsed ? parsed.canonical : null;
}

export function pairingUrl(canonical) {
  return `${location.origin}/synchronizacja#${canonical}`;
}

export function loadCloud() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return { enabled: false, token: "", updatedMin: 0 };
    const p = JSON.parse(raw);
    return {
      enabled: !!p.enabled,
      token: typeof p.token === "string" ? p.token : "",
      updatedMin: Number(p.updatedMin) || 0,
    };
  } catch {
    return { enabled: false, token: "", updatedMin: 0 };
  }
}

export function saveCloud(state) {
  localStorage.setItem(
    CLOUD_KEY,
    JSON.stringify({
      enabled: !!state.enabled,
      token: state.token || "",
      updatedMin: Number(state.updatedMin) || 0,
    })
  );
}

export function isEnabled() {
  const s = loadCloud();
  return !!(s.enabled && s.token);
}

function bumpUpdated(prev) {
  return Math.min(0xffffff, Math.max(minutesSinceEpoch(), (prev || 0) + 1));
}

export function cancelScheduledPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
}

async function importKey(keyBytes) {
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const SIGN_INFO = new TextEncoder().encode("ksiag-sync-sign");
const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesFromBase64Url(text) {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bajt podpisu: metoda, numer slotu, czas, klucz publiczny, ciało. */
export function syncMessage(method, idHex, timeSec, pubHex, body) {
  const head = new TextEncoder().encode(`${method}\n${idHex}\n${timeSec}\n${pubHex}\n`);
  const bytes = body?.length ? body : new Uint8Array();
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  return out;
}

async function signingSeed(keyBytes, idBytes) {
  const base = await crypto.subtle.importKey("raw", keyBytes, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: idBytes, info: SIGN_INFO },
    base,
    256
  );
  return new Uint8Array(bits);
}

export async function syncAuthHeaders(method, parsed, body, nowSec = Math.floor(Date.now() / 1000)) {
  const seed = await signingSeed(parsed.key, parsed.id);
  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + seed.length);
  pkcs8.set(ED25519_PKCS8_PREFIX, 0);
  pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);
  const priv = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const pubHex = toHex(bytesFromBase64Url(jwk.x));
  const timeSec = String(nowSec);
  const message = syncMessage(method, parsed.idHex, timeSec, pubHex, body);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", priv, message));
  return {
    "x-sync-time": timeSec,
    "x-sync-pub": pubHex,
    "x-sync-sign": toHex(sig),
  };
}

export async function seal(plain, keyBytes, idBytes) {
  const key = await importKey(keyBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: idBytes }, key, plain)
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function openSeal(blob, keyBytes, idBytes) {
  if (!blob || blob.length < SYNC_MIN_BYTES || blob.length > SYNC_MAX_BYTES) return null;
  try {
    const key = await importKey(keyBytes);
    const iv = blob.slice(0, 12);
    const ct = blob.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: idBytes },
      key,
      ct
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

async function fetchSync(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export async function pushNow() {
  const state = loadCloud();
  if (!state.enabled || !state.token) return "off";
  const parsed = parseToken(state.token);
  if (!parsed) return "bad";
  if (!state.updatedMin) {
    state.updatedMin = minutesSinceEpoch();
    saveCloud(state);
  }
  const plain = encodePlan(loadPlan(), state.updatedMin);
  const sealed = await seal(plain, parsed.key, parsed.id);
  if (sealed.byteLength > SYNC_MAX_BYTES) return "error";
  try {
    const headers = await syncAuthHeaders("PUT", parsed, sealed);
    const res = await fetchSync(`/api/sync/${parsed.idHex}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", ...headers },
      body: sealed,
    });
    if (!res.ok) return "error";
    emitStatus("saved");
    return "saved";
  } catch {
    emitStatus("offline");
    return "offline";
  }
}

export function schedulePush() {
  const state = loadCloud();
  if (!state.token) return;
  state.updatedMin = bumpUpdated(state.updatedMin);
  saveCloud(state);
  if (!state.enabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushNow().catch(() => emitStatus("error"));
  }, 400);
}

function applyRemote(decoded) {
  cancelScheduledPush();
  savePlan(decoded.plan, { silent: true });
  if (decoded.places) savePlaces(decoded.places);
  const state = loadCloud();
  state.updatedMin = decoded.updatedMin;
  saveCloud(state);
}

export async function pull(books) {
  const state = loadCloud();
  if (!state.enabled || !state.token) return "off";
  const parsed = parseToken(state.token);
  if (!parsed) return "bad";
  let res;
  try {
    const headers = await syncAuthHeaders("GET", parsed, new Uint8Array());
    res = await fetchSync(`/api/sync/${parsed.idHex}`, { headers });
  } catch {
    emitStatus("offline");
    return "offline";
  }
  if (res.status === 404) {
    const pushed = await pushNow();
    return pushed === "saved" ? "uploaded" : pushed;
  }
  if (!res.ok) {
    emitStatus("error");
    return "error";
  }
  const plain = await openSeal(new Uint8Array(await res.arrayBuffer()), parsed.key, parsed.id);
  const decoded = plain && decodePlan(plain, books, loadPlan());
  if (!decoded) {
    emitStatus("error");
    return "bad";
  }
  if (decoded.updatedMin > (state.updatedMin || 0)) {
    applyRemote(decoded);
    emitStatus("saved");
    return "remote";
  }
  if ((state.updatedMin || 0) > decoded.updatedMin) {
    const pushed = await pushNow();
    return pushed === "saved" ? "local" : pushed;
  }
  return "same";
}

/** Włącza zapis. Bez kodu generuje nowy i wysyła lokalny plan. */
export async function enableCloud() {
  const state = loadCloud();
  if (!state.token) {
    const token = generateToken();
    saveCloud({ enabled: true, token: token.canonical, updatedMin: bumpUpdated(0) });
    return pushNow();
  }
  saveCloud({ ...state, enabled: true });
  return "on";
}

export function disableCloud() {
  const state = loadCloud();
  cancelScheduledPush();
  saveCloud({ ...state, enabled: false });
  emitStatus("");
}

/** Nowy kod na tym urządzeniu. Stary slot zostaje dla urządzeń, które go mają. */
export async function rotateToken() {
  const token = generateToken();
  saveCloud({ enabled: true, token: token.canonical, updatedMin: bumpUpdated(0) });
  return pushNow();
}

/**
 * Połączenie z istniejącym kodem.
 * Gdy slot ma dane — bierzemy je. Gdy pusty — wysyłamy lokalny plan.
 */
export async function joinToken(text, books) {
  const parsed = parseToken(text);
  if (!parsed) return "bad";
  let res;
  try {
    const headers = await syncAuthHeaders("GET", parsed, new Uint8Array());
    res = await fetchSync(`/api/sync/${parsed.idHex}`, { headers });
  } catch {
    emitStatus("offline");
    return "offline";
  }
  if (res.status === 404) {
    saveCloud({
      enabled: true,
      token: parsed.canonical,
      updatedMin: bumpUpdated(loadCloud().updatedMin),
    });
    const pushed = await pushNow();
    return pushed === "saved" ? "uploaded" : pushed;
  }
  if (!res.ok) {
    emitStatus("error");
    return "error";
  }
  const plain = await openSeal(new Uint8Array(await res.arrayBuffer()), parsed.key, parsed.id);
  const decoded = plain && decodePlan(plain, books, loadPlan());
  if (!decoded) return "bad";
  cancelScheduledPush();
  saveCloud({ enabled: true, token: parsed.canonical, updatedMin: decoded.updatedMin });
  savePlan(decoded.plan, { silent: true });
  if (decoded.places) savePlaces(decoded.places);
  emitStatus("saved");
  return "joined";
}

export async function qrSvg(text) {
  const { renderSVG } = await import("./vendor/uqr.js");
  const paper = getComputedStyle(document.body).getPropertyValue("--paper").trim() || "#e4d7bc";
  const ink = getComputedStyle(document.body).getPropertyValue("--ink").trim() || "#100c09";
  return renderSVG(text, {
    ecc: "M",
    border: 2,
    pixelSize: 4,
    whiteColor: paper,
    blackColor: ink,
  });
}
