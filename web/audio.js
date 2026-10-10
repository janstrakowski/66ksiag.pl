/**
 * KJV Scourby audio — word highlight, plan credit, auto-advance.
 * Audio only for editions with language === "en" and available .mp3 + .words.json.
 */

const STORAGE_KEY = "ksiag-audio-v1";

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
    mode: "idle", // idle | plan | beyond
    offerContinue: false,
    nextBook: null,
    nextChapter: null,
  };
}

export function audioUrls(editionPath, bookId, chapter) {
  const base = `${editionPath}/${bookId}/${chapter}`;
  return { mp3: `${base}.mp3`, words: `${base}.words.json` };
}

export async function chapterHasAudio(editionPath, bookId, chapter) {
  const { mp3, words } = audioUrls(editionPath, bookId, chapter);
  try {
    const w = await fetch(words);
    if (!w.ok) return false;
    const ct = (w.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) return false;
    await w.json();
    const a = await fetch(mp3, { method: "HEAD" });
    return a.ok;
  } catch {
    return false;
  }
}

/**
 * Create player controller bound to DOM.
 * hooks: { onChapterEnded, onTick, onState, t }
 */
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
        // between words — keep previous or find last started
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
    const { mp3, words: wordsUrl } = audioUrls(editionPath, b, ch);
    const res = await fetch(wordsUrl);
    if (!res.ok) throw new Error("words");
    const data = await res.json();
    words = (data.words || []).filter((w) => w.s != null && w.e != null);
    audioEl.src = mp3;
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
    const ended = { bookId, chapter };
    hooks.onChapterEnded?.(ended);
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

/** Wrap verse HTML tokens in <span class="w" data-i> for highlight. */
export function verseHtmlWithWords(rawHtml, verseNum) {
  const parts = String(rawHtml).split(/(<\/?i>)/i);
  let inI = false;
  let wi = 0;
  const out = [];
  for (const part of parts) {
    if (/^<\/?i>$/i.test(part)) {
      inI = part[1] !== "/";
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
