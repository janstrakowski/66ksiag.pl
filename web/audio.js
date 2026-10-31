/**
 * KJV Scourby audio — strumień z /kjv/1769/{book}/{chapter}.mp3.
 * Strona nie zapisuje rozdziałów offline.
 */

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

let catalogPromise = null;
/** @type {Map<string, object> | null} */
let catalogByKey = null;

/** Kanoniczna ścieżka MP3 na tym samym originie. */
export function audioPath(bookId, chapter) {
  return `${AUDIO_BASE}/${bookId}/${Number(chapter)}.mp3`;
}

/** Alias audioPath, zachowany dla testów. */
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

    audioEl.src = entry.url;
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
