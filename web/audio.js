/**
 * KJV Scourby audio — stream z internetu (ECFTF), opcjonalny offline cache.
 * MP3 nie są w bundlu aplikacji.
 */

const STORAGE_KEY = "ksiag-audio-v1";
const CACHE_NAME = "ksiag-scourby-mp3-v1";
const CATALOG_URL = "/audio-catalog.json";

let catalogPromise = null;
let objectUrl = null;

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

/**
 * Pobierz wszystkie rozdziały do Cache Storage (przez same-origin proxy — CORS).
 * onProgress({ done, total, book, chapter })
 */
export async function downloadAllAudio(onProgress, { signal } = {}) {
  const catalog = await loadAudioCatalog();
  const total = catalog.chapters.length;
  const cache = await caches.open(CACHE_NAME);
  let done = 0;
  for (const c of catalog.chapters) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const key = proxyPath(c.book, c.chapter);
    const hit = await cache.match(key);
    if (!hit) {
      const res = await fetch(key, { signal });
      if (!res.ok) throw new Error(`download ${c.book}/${c.chapter}: ${res.status}`);
      await cache.put(key, res.clone());
    }
    done += 1;
    onProgress?.({ done, total, book: c.book, chapter: c.chapter });
  }
  return { done, total };
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
