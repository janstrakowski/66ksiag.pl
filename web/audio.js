/**
 * KJV Scourby audio — self-hosted /kjv/1769/{book}/{chapter}.mp3,
 * opcjonalny offline cache (Cache Storage w tej karcie).
 */

const STORAGE_KEY = "ksiag-audio-v1";
const CACHE_NAME = "ksiag-scourby-mp3-v1";
const CATALOG_URL = "/audio-catalog.json";
const AUDIO_BASE = "/kjv/1769";

/** Absolutne URL ikon — Media Session. */
export function appIconList() {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return [
    { src: `${origin}/assets/icon-192.png`, sizes: "192x192", type: "image/png" },
    { src: `${origin}/assets/icon-512.png`, sizes: "512x512", type: "image/png" },
  ];
}

function appIconUrl() {
  return `${typeof location !== "undefined" ? location.origin : ""}/assets/icon-192.png`;
}

let catalogPromise = null;
/** @type {Map<string, object> | null} */
let catalogByKey = null;
let objectUrl = null;

/** @returns {number | null} sekundy */
export function etaFromProgress(done, total, startedAtMs) {
  const elapsed = (Date.now() - startedAtMs) / 1000;
  if (elapsed < 2 || done < 1 || total <= done) return done >= total ? 0 : null;
  const rate = done / elapsed;
  if (rate <= 0) return null;
  return Math.max(0, (total - done) / rate);
}

/**
 * Stan przycisku pobierania na karcie tytułowej.
 * have = rozdziały już zapisane, total = cały katalog, running = pobieranie trwa.
 * Częściowe pobranie nie jest „pobranym”.
 * @returns {{ button: "download"|"cancel"|"resume"|"done", enabled: boolean, status: "hint"|"wanting"|"done", showClear: boolean, have: number, total: number, pct: number }}
 */
export function audioDownloadUi({ have = 0, total = 0, running = false } = {}) {
  const n = Math.max(0, Number(have) || 0);
  const all = Math.max(0, Number(total) || 0);
  const complete = !running && all > 0 && n >= all;
  const partial = n > 0 && !complete;
  let button = "download";
  if (running) button = "cancel";
  else if (partial) button = "resume";
  else if (complete) button = "done";
  let status = "hint";
  if (running || partial) status = "wanting";
  else if (complete) status = "done";
  const pct = all > 0 ? Math.min(100, Math.round((n / all) * 100)) : 0;
  return {
    button,
    enabled: !complete,
    status,
    showClear: !running && n > 0,
    have: n,
    total: all,
    pct,
  };
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

/** Kanoniczna ścieżka MP3 na tym samym originie. */
export function audioPath(bookId, chapter) {
  return `${AUDIO_BASE}/${bookId}/${Number(chapter)}.mp3`;
}

/** @deprecated użyj audioPath — zachowane dla testów / starego SW cache. */
export function proxyPath(bookId, chapter) {
  return audioPath(bookId, chapter);
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
    return cache.match(audioPath(bookId, chapter));
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
    if (await cache.match(audioPath(c.book, c.chapter))) n += 1;
  }
  return n;
}

async function missingChapters(catalog) {
  const cache = await caches.open(CACHE_NAME);
  const missing = [];
  for (const c of catalog.chapters) {
    if (!(await cache.match(audioPath(c.book, c.chapter)))) missing.push(c);
  }
  return missing;
}

function emitMissingProgress(onProgress, opts) {
  const {
    done,
    total,
    have,
    catalog,
    startedAt,
    mode,
    bytes,
    bytesTotal,
  } = opts;
  const etaSec =
    bytes != null && bytesTotal
      ? etaFromBytes(bytes, bytesTotal, startedAt)
      : etaFromProgress(done, total, startedAt);
  const shownHave = have != null ? have : done;
  const shownTotal = catalog != null ? catalog : total;
  const pct = shownTotal > 0 ? Math.min(100, Math.round((shownHave / shownTotal) * 100)) : 0;
  onProgress?.({
    done: shownHave,
    total: shownTotal,
    pct,
    etaSec,
    mode,
    bytes,
    bytesTotal,
  });
}

async function notifyProgress(done, total, etaSec, title, formatEta) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const eta = formatEta ? formatEta(etaSec) : "";
    const body = eta ? `${done} / ${total} · ${eta}` : `${done} / ${total}`;
    const opts = {
      body,
      tag: "ksiag-audio-download",
      renotify: true,
      silent: done > 0 && done < total,
      icon: appIconUrl(),
      badge: appIconUrl(),
    };
    new Notification(title || "66ksiąg · audio", opts);
  } catch {
    /* ignore */
  }
}

async function downloadViaForeground(catalog, missing, onProgress, { signal, title, formatEta }) {
  const missingTotal = missing.length;
  const catalogTotal = catalog.chapters.length;
  const already = catalogTotal - missingTotal;
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

  emitMissingProgress(onProgress, {
    done: 0,
    total: missingTotal,
    have: already,
    catalog: catalogTotal,
    startedAt,
    mode: "foreground",
  });

  for (const c of missing) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const key = audioPath(c.book, c.chapter);
    const res = await fetch(key, { signal });
    if (!res.ok) throw new Error(`download ${c.book}/${c.chapter}: ${res.status}`);
    await cache.put(key, res.clone());
    completed += 1;
    const etaSec = etaFromProgress(completed, missingTotal, startedAt);
    emitMissingProgress(onProgress, {
      done: completed,
      total: missingTotal,
      have: already + completed,
      catalog: catalogTotal,
      startedAt,
      mode: "foreground",
    });
    if (completed === 1 || completed === missingTotal || completed % 5 === 0) {
      await notifyProgress(already + completed, catalogTotal, etaSec, title, formatEta);
    }
  }
  await notifyProgress(catalogTotal, catalogTotal, 0, title, formatEta);
  return { done: catalogTotal, total: catalogTotal, mode: "foreground" };
}

/**
 * Pobierz brakujące rozdziały po kolei w tej karcie.
 * Licznik na stronie rusza dopiero, gdy rozdział jest zapisany — bez Background Fetch.
 */
export async function downloadAllAudio(onProgress, { signal, title, formatEta } = {}) {
  const catalog = await loadAudioCatalog();
  const missing = await missingChapters(catalog);
  if (!missing.length) {
    const catalogTotal = catalog.chapters.length;
    onProgress?.({ done: catalogTotal, total: catalogTotal, pct: 100, etaSec: 0, mode: "cached" });
    return { done: catalogTotal, total: catalogTotal, mode: "cached" };
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

function verseTextFromDom(verseNum) {
  const li = document.querySelector(`#verses li[data-v="${verseNum}"]`);
  if (!li) return "";
  const clone = li.cloneNode(true);
  clone.querySelectorAll(".vn, .num").forEach((n) => n.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function updateMediaSession({ bookId, chapter, verse, verseText, playing }) {
  if (!("mediaSession" in navigator)) return;
  const ref =
    bookId && chapter != null
      ? verse != null
        ? `${bookId} ${chapter}:${verse}`
        : `${bookId} ${chapter}`
      : "66ksiąg";
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: verseText || ref,
      artist: verseText ? ref : "KJV · Scourby",
      album: "66ksiąg",
      artwork: appIconList().map((i) => ({
        src: i.src,
        sizes: i.sizes,
        type: i.type,
      })),
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  } catch {
    /* Media Session opcjonalne */
  }
}

export function createAudioController({ audioEl, hooks }) {
  let words = [];
  let activeIdx = -1;
  let bookId = null;
  let chapter = null;
  let raf = 0;
  let playing = false;
  let mediaVerse = null;

  function clearHighlight() {
    document.querySelectorAll(".w.is-spoken").forEach((el) => el.classList.remove("is-spoken"));
    activeIdx = -1;
  }

  function indexAt(t) {
    const idx = words.findIndex((w) => t >= w.s && t < w.e);
    if (idx >= 0) return idx;
    // Krótka przerwa między słowami — nie gaś podświetlenia. Dłuższa pauza gaśnie.
    let prev = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].s > t) break;
      prev = i;
    }
    if (prev >= 0 && t - words[prev].e <= 0.35) return prev;
    return -1;
  }

  function highlightAt(t) {
    if (!words.length) return;
    const idx = indexAt(t);
    if (idx < 0) {
      if (activeIdx !== -1) clearHighlight();
      return;
    }
    if (idx === activeIdx) return;
    document.querySelectorAll(".w.is-spoken").forEach((el) => el.classList.remove("is-spoken"));
    activeIdx = idx;
    const w = words[idx];
    const el = document.querySelector(`#verses li[data-v="${w.v}"] .w[data-i="${w.i}"]`);
    if (el) {
      el.classList.add("is-spoken");
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (w.v != null && w.v !== mediaVerse) {
      mediaVerse = w.v;
      updateMediaSession({
        bookId,
        chapter,
        verse: w.v,
        verseText: verseTextFromDom(w.v),
        playing: true,
      });
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
    mediaVerse = null;
    updateMediaSession({
      bookId: b,
      chapter: ch,
      verse: null,
      verseText: "",
      playing: true,
    });
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", () => {
          resume().catch(() => {});
        });
        navigator.mediaSession.setActionHandler("pause", () => pause());
        navigator.mediaSession.setActionHandler("stop", () => stop());
      } catch {
        /* ignore */
      }
    }
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
    updateMediaSession({
      bookId,
      chapter,
      verse: mediaVerse,
      verseText: mediaVerse != null ? verseTextFromDom(mediaVerse) : "",
      playing: false,
    });
    hooks.onState?.({ playing: false, bookId, chapter });
  }

  function resume() {
    return audioEl.play().then(() => {
      playing = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      updateMediaSession({
        bookId,
        chapter,
        verse: mediaVerse,
        verseText: mediaVerse != null ? verseTextFromDom(mediaVerse) : "",
        playing: true,
      });
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
    mediaVerse = null;
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {
        /* ignore */
      }
    }
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
