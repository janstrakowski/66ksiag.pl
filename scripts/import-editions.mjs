#!/usr/bin/env node
/**
 * Generate data/bg/1879 and data/kjv/1769 from the git submodules in sources/.
 * Produces the exact same JSON/TXT layout as tools/import and tools/import-kjv,
 * without requiring Cargo in CI. Preserves existing *.mp3 and *.words.json in
 * data/kjv/1769.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skipPerVerse = process.argv.includes("--web-only") || process.env.WORKERS_CI === "1";

const BG_BOOKS = [
  { id: "01-gen", sourceFile: "Genesis", name: "I Mojżeszowa", kjvName: "Genesis", short: "Rdz", kjvShort: "Gen", aliases: ["rdz", "gen", "rodzaju", "1moj"], kjvAliases: ["gen", "genesis", "ge"], testament: "st" },
  { id: "02-exo", sourceFile: "Exodus", name: "II Mojżeszowa", kjvName: "Exodus", short: "Wj", kjvShort: "Exod", aliases: ["wj", "exo", "wyjscia", "2moj"], kjvAliases: ["exo", "exodus", "ex"], testament: "st" },
  { id: "03-lev", sourceFile: "Leviticus", name: "III Mojżeszowa", kjvName: "Leviticus", short: "Kpł", kjvShort: "Lev", aliases: ["kpl", "lev", "kaplanska", "3moj"], kjvAliases: ["lev", "leviticus"], testament: "st" },
  { id: "04-num", sourceFile: "Numbers", name: "IV Mojżeszowa", kjvName: "Numbers", short: "Lb", kjvShort: "Num", aliases: ["lb", "num", "liczb", "4moj"], kjvAliases: ["num", "numbers"], testament: "st" },
  { id: "05-deu", sourceFile: "Deuteronomy", name: "V Mojżeszowa", kjvName: "Deuteronomy", short: "Pwt", kjvShort: "Deut", aliases: ["pwt", "deu", "powtorzonego", "5moj"], kjvAliases: ["deu", "deut", "deuteronomy"], testament: "st" },
  { id: "06-jos", sourceFile: "Joshua", name: "Jozuego", kjvName: "Joshua", short: "Joz", kjvShort: "Josh", aliases: ["joz", "jos", "jozuego"], kjvAliases: ["jos", "josh", "joshua"], testament: "st" },
  { id: "07-jud", sourceFile: "Judges", name: "Sędziów", kjvName: "Judges", short: "Sdz", kjvShort: "Judg", aliases: ["sdz", "jud", "sedziow"], kjvAliases: ["jud", "judg", "judges"], testament: "st" },
  { id: "08-rut", sourceFile: "Ruth", name: "Rut", kjvName: "Ruth", short: "Rt", kjvShort: "Ruth", aliases: ["rt", "rut"], kjvAliases: ["rut", "ruth"], testament: "st" },
  { id: "09-reg", sourceFile: "1Samuel", name: "I Samuelowa", kjvName: "1 Samuel", short: "1Sm", kjvShort: "1Sam", aliases: ["1sm", "1sam", "1reg"], kjvAliases: ["1sam", "1sa", "1samuel"], testament: "st" },
  { id: "10-reg", sourceFile: "2Samuel", name: "II Samuelowa", kjvName: "2 Samuel", short: "2Sm", kjvShort: "2Sam", aliases: ["2sm", "2sam", "2reg"], kjvAliases: ["2sam", "2sa", "2samuel"], testament: "st" },
  { id: "11-reg", sourceFile: "1Kings", name: "I Królewska", kjvName: "1 Kings", short: "1Krl", kjvShort: "1Kgs", aliases: ["1krl", "1kgs", "1kings"], kjvAliases: ["1kgs", "1ki", "1kings"], testament: "st" },
  { id: "12-reg", sourceFile: "2Kings", name: "II Królewska", kjvName: "2 Kings", short: "2Krl", kjvShort: "2Kgs", aliases: ["2krl", "2kgs", "2kings"], kjvAliases: ["2kgs", "2ki", "2kings"], testament: "st" },
  { id: "13-par", sourceFile: "1Chronicles", name: "I Kronik", kjvName: "1 Chronicles", short: "1Krn", kjvShort: "1Chr", aliases: ["1krn", "1chr", "1par"], kjvAliases: ["1chr", "1ch", "1chronicles"], testament: "st" },
  { id: "14-par", sourceFile: "2Chronicles", name: "II Kronik", kjvName: "2 Chronicles", short: "2Krn", kjvShort: "2Chr", aliases: ["2krn", "2chr", "2par"], kjvAliases: ["2chr", "2ch", "2chronicles"], testament: "st" },
  { id: "15-esd", sourceFile: "Ezra", name: "Ezdrasza", kjvName: "Ezra", short: "Ezd", kjvShort: "Ezra", aliases: ["ezd", "ezr", "esd"], kjvAliases: ["ezr", "ezra"], testament: "st" },
  { id: "16-esd", sourceFile: "Nehemiah", name: "Nehemiasza", kjvName: "Nehemiah", short: "Ne", kjvShort: "Neh", aliases: ["ne", "neh", "nehemiasza"], kjvAliases: ["neh", "nehemiah"], testament: "st" },
  { id: "17-est", sourceFile: "Esther", name: "Estery", kjvName: "Esther", short: "Est", kjvShort: "Esth", aliases: ["est", "estery"], kjvAliases: ["est", "esth", "esther"], testament: "st" },
  { id: "18-iob", sourceFile: "Job", name: "Jobowa", kjvName: "Job", short: "Hi", kjvShort: "Job", aliases: ["hi", "job", "iob"], kjvAliases: ["job"], testament: "st" },
  { id: "19-psa", sourceFile: "Psalms", name: "Psalmów", kjvName: "Psalms", short: "Ps", kjvShort: "Ps", aliases: ["ps", "psa", "psalmy"], kjvAliases: ["ps", "psa", "psalm", "psalms"], testament: "st" },
  { id: "20-pro", sourceFile: "Proverbs", name: "Przypowieści Salomonowych", kjvName: "Proverbs", short: "Prz", kjvShort: "Prov", aliases: ["prz", "pro", "przyslow"], kjvAliases: ["pro", "prov", "proverbs"], testament: "st" },
  { id: "21-ecc", sourceFile: "Ecclesiastes", name: "Kaznodziei Salomona", kjvName: "Ecclesiastes", short: "Koh", kjvShort: "Eccl", aliases: ["koh", "ecc", "kaznodziei"], kjvAliases: ["ecc", "eccl", "ecclesiastes"], testament: "st" },
  { id: "22-can", sourceFile: "SongofSolomon", name: "Pieśń nad Pieśniami", kjvName: "Song of Solomon", short: "Pnp", kjvShort: "Song", aliases: ["pnp", "can", "piesn"], kjvAliases: ["song", "sos", "canticle"], testament: "st" },
  { id: "23-esa", sourceFile: "Isaiah", name: "Izajasza", kjvName: "Isaiah", short: "Iz", kjvShort: "Isa", aliases: ["iz", "isa", "esa", "izajasza"], kjvAliases: ["isa", "isaiah"], testament: "st" },
  { id: "24-ier", sourceFile: "Jeremiah", name: "Jeremiasza", kjvName: "Jeremiah", short: "Jr", kjvShort: "Jer", aliases: ["jr", "jer", "ier", "jeremiasza"], kjvAliases: ["jer", "jeremiah"], testament: "st" },
  { id: "25-lam", sourceFile: "Lamentations", name: "Treny", kjvName: "Lamentations", short: "Lm", kjvShort: "Lam", aliases: ["lm", "lam", "treny"], kjvAliases: ["lam", "lamentations"], testament: "st" },
  { id: "26-eze", sourceFile: "Ezekiel", name: "Ezekiela", kjvName: "Ezekiel", short: "Ez", kjvShort: "Ezek", aliases: ["ez", "eze", "ezechiela"], kjvAliases: ["eze", "ezek", "ezekiel"], testament: "st" },
  { id: "27-dan", sourceFile: "Daniel", name: "Daniela", kjvName: "Daniel", short: "Dn", kjvShort: "Dan", aliases: ["dn", "dan", "daniela"], kjvAliases: ["dan", "daniel"], testament: "st" },
  { id: "28-ose", sourceFile: "Hosea", name: "Ozeasza", kjvName: "Hosea", short: "Oz", kjvShort: "Hos", aliases: ["oz", "hos", "ose", "ozeasza"], kjvAliases: ["hos", "hosea"], testament: "st" },
  { id: "29-ioe", sourceFile: "Joel", name: "Joela", kjvName: "Joel", short: "Jl", kjvShort: "Joel", aliases: ["jl", "joe", "ioe", "joela"], kjvAliases: ["joel", "joe"], testament: "st" },
  { id: "30-amo", sourceFile: "Amos", name: "Amosa", kjvName: "Amos", short: "Am", kjvShort: "Amos", aliases: ["am", "amo", "amosa"], kjvAliases: ["amos", "amo"], testament: "st" },
  { id: "31-abd", sourceFile: "Obadiah", name: "Abdyjasza", kjvName: "Obadiah", short: "Ab", kjvShort: "Obad", aliases: ["ab", "obd", "abd"], kjvAliases: ["oba", "obad", "obadiah"], testament: "st" },
  { id: "32-ion", sourceFile: "Jonah", name: "Jonasza", kjvName: "Jonah", short: "Jon", kjvShort: "Jonah", aliases: ["jon", "ion", "jonasza"], kjvAliases: ["jon", "jonah"], testament: "st" },
  { id: "33-mic", sourceFile: "Micah", name: "Micheasza", kjvName: "Micah", short: "Mi", kjvShort: "Mic", aliases: ["mi", "mic", "micheasza"], kjvAliases: ["mic", "micah"], testament: "st" },
  { id: "34-nah", sourceFile: "Nahum", name: "Nahuma", kjvName: "Nahum", short: "Na", kjvShort: "Nah", aliases: ["na", "nah", "nahuma"], kjvAliases: ["nah", "nahum"], testament: "st" },
  { id: "35-hab", sourceFile: "Habakkuk", name: "Habakuka", kjvName: "Habakkuk", short: "Ha", kjvShort: "Hab", aliases: ["ha", "hab", "habakuka"], kjvAliases: ["hab", "habakkuk"], testament: "st" },
  { id: "36-sop", sourceFile: "Zephaniah", name: "Sofoniasza", kjvName: "Zephaniah", short: "So", kjvShort: "Zeph", aliases: ["so", "zep", "sop", "sofoniasza"], kjvAliases: ["zep", "zeph", "zephaniah"], testament: "st" },
  { id: "37-agg", sourceFile: "Haggai", name: "Aggieusza", kjvName: "Haggai", short: "Ag", kjvShort: "Hag", aliases: ["ag", "hag", "agg"], kjvAliases: ["hag", "haggai"], testament: "st" },
  { id: "38-zac", sourceFile: "Zechariah", name: "Zachariasza", kjvName: "Zechariah", short: "Za", kjvShort: "Zech", aliases: ["za", "zec", "zac", "zachariasza"], kjvAliases: ["zec", "zech", "zechariah"], testament: "st" },
  { id: "39-mal", sourceFile: "Malachi", name: "Malachiasza", kjvName: "Malachi", short: "Ml", kjvShort: "Mal", aliases: ["ml", "mal", "malachiasza"], kjvAliases: ["mal", "malachi"], testament: "st" },
  { id: "40-mat", sourceFile: "Matthew", name: "Ewangelia Mateusza", kjvName: "Matthew", short: "Mt", kjvShort: "Matt", aliases: ["mt", "mat", "mateusz"], kjvAliases: ["mat", "matt", "matthew"], testament: "nt" },
  { id: "41-mar", sourceFile: "Mark", name: "Ewangelia Marka", kjvName: "Mark", short: "Mk", kjvShort: "Mark", aliases: ["mk", "mar", "marek"], kjvAliases: ["mar", "mark", "mrk"], testament: "nt" },
  { id: "42-luc", sourceFile: "Luke", name: "Ewangelia Łukasza", kjvName: "Luke", short: "Łk", kjvShort: "Luke", aliases: ["lk", "luc", "lukasz"], kjvAliases: ["luk", "luke"], testament: "nt" },
  { id: "43-joh", sourceFile: "John", name: "Ewangelia Jana", kjvName: "John", short: "J", kjvShort: "John", aliases: ["j", "jn", "jan", "joh", "john"], kjvAliases: ["j", "jn", "joh", "john"], testament: "nt" },
  { id: "44-act", sourceFile: "Acts", name: "Dzieje Apostolskie", kjvName: "Acts", short: "Dz", kjvShort: "Acts", aliases: ["dz", "act", "dzieje"], kjvAliases: ["act", "acts"], testament: "nt" },
  { id: "45-rom", sourceFile: "Romans", name: "List do Rzymian", kjvName: "Romans", short: "Rz", kjvShort: "Rom", aliases: ["rz", "rom", "rzymian"], kjvAliases: ["rom", "romans"], testament: "nt" },
  { id: "46-cor", sourceFile: "1Corinthians", name: "I List do Koryntian", kjvName: "1 Corinthians", short: "1Kor", kjvShort: "1Cor", aliases: ["1kor", "1cor"], kjvAliases: ["1cor", "1co"], testament: "nt" },
  { id: "47-cor", sourceFile: "2Corinthians", name: "II List do Koryntian", kjvName: "2 Corinthians", short: "2Kor", kjvShort: "2Cor", aliases: ["2kor", "2cor"], kjvAliases: ["2cor", "2co"], testament: "nt" },
  { id: "48-gal", sourceFile: "Galatians", name: "List do Galatów", kjvName: "Galatians", short: "Ga", kjvShort: "Gal", aliases: ["ga", "gal", "galatow"], kjvAliases: ["gal", "galatians"], testament: "nt" },
  { id: "49-eph", sourceFile: "Ephesians", name: "List do Efezjan", kjvName: "Ephesians", short: "Ef", kjvShort: "Eph", aliases: ["ef", "eph", "efezjan"], kjvAliases: ["eph", "ephesians"], testament: "nt" },
  { id: "50-phi", sourceFile: "Philippians", name: "List do Filipian", kjvName: "Philippians", short: "Flp", kjvShort: "Phil", aliases: ["flp", "php", "phi", "filipian"], kjvAliases: ["php", "phil", "philippians"], testament: "nt" },
  { id: "51-col", sourceFile: "Colossians", name: "List do Kolosan", kjvName: "Colossians", short: "Kol", kjvShort: "Col", aliases: ["kol", "col", "kolosan"], kjvAliases: ["col", "colossians"], testament: "nt" },
  { id: "52-the", sourceFile: "1Thessalonians", name: "I List do Tesaloniczan", kjvName: "1 Thessalonians", short: "1Tes", kjvShort: "1Thess", aliases: ["1tes", "1th", "1the"], kjvAliases: ["1th", "1thess", "1the"], testament: "nt" },
  { id: "53-the", sourceFile: "2Thessalonians", name: "II List do Tesaloniczan", kjvName: "2 Thessalonians", short: "2Tes", kjvShort: "2Thess", aliases: ["2tes", "2th", "2the"], kjvAliases: ["2th", "2thess", "2the"], testament: "nt" },
  { id: "54-tim", sourceFile: "1Timothy", name: "I List do Tymoteusza", kjvName: "1 Timothy", short: "1Tm", kjvShort: "1Tim", aliases: ["1tm", "1ti", "1tim"], kjvAliases: ["1ti", "1tim", "1timothy"], testament: "nt" },
  { id: "55-tim", sourceFile: "2Timothy", name: "II List do Tymoteusza", kjvName: "2 Timothy", short: "2Tm", kjvShort: "2Tim", aliases: ["2tm", "2ti", "2tim"], kjvAliases: ["2ti", "2tim", "2timothy"], testament: "nt" },
  { id: "56-tit", sourceFile: "Titus", name: "List do Tytusa", kjvName: "Titus", short: "Tt", kjvShort: "Titus", aliases: ["tt", "tit", "tytus"], kjvAliases: ["tit", "titus"], testament: "nt" },
  { id: "57-phi", sourceFile: "Philemon", name: "List do Filemona", kjvName: "Philemon", short: "Flm", kjvShort: "Phlm", aliases: ["flm", "phm", "filemon"], kjvAliases: ["phm", "phlm", "philemon"], testament: "nt" },
  { id: "58-heb", sourceFile: "Hebrews", name: "List do Hebrajczyków", kjvName: "Hebrews", short: "Hbr", kjvShort: "Heb", aliases: ["hbr", "heb", "hebrajczykow"], kjvAliases: ["heb", "hebrews"], testament: "nt" },
  { id: "59-jac", sourceFile: "James", name: "List Jakuba", kjvName: "James", short: "Jk", kjvShort: "Jas", aliases: ["jk", "jas", "jac", "jakub"], kjvAliases: ["jas", "jam", "james"], testament: "nt" },
  { id: "60-pet", sourceFile: "1Peter", name: "I List Piotra", kjvName: "1 Peter", short: "1P", kjvShort: "1Pet", aliases: ["1p", "1pe", "1pet", "1piotr"], kjvAliases: ["1pe", "1pet", "1peter"], testament: "nt" },
  { id: "61-pet", sourceFile: "2Peter", name: "II List Piotra", kjvName: "2 Peter", short: "2P", kjvShort: "2Pet", aliases: ["2p", "2pe", "2pet", "2piotr"], kjvAliases: ["2pe", "2pet", "2peter"], testament: "nt" },
  { id: "62-joh", sourceFile: "1John", name: "I List Jana", kjvName: "1 John", short: "1J", kjvShort: "1John", aliases: ["1j", "1jn", "1jan", "1joh"], kjvAliases: ["1jn", "1jo", "1john"], testament: "nt" },
  { id: "63-joh", sourceFile: "2John", name: "II List Jana", kjvName: "2 John", short: "2J", kjvShort: "2John", aliases: ["2j", "2jn", "2jan", "2joh"], kjvAliases: ["2jn", "2jo", "2john"], testament: "nt" },
  { id: "64-joh", sourceFile: "3John", name: "3 List Jana", kjvName: "3 John", short: "3J", kjvShort: "3John", aliases: ["3j", "3jn", "3jan", "3joh"], kjvAliases: ["3jn", "3jo", "3john"], testament: "nt" },
  { id: "65-jud", sourceFile: "Jude", name: "List Judy", kjvName: "Jude", short: "Jud", kjvShort: "Jude", aliases: ["jud", "judy"], kjvAliases: ["jud", "jude"], testament: "nt" },
  { id: "66-apo", sourceFile: "Revelation", name: "Objawienie Jana", kjvName: "Revelation", short: "Ap", kjvShort: "Rev", aliases: ["ap", "rev", "apo", "objawienie"], kjvAliases: ["rev", "revelation", "apo"], testament: "nt" },
];
// Match exact BG names from tools/import/src/books.rs
BG_BOOKS[25].name = "Ezechiela";
BG_BOOKS[63].name = "III List Jana";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function stripTags(s) {
  let out = "";
  let inTag = false;
  for (const c of s) {
    if (c === "<") inTag = true;
    else if (c === ">") inTag = false;
    else if (!inTag) out += c;
  }
  return out;
}

function ensureSubmodules() {
  const bgDir = join(ROOT, "sources/biblia-druk-tekst/1879");
  const kjvFile = join(ROOT, "sources/bible-kjv/Genesis.json");
  if (!existsSync(bgDir) || !existsSync(kjvFile)) {
    console.log("Initializing text submodules in sources/...");
    execFileSync("git", ["submodule", "update", "--init", "--depth", "1"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
}

function submoduleCommit(relPath) {
  try {
    return execFileSync("git", ["-C", join(ROOT, relPath), "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function importBg() {
  const srcRoot = join(ROOT, "sources/biblia-druk-tekst/1879");
  const destRoot = join(ROOT, "data/bg/1879");
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  const books = [];
  let totalChapters = 0;

  for (const meta of BG_BOOKS) {
    const bookSrc = join(srcRoot, meta.id);
    const bookDest = join(destRoot, meta.id);
    mkdirSync(bookDest, { recursive: true });

    const files = readdirSync(bookSrc)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => ({ chapter: Number.parseInt(f.slice(0, -4), 10), file: f }))
      .filter((x) => Number.isFinite(x.chapter))
      .sort((a, b) => a.chapter - b.chapter);

    writeJson(join(bookDest, "book.json"), {
      aliases: meta.aliases,
      chapters: files.length,
      edition: "1879",
      id: meta.id,
      name: meta.name,
      short: meta.short,
      testament: meta.testament,
      translation: "bg",
    });

    for (const { chapter, file } of files) {
      const raw = readFileSync(join(bookSrc, file), "utf8");
      const lines = raw.split(/\r?\n/);
      const verses = [];
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].replace(/\s+$/, "");
        if (!t) continue;
        verses.push({ n: i + 1, t });
      }

      writeJson(join(bookDest, `${chapter}.json`), {
        translation: "bg",
        edition: "1879",
        book: meta.id,
        chapter,
        verses,
      });

      if (!skipPerVerse) {
        let txt = `# bg/1879 ${meta.id} ${chapter}\n`;
        for (const v of verses) txt += `${v.n} ${stripTags(v.t)}\n`;
        writeFileSync(join(bookDest, `${chapter}.txt`), txt);

        const verseDir = join(bookDest, String(chapter));
        mkdirSync(verseDir, { recursive: true });
        for (const v of verses) {
          writeJson(join(verseDir, `${v.n}.json`), {
            translation: "bg",
            edition: "1879",
            book: meta.id,
            chapter,
            verse: v.n,
            t: v.t,
          });
          writeFileSync(
            join(verseDir, `${v.n}.txt`),
            `# bg/1879 ${meta.id} ${chapter}:${v.n}\n${stripTags(v.t)}\n`
          );
        }
      }
    }

    totalChapters += files.length;
    books.push({
      id: meta.id,
      name: meta.name,
      short: meta.short,
      aliases: meta.aliases,
      testament: meta.testament,
      chapters: files.length,
    });
  }

  writeJson(join(destRoot, "books.json"), {
    translation: "bg",
    edition: "1879",
    books,
  });

  writeJson(join(destRoot, "manifest.json"), {
    translation: "bg",
    edition: "1879",
    title: "Biblia Gdańska",
    language: "pl",
    api_version: "1",
    source: {
      name: "UczenJezusa/biblia-druk-tekst",
      url: "https://github.com/UczenJezusa/biblia-druk-tekst",
      commit: submoduleCommit("sources/biblia-druk-tekst"),
      path: "1879",
    },
    formats: ["json", "txt"],
    llms_txt: "/llms.txt",
    books: "./books.json",
  });

  console.log(`OK → data/bg/1879 (${books.length} books, ${totalChapters} chapters)`);
}

function importKjv() {
  const srcRoot = join(ROOT, "sources/bible-kjv");
  const destRoot = join(ROOT, "data/kjv/1769");
  mkdirSync(destRoot, { recursive: true });

  const books = [];
  let totalChapters = 0;

  for (const meta of BG_BOOKS) {
    const raw = readFileSync(join(srcRoot, `${meta.sourceFile}.json`), "utf8");
    const parsed = JSON.parse(raw);
    const bookDest = join(destRoot, meta.id);
    mkdirSync(bookDest, { recursive: true });

    writeJson(join(bookDest, "book.json"), {
      aliases: meta.kjvAliases,
      chapters: parsed.chapters.length,
      edition: "1769",
      id: meta.id,
      name: meta.kjvName,
      short: meta.kjvShort,
      testament: meta.testament,
      translation: "kjv",
    });

    for (const ch of parsed.chapters) {
      const chapter = Number.parseInt(ch.chapter, 10);
      const verses = ch.verses
        .map((v) => ({
          n: Number.parseInt(v.verse, 10) || 0,
          t: v.text.trim(),
        }))
        .filter((v) => v.n > 0 && v.t.length > 0);

      writeJson(join(bookDest, `${chapter}.json`), {
        translation: "kjv",
        edition: "1769",
        book: meta.id,
        chapter,
        verses,
      });

      if (!skipPerVerse) {
        let txt = `# kjv/1769 ${meta.id} ${chapter}\n`;
        for (const v of verses) txt += `${v.n} ${v.t}\n`;
        writeFileSync(join(bookDest, `${chapter}.txt`), txt);

        const verseDir = join(bookDest, String(chapter));
        mkdirSync(verseDir, { recursive: true });
        for (const v of verses) {
          writeJson(join(verseDir, `${v.n}.json`), {
            translation: "kjv",
            edition: "1769",
            book: meta.id,
            chapter,
            verse: v.n,
            t: v.t,
          });
          writeFileSync(
            join(verseDir, `${v.n}.txt`),
            `# kjv/1769 ${meta.id} ${chapter}:${v.n}\n${v.t}\n`
          );
        }
      }
    }

    totalChapters += parsed.chapters.length;
    books.push({
      id: meta.id,
      name: meta.kjvName,
      short: meta.kjvShort,
      aliases: meta.kjvAliases,
      testament: meta.testament,
      chapters: parsed.chapters.length,
    });
  }

  writeJson(join(destRoot, "books.json"), {
    translation: "kjv",
    edition: "1769",
    numbering: "kjv",
    books,
  });

  writeJson(join(destRoot, "manifest.json"), {
    translation: "kjv",
    edition: "1769",
    title: "King James Version",
    language: "en",
    api_version: "1",
    numbering: "kjv",
    source: {
      name: "aruljohn/Bible-kjv",
      url: "https://github.com/aruljohn/Bible-kjv",
      commit: submoduleCommit("sources/bible-kjv"),
      note: "Public-domain KJV text (commonly 1769 Blayney lineage). UI inspiration: 1611 folio scans.",
    },
    formats: ["json", "txt"],
    llms_txt: "/llms.txt",
    books: "./books.json",
  });

  writeJson(join(ROOT, "data/translations.json"), {
    api_version: "1",
    note: "All translations in this project share KJV/Protestant chapter–verse numbering (BG remapped).",
    numbering: "kjv",
    translations: [
      { edition: "1879", id: "bg", language: "pl", path: "/bg/1879", title: "Biblia Gdańska" },
      { edition: "1769", id: "kjv", language: "en", path: "/kjv/1769", title: "King James Version" },
    ],
  });

  console.log(`OK → data/kjv/1769 (${books.length} books, ${totalChapters} chapters)`);
}

ensureSubmodules();
importBg();
importKjv();
