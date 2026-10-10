/**
 * KJV Scourby audio — stream z internetu (ECFTF), opcjonalny offline cache.
 * MP3 nie są w bundlu aplikacji.
 */

const STORAGE_KEY = "ksiag-audio-v1";
const CACHE_NAME = "ksiag-scourby-mp3-v1";
const CATALOG_URL = "/audio-catalog.json";
/** Szacunek bajtów/rozdział (ECFTF ~1–3 MB) — do paska Background Fetch. */
const AVG_CHAPTER_BYTES = 2.2 * 1024 * 1024;
const BF_BATCH = 250;
const BF_ID_PREFIX = "ksiag-scourby-";

let catalogPromise = null;
let objectUrl = null;
/** @type {BackgroundFetchRegistration | null} */
let activeBgFetch = null;
let activeBgFetchId = null;

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
        return res.json();
      })
      .catch((e) => {
        catalogPromise = null;
        throw e;
      });
  }
  return catalogPromise;
}

export function catalogEntry(catalog, bookId, chapter) {
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

async function downloadViaBackgroundFetch(catalog, missing, onProgress, { signal, title }) {
  const reg = await ensureAudioServiceWorker();
  if (!reg?.backgroundFetch) throw new Error("no-background-fetch");

  const totalAll = catalog.chapters.length;
  const already = totalAll - missing.length;
  let completedMissing = 0;

  for (let i = 0; i < missing.length; i += BF_BATCH) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = missing.slice(i, i + BF_BATCH);
    const urls = batch.map((c) => proxyPath(c.book, c.chapter));
    const batchNo = Math.floor(i / BF_BATCH) + 1;
    const batchCount = Math.ceil(missing.length / BF_BATCH);
    const fetchId = `${BF_ID_PREFIX}${Date.now()}-${batchNo}`;
    activeBgFetchId = fetchId;

    const bg = await reg.backgroundFetch.fetch(fetchId, urls, {
      title:
        batchCount > 1
          ? `${title || "KJV Audio"} (${batchNo}/${batchCount})`
          : title || "KJV Audio (Scourby)",
      icons: [{ src: "/assets/icon-192.png", sizes: "192x192", type: "image/png" }],
      downloadTotal: Math.ceil(batch.length * AVG_CHAPTER_BYTES),
    });
    activeBgFetch = bg;

    const onBfProgress = () => {
      const frac = bg.downloadTotal
        ? Math.min(1, (bg.downloaded || 0) / bg.downloadTotal)
        : 0;
      const batchDone = Math.round(frac * batch.length);
      const done = already + completedMissing + batchDone;
      onProgress?.({
        done: Math.min(done, totalAll),
        total: totalAll,
        mode: "background",
        bytes: bg.downloaded,
        bytesTotal: bg.downloadTotal,
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
    completedMissing += batch.length;
    onProgress?.({
      done: already + completedMissing,
      total: totalAll,
      mode: "background",
    });
  }

  return { done: totalAll, total: totalAll, mode: "background" };
}

async function notifyProgress(done, total, title) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await ensureAudioServiceWorker();
    const body = `${done} / ${total}`;
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

async function downloadViaForeground(catalog, missing, onProgress, { signal, title }) {
  const totalAll = catalog.chapters.length;
  const already = totalAll - missing.length;
  const cache = await caches.open(CACHE_NAME);
  let completed = 0;

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
    const done = already + completed;
    onProgress?.({
      done,
      total: totalAll,
      book: c.book,
      chapter: c.chapter,
      mode: "foreground",
    });
    if (completed === 1 || completed === missing.length || completed % 10 === 0) {
      await notifyProgress(done, totalAll, title);
    }
  }
  await notifyProgress(totalAll, totalAll, title);
  return { done: totalAll, total: totalAll, mode: "foreground" };
}

/**
 * Pobierz brakujące rozdziały.
 * Preferuje Background Fetch (pasek w powiadomieniach Android/Chrome).
 * Fallback: fetch w karcie + aktualizowane Notification.
 */
export async function downloadAllAudio(onProgress, { signal, title } = {}) {
  const catalog = await loadAudioCatalog();
  const missing = await missingChapters(catalog);
  const total = catalog.chapters.length;
  if (!missing.length) {
    onProgress?.({ done: total, total, mode: "cached" });
    return { done: total, total, mode: "cached" };
  }

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

  return downloadViaForeground(catalog, missing, onProgress, { signal, title });
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
