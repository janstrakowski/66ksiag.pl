/**
 * KJV Scourby audio — stream z internetu (ECFTF), opcjonalny offline cache.
 * MP3 nie są w bundlu aplikacji.
 */

const STORAGE_KEY = "ksiag-audio-v1";
const CACHE_NAME = "ksiag-scourby-mp3-v1";
const CATALOG_URL = "/audio-catalog.json";
/** Szacunek bajtów/rozdział (ECFTF ~1–3 MB) — do paska Background Fetch. */
const AVG_CHAPTER_BYTES = 2.2 * 1024 * 1024;
const BF_ID_PREFIX = "ksiag-scourby-";

let catalogPromise = null;
/** @type {Map<string, object> | null} */
let catalogByKey = null;
let objectUrl = null;
/** @type {BackgroundFetchRegistration | null} */
let activeBgFetch = null;
let activeBgFetchId = null;

/** @returns {number | null} sekundy */
export function etaFromProgress(done, total, startedAtMs) {
  const elapsed = (Date.now() - startedAtMs) / 1000;
  if (elapsed < 2 || done < 1 || total <= done) return done >= total ? 0 : null;
  const rate = done / elapsed;
  if (rate <= 0) return null;
  return Math.max(0, (total - done) / rate);
}

export function etaFromBytes(downloaded, downloadTotal, startedAtMs) {
  const elapsed = (Date.now() - startedAtMs) / 1000;
  if (elapsed < 2 || !downloadTotal || downloaded < 8 * 1024) return null;
  if (downloaded >= downloadTotal) return 0;
  const rate = downloaded / elapsed;
  if (rate <= 0) return null;
  return Math.max(0, (downloadTotal - downloaded) / rate);
}

export function loadAudioSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSession();
    return { ...defaultSession(), ...JSON.parse(raw) };
  } catch {
    return defaultSession();
  }
}

export function saveAudioSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function defaultSession() {
  return {
    mode: "idle",
    offerContinue: false,
    nextBook: null,
    nextChapter: null,
  };
}

export function proxyPath(bookId, chapter) {
  return `/audio/proxy/${bookId}/${chapter}`;
}

export async function loadAudioCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error("catalog");
        const cat = await res.json();
        catalogByKey = new Map(
          (cat.chapters || []).map((c) => [`${c.book}/${Number(c.chapter)}`, c])
        );
        return cat;
      })
      .catch((e) => {
        catalogPromise = null;
        catalogByKey = null;
        throw e;
      });
  }
  return catalogPromise;
}

export function catalogEntry(catalog, bookId, chapter) {
  const key = `${bookId}/${Number(chapter)}`;
  if (catalogByKey) return catalogByKey.get(key) || null;
  return catalog?.chapters?.find((c) => c.book === bookId && c.chapter === Number(chapter)) || null;
}

export function wordsUrl(editionPath, bookId, chapter) {
  return `${editionPath}/${bookId}/${chapter}.words.json`;
}

export async function chapterHasAudio(bookId, chapter) {
  try {
    const cat = await loadAudioCatalog();
    return !!catalogEntry(cat, bookId, chapter);
  } catch {
    return false;
  }
}

async function cachedResponse(bookId, chapter) {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    return cache.match(proxyPath(bookId, chapter));
  } catch {
    return null;
  }
}

export async function isChapterCached(bookId, chapter) {
  const res = await cachedResponse(bookId, chapter);
  return !!res;
}

export async function countCachedChapters(catalog) {
  if (!("caches" in window) || !catalog?.chapters?.length) return 0;
  const cache = await caches.open(CACHE_NAME);
  let n = 0;
  for (const c of catalog.chapters) {
    if (await cache.match(proxyPath(c.book, c.chapter))) n += 1;
  }
  return n;
}

export function supportsBackgroundFetch() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "BackgroundFetchManager" in window
  );
}

export async function ensureAudioServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    reg = await navigator.serviceWorker.register("/sw.js");
  }
  await navigator.serviceWorker.ready;
  return reg;
}

export async function abortAudioDownload() {
  try {
    if (activeBgFetch) await activeBgFetch.abort();
  } catch {
    /* ignore */
  }
  activeBgFetch = null;
  activeBgFetchId = null;
}

async function missingChapters(catalog) {
  const cache = await caches.open(CACHE_NAME);
  const missing = [];
  for (const c of catalog.chapters) {
    if (!(await cache.match(proxyPath(c.book, c.chapter)))) missing.push(c);
  }
  return missing;
}

function waitForBgFetchDone(reg, fetchId, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      navigator.serviceWorker.removeEventListener("message", onMsg);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      abortAudioDownload().finally(() =>
        reject(new DOMException("Aborted", "AbortError"))
      );
    };
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.fetchId !== fetchId) return;
      if (d.type === "audio-download-done") {
        cleanup();
        resolve({ ok: true, cached: d.cached });
      } else if (d.type === "audio-download-fail") {
        cleanup();
        if (d.reason === "aborted") {
          reject(new DOMException("Aborted", "AbortError"));
        } else {
          reject(new Error(d.reason || "background-fetch-failed"));
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort);
    }
    // fallback: registration.result
    const poll = () => {
      if (!activeBgFetch) return;
      if (activeBgFetch.result === "success") {
        /* SW message should arrive; keep waiting briefly */
      } else if (activeBgFetch.result === "failure") {
        cleanup();
        reject(new Error(activeBgFetch.failureReason || "failure"));
      } else if (activeBgFetch.result === "aborted") {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      }
    };
    activeBgFetch?.addEventListener("progress", poll);
    void reg;
  });
}

function emitMissingProgress(onProgress, opts) {
  const {
    done,
    total,
    startedAt,
    mode,
    bytes,
    bytesTotal,
  } = opts;
  const etaSec =
    bytes != null && bytesTotal
      ? etaFromBytes(bytes, bytesTotal, startedAt)
      : etaFromProgress(done, total, startedAt);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  onProgress?.({
    done,
    total,
    pct,
    etaSec,
    mode,
    bytes,
    bytesTotal,
  });
}

async function downloadViaBackgroundFetch(catalog, missing, onProgress, { signal, title }) {
  const reg = await ensureAudioServiceWorker();
  if (!reg?.backgroundFetch) throw new Error("no-background-fetch");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const missingTotal = missing.length;
  const urls = missing.map((c) => proxyPath(c.book, c.chapter));
  const downloadTotal = Math.ceil(missingTotal * AVG_CHAPTER_BYTES);
  const fetchId = `${BF_ID_PREFIX}${Date.now()}`;
  activeBgFetchId = fetchId;
  const startedAt = Date.now();

  const bg = await reg.backgroundFetch.fetch(fetchId, urls, {
    title: title || "KJV Audio (Scourby)",
    icons: [{ src: "/assets/icon-192.png", sizes: "192x192", type: "image/png" }],
    downloadTotal,
  });
  activeBgFetch = bg;

  const onBfProgress = () => {
    const downloaded = bg.downloaded || 0;
    const totalBytes = bg.downloadTotal || downloadTotal;
    const frac = totalBytes ? Math.min(1, downloaded / totalBytes) : 0;
    const done = Math.min(missingTotal, Math.round(frac * missingTotal));
    emitMissingProgress(onProgress, {
      done,
      total: missingTotal,
      startedAt,
      mode: "background",
      bytes: downloaded,
      bytesTotal: totalBytes,
    });
  };
  bg.addEventListener("progress", onBfProgress);
  onBfProgress();

  try {
    await waitForBgFetchDone(reg, fetchId, signal);
  } finally {
    bg.removeEventListener("progress", onBfProgress);
    activeBgFetch = null;
    activeBgFetchId = null;
  }

  emitMissingProgress(onProgress, {
    done: missingTotal,
    total: missingTotal,
    startedAt,
    mode: "background",
    bytes: downloadTotal,
    bytesTotal: downloadTotal,
  });
  return { done: missingTotal, total: missingTotal, mode: "background" };
}

async function notifyProgress(done, total, etaSec, title, formatEta) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await ensureAudioServiceWorker();
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const eta = formatEta ? formatEta(etaSec) : "";
    const body = eta ? `${done} / ${total} (${pct}%) · ${eta}` : `${done} / ${total} (${pct}%)`;
    const opts = {
      body,
      tag: "ksiag-audio-download",
      renotify: true,
      silent: done > 0 && done < total,
      icon: "/assets/icon-192.png",
    };
    if (reg?.showNotification) await reg.showNotification(title || "KJV Audio", opts);
    else new Notification(title || "KJV Audio", opts);
  } catch {
    /* ignore */
  }
}

async function downloadViaForeground(catalog, missing, onProgress, { signal, title, formatEta }) {
  const missingTotal = missing.length;
  const cache = await caches.open(CACHE_NAME);
  let completed = 0;
  const startedAt = Date.now();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }

  for (const c of missing) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const key = proxyPath(c.book, c.chapter);
    const res = await fetch(key, { signal });
    if (!res.ok) throw new Error(`download ${c.book}/${c.chapter}: ${res.status}`);
    await cache.put(key, res.clone());
    completed += 1;
    const etaSec = etaFromProgress(completed, missingTotal, startedAt);
    emitMissingProgress(onProgress, {
      done: completed,
      total: missingTotal,
      startedAt,
      mode: "foreground",
    });
    if (completed === 1 || completed === missingTotal || completed % 5 === 0) {
      await notifyProgress(completed, missingTotal, etaSec, title, formatEta);
    }
  }
  await notifyProgress(missingTotal, missingTotal, 0, title, formatEta);
  return { done: missingTotal, total: missingTotal, mode: "foreground" };
}

/**
 * Pobierz brakujące rozdziały.
 * Preferuje Background Fetch (pasek w powiadomieniach Android/Chrome).
 * Fallback: fetch w karcie + aktualizowane Notification.
 */
export async function downloadAllAudio(onProgress, { signal, title, formatEta } = {}) {
  const catalog = await loadAudioCatalog();
  const missing = await missingChapters(catalog);
  if (!missing.length) {
    onProgress?.({ done: 0, total: 0, pct: 100, etaSec: 0, mode: "cached" });
    return { done: 0, total: 0, mode: "cached" };
  }

  // Jeden Background Fetch = jeden systemowy pasek dla wszystkich brakujących plików
  if (supportsBackgroundFetch()) {
    try {
      return await downloadViaBackgroundFetch(catalog, missing, onProgress, {
        signal,
        title,
      });
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      console.warn("[66ksiąg] Background Fetch unavailable, foreground fallback:", e);
    }
  }

  return downloadViaForeground(catalog, missing, onProgress, {
    signal,
    title,
    formatEta,
  });
}

export async function clearDownloadedAudio() {
  if (!("caches" in window)) return;
  await caches.delete(CACHE_NAME);
  await abortAudioDownload();
}

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

async function resolvePlaySrc(bookId, chapter, remoteUrl) {
  revokeObjectUrl();
  const hit = await cachedResponse(bookId, chapter);
  if (hit) {
    const blob = await hit.blob();
    objectUrl = URL.createObjectURL(blob);
    return objectUrl;
  }
  return remoteUrl;
}

export function createAudioController({ audioEl, hooks }) {
  let words = [];
  let activeIdx = -1;
  let bookId = null;
  let chapter = null;
  let raf = 0;
  let playing = false;

  function clearHighlight() {
    document.querySelectorAll(".w.is-spoken").forEach((el) => el.classList.remove("is-spoken"));
    activeIdx = -1;
  }

  function highlightAt(t) {
    if (!words.length) return;
    let idx = activeIdx;
    if (idx < 0 || idx >= words.length || t < words[idx].s || t >= words[idx].e) {
      idx = words.findIndex((w) => t >= w.s && t < w.e);
      if (idx < 0) {
        for (let i = words.length - 1; i >= 0; i--) {
          if (t >= words[i].s) {
            idx = i;
            break;
          }
        }
      }
    }
    if (idx < 0 || idx === activeIdx) return;
    document.querySelectorAll(".w.is-spoken").forEach((el) => el.classList.remove("is-spoken"));
    activeIdx = idx;
    const w = words[idx];
    const el = document.querySelector(`#verses li[data-v="${w.v}"] .w[data-i="${w.i}"]`);
    if (el) {
      el.classList.add("is-spoken");
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    hooks.onTick?.({ bookId, chapter, word: w, index: idx });
  }

  function tick() {
    if (!playing) return;
    highlightAt(audioEl.currentTime);
    raf = requestAnimationFrame(tick);
  }

  async function load(editionPath, b, ch) {
    bookId = b;
    chapter = ch;
    clearHighlight();
    words = [];

    const catalog = await loadAudioCatalog();
    const entry = catalogEntry(catalog, b, ch);
    if (!entry?.url) throw new Error("no-audio");

    try {
      const res = await fetch(wordsUrl(editionPath, b, ch));
      if (res.ok) {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("text/html")) {
          const data = await res.json();
          words = (data.words || []).filter((w) => w.s != null && w.e != null);
        }
      }
    } catch {
      /* highlight opcjonalny */
    }

    const src = await resolvePlaySrc(b, ch, entry.url);
    audioEl.src = src;
    await audioEl.play();
    playing = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    hooks.onState?.({ playing: true, bookId, chapter });
  }

  function pause() {
    audioEl.pause();
    playing = false;
    cancelAnimationFrame(raf);
    hooks.onState?.({ playing: false, bookId, chapter });
  }

  function resume() {
    return audioEl.play().then(() => {
      playing = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      hooks.onState?.({ playing: true, bookId, chapter });
    });
  }

  function stop() {
    pause();
    audioEl.removeAttribute("src");
    audioEl.load();
    revokeObjectUrl();
    clearHighlight();
    words = [];
    bookId = null;
    chapter = null;
    hooks.onState?.({ playing: false, bookId: null, chapter: null });
  }

  function isPlaying() {
    return playing && !audioEl.paused;
  }

  function current() {
    return { bookId, chapter, playing: isPlaying() };
  }

  audioEl.addEventListener("ended", () => {
    playing = false;
    cancelAnimationFrame(raf);
    clearHighlight();
    hooks.onChapterEnded?.({ bookId, chapter });
  });

  audioEl.addEventListener("pause", () => {
    if (audioEl.ended) return;
    playing = false;
    cancelAnimationFrame(raf);
    hooks.onState?.({ playing: false, bookId, chapter });
  });

  audioEl.addEventListener("play", () => {
    playing = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    hooks.onState?.({ playing: true, bookId, chapter });
  });

  return { load, pause, resume, stop, isPlaying, current, clearHighlight };
}

export function verseHtmlWithWords(rawHtml, verseNum) {
  const parts = String(rawHtml).split(/(<\/?i>)/i);
  let wi = 0;
  const out = [];
  for (const part of parts) {
    if (/^<\/?i>$/i.test(part)) {
      out.push(part.toLowerCase());
      continue;
    }
    out.push(
      part.replace(/[A-Za-z']+/g, (word) => {
        const span = `<span class="w" data-i="${wi}">${word}</span>`;
        wi += 1;
        return span;
      })
    );
  }
  void verseNum;
  return out.join("");
}
