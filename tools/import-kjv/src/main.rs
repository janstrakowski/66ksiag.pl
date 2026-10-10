//! Import KJV (aruljohn/Bible-kjv) → data/kjv/1769
//! Te same kanoniczne ID ksiąg co BG (`01-gen` … `66-apo`) — numeracja protestancka / KJV.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const TRANSLATION: &str = "kjv";
const EDITION: &str = "1769";
const API_VERSION: &str = "1";

struct BookMeta {
    id: &'static str,
    /// Nazwa pliku w aruljohn/Bible-kjv (bez .json), np. "1Samuel"
    source_file: &'static str,
    name: &'static str,
    short: &'static str,
    aliases: &'static [&'static str],
    testament: &'static str,
}

/// Kolejność i ID identyczne z BG — wspólny plan / remap.
const BOOKS: &[BookMeta] = &[
    BookMeta { id: "01-gen", source_file: "Genesis", name: "Genesis", short: "Gen", aliases: &["gen", "genesis", "ge"], testament: "st" },
    BookMeta { id: "02-exo", source_file: "Exodus", name: "Exodus", short: "Exod", aliases: &["exo", "exodus", "ex"], testament: "st" },
    BookMeta { id: "03-lev", source_file: "Leviticus", name: "Leviticus", short: "Lev", aliases: &["lev", "leviticus"], testament: "st" },
    BookMeta { id: "04-num", source_file: "Numbers", name: "Numbers", short: "Num", aliases: &["num", "numbers"], testament: "st" },
    BookMeta { id: "05-deu", source_file: "Deuteronomy", name: "Deuteronomy", short: "Deut", aliases: &["deu", "deut", "deuteronomy"], testament: "st" },
    BookMeta { id: "06-jos", source_file: "Joshua", name: "Joshua", short: "Josh", aliases: &["jos", "josh", "joshua"], testament: "st" },
    BookMeta { id: "07-jud", source_file: "Judges", name: "Judges", short: "Judg", aliases: &["jud", "judg", "judges"], testament: "st" },
    BookMeta { id: "08-rut", source_file: "Ruth", name: "Ruth", short: "Ruth", aliases: &["rut", "ruth"], testament: "st" },
    BookMeta { id: "09-reg", source_file: "1Samuel", name: "1 Samuel", short: "1Sam", aliases: &["1sam", "1sa", "1samuel"], testament: "st" },
    BookMeta { id: "10-reg", source_file: "2Samuel", name: "2 Samuel", short: "2Sam", aliases: &["2sam", "2sa", "2samuel"], testament: "st" },
    BookMeta { id: "11-reg", source_file: "1Kings", name: "1 Kings", short: "1Kgs", aliases: &["1kgs", "1ki", "1kings"], testament: "st" },
    BookMeta { id: "12-reg", source_file: "2Kings", name: "2 Kings", short: "2Kgs", aliases: &["2kgs", "2ki", "2kings"], testament: "st" },
    BookMeta { id: "13-par", source_file: "1Chronicles", name: "1 Chronicles", short: "1Chr", aliases: &["1chr", "1ch", "1chronicles"], testament: "st" },
    BookMeta { id: "14-par", source_file: "2Chronicles", name: "2 Chronicles", short: "2Chr", aliases: &["2chr", "2ch", "2chronicles"], testament: "st" },
    BookMeta { id: "15-esd", source_file: "Ezra", name: "Ezra", short: "Ezra", aliases: &["ezr", "ezra"], testament: "st" },
    BookMeta { id: "16-esd", source_file: "Nehemiah", name: "Nehemiah", short: "Neh", aliases: &["neh", "nehemiah"], testament: "st" },
    BookMeta { id: "17-est", source_file: "Esther", name: "Esther", short: "Esth", aliases: &["est", "esth", "esther"], testament: "st" },
    BookMeta { id: "18-iob", source_file: "Job", name: "Job", short: "Job", aliases: &["job"], testament: "st" },
    BookMeta { id: "19-psa", source_file: "Psalms", name: "Psalms", short: "Ps", aliases: &["ps", "psa", "psalm", "psalms"], testament: "st" },
    BookMeta { id: "20-pro", source_file: "Proverbs", name: "Proverbs", short: "Prov", aliases: &["pro", "prov", "proverbs"], testament: "st" },
    BookMeta { id: "21-ecc", source_file: "Ecclesiastes", name: "Ecclesiastes", short: "Eccl", aliases: &["ecc", "eccl", "ecclesiastes"], testament: "st" },
    BookMeta { id: "22-can", source_file: "SongofSolomon", name: "Song of Solomon", short: "Song", aliases: &["song", "sos", "canticle"], testament: "st" },
    BookMeta { id: "23-esa", source_file: "Isaiah", name: "Isaiah", short: "Isa", aliases: &["isa", "isaiah"], testament: "st" },
    BookMeta { id: "24-ier", source_file: "Jeremiah", name: "Jeremiah", short: "Jer", aliases: &["jer", "jeremiah"], testament: "st" },
    BookMeta { id: "25-lam", source_file: "Lamentations", name: "Lamentations", short: "Lam", aliases: &["lam", "lamentations"], testament: "st" },
    BookMeta { id: "26-eze", source_file: "Ezekiel", name: "Ezekiel", short: "Ezek", aliases: &["eze", "ezek", "ezekiel"], testament: "st" },
    BookMeta { id: "27-dan", source_file: "Daniel", name: "Daniel", short: "Dan", aliases: &["dan", "daniel"], testament: "st" },
    BookMeta { id: "28-ose", source_file: "Hosea", name: "Hosea", short: "Hos", aliases: &["hos", "hosea"], testament: "st" },
    BookMeta { id: "29-ioe", source_file: "Joel", name: "Joel", short: "Joel", aliases: &["joel", "joe"], testament: "st" },
    BookMeta { id: "30-amo", source_file: "Amos", name: "Amos", short: "Amos", aliases: &["amos", "amo"], testament: "st" },
    BookMeta { id: "31-abd", source_file: "Obadiah", name: "Obadiah", short: "Obad", aliases: &["oba", "obad", "obadiah"], testament: "st" },
    BookMeta { id: "32-ion", source_file: "Jonah", name: "Jonah", short: "Jonah", aliases: &["jon", "jonah"], testament: "st" },
    BookMeta { id: "33-mic", source_file: "Micah", name: "Micah", short: "Mic", aliases: &["mic", "micah"], testament: "st" },
    BookMeta { id: "34-nah", source_file: "Nahum", name: "Nahum", short: "Nah", aliases: &["nah", "nahum"], testament: "st" },
    BookMeta { id: "35-hab", source_file: "Habakkuk", name: "Habakkuk", short: "Hab", aliases: &["hab", "habakkuk"], testament: "st" },
    BookMeta { id: "36-sop", source_file: "Zephaniah", name: "Zephaniah", short: "Zeph", aliases: &["zep", "zeph", "zephaniah"], testament: "st" },
    BookMeta { id: "37-agg", source_file: "Haggai", name: "Haggai", short: "Hag", aliases: &["hag", "haggai"], testament: "st" },
    BookMeta { id: "38-zac", source_file: "Zechariah", name: "Zechariah", short: "Zech", aliases: &["zec", "zech", "zechariah"], testament: "st" },
    BookMeta { id: "39-mal", source_file: "Malachi", name: "Malachi", short: "Mal", aliases: &["mal", "malachi"], testament: "st" },
    BookMeta { id: "40-mat", source_file: "Matthew", name: "Matthew", short: "Matt", aliases: &["mat", "matt", "matthew"], testament: "nt" },
    BookMeta { id: "41-mar", source_file: "Mark", name: "Mark", short: "Mark", aliases: &["mar", "mark", "mrk"], testament: "nt" },
    BookMeta { id: "42-luc", source_file: "Luke", name: "Luke", short: "Luke", aliases: &["luk", "luke"], testament: "nt" },
    BookMeta { id: "43-joh", source_file: "John", name: "John", short: "John", aliases: &["j", "jn", "joh", "john"], testament: "nt" },
    BookMeta { id: "44-act", source_file: "Acts", name: "Acts", short: "Acts", aliases: &["act", "acts"], testament: "nt" },
    BookMeta { id: "45-rom", source_file: "Romans", name: "Romans", short: "Rom", aliases: &["rom", "romans"], testament: "nt" },
    BookMeta { id: "46-cor", source_file: "1Corinthians", name: "1 Corinthians", short: "1Cor", aliases: &["1cor", "1co"], testament: "nt" },
    BookMeta { id: "47-cor", source_file: "2Corinthians", name: "2 Corinthians", short: "2Cor", aliases: &["2cor", "2co"], testament: "nt" },
    BookMeta { id: "48-gal", source_file: "Galatians", name: "Galatians", short: "Gal", aliases: &["gal", "galatians"], testament: "nt" },
    BookMeta { id: "49-eph", source_file: "Ephesians", name: "Ephesians", short: "Eph", aliases: &["eph", "ephesians"], testament: "nt" },
    BookMeta { id: "50-phi", source_file: "Philippians", name: "Philippians", short: "Phil", aliases: &["php", "phil", "philippians"], testament: "nt" },
    BookMeta { id: "51-col", source_file: "Colossians", name: "Colossians", short: "Col", aliases: &["col", "colossians"], testament: "nt" },
    BookMeta { id: "52-the", source_file: "1Thessalonians", name: "1 Thessalonians", short: "1Thess", aliases: &["1th", "1thess", "1the"], testament: "nt" },
    BookMeta { id: "53-the", source_file: "2Thessalonians", name: "2 Thessalonians", short: "2Thess", aliases: &["2th", "2thess", "2the"], testament: "nt" },
    BookMeta { id: "54-tim", source_file: "1Timothy", name: "1 Timothy", short: "1Tim", aliases: &["1ti", "1tim", "1timothy"], testament: "nt" },
    BookMeta { id: "55-tim", source_file: "2Timothy", name: "2 Timothy", short: "2Tim", aliases: &["2ti", "2tim", "2timothy"], testament: "nt" },
    BookMeta { id: "56-tit", source_file: "Titus", name: "Titus", short: "Titus", aliases: &["tit", "titus"], testament: "nt" },
    BookMeta { id: "57-phi", source_file: "Philemon", name: "Philemon", short: "Phlm", aliases: &["phm", "phlm", "philemon"], testament: "nt" },
    BookMeta { id: "58-heb", source_file: "Hebrews", name: "Hebrews", short: "Heb", aliases: &["heb", "hebrews"], testament: "nt" },
    BookMeta { id: "59-jac", source_file: "James", name: "James", short: "Jas", aliases: &["jas", "jam", "james"], testament: "nt" },
    BookMeta { id: "60-pet", source_file: "1Peter", name: "1 Peter", short: "1Pet", aliases: &["1pe", "1pet", "1peter"], testament: "nt" },
    BookMeta { id: "61-pet", source_file: "2Peter", name: "2 Peter", short: "2Pet", aliases: &["2pe", "2pet", "2peter"], testament: "nt" },
    BookMeta { id: "62-joh", source_file: "1John", name: "1 John", short: "1John", aliases: &["1jn", "1jo", "1john"], testament: "nt" },
    BookMeta { id: "63-joh", source_file: "2John", name: "2 John", short: "2John", aliases: &["2jn", "2jo", "2john"], testament: "nt" },
    BookMeta { id: "64-joh", source_file: "3John", name: "3 John", short: "3John", aliases: &["3jn", "3jo", "3john"], testament: "nt" },
    BookMeta { id: "65-jud", source_file: "Jude", name: "Jude", short: "Jude", aliases: &["jud", "jude"], testament: "nt" },
    BookMeta { id: "66-apo", source_file: "Revelation", name: "Revelation", short: "Rev", aliases: &["rev", "revelation", "apo"], testament: "nt" },
];

#[derive(Deserialize)]
struct SourceBook {
    chapters: Vec<SourceChapter>,
}

#[derive(Deserialize)]
struct SourceChapter {
    chapter: String,
    verses: Vec<SourceVerse>,
}

#[derive(Deserialize)]
struct SourceVerse {
    verse: String,
    text: String,
}

#[derive(Serialize)]
struct Manifest {
    translation: &'static str,
    edition: &'static str,
    title: &'static str,
    language: &'static str,
    api_version: &'static str,
    numbering: &'static str,
    source: ManifestSource,
    formats: Vec<&'static str>,
    llms_txt: &'static str,
    books: &'static str,
}

#[derive(Serialize)]
struct ManifestSource {
    name: &'static str,
    url: &'static str,
    commit: String,
    note: &'static str,
}

#[derive(Serialize)]
struct BooksFile {
    translation: &'static str,
    edition: &'static str,
    numbering: &'static str,
    books: Vec<BookEntry>,
}

#[derive(Serialize)]
struct BookEntry {
    id: &'static str,
    name: &'static str,
    short: &'static str,
    aliases: &'static [&'static str],
    testament: &'static str,
    chapters: usize,
}

#[derive(Serialize)]
struct ChapterJson {
    translation: &'static str,
    edition: &'static str,
    book: &'static str,
    chapter: u32,
    verses: Vec<VerseJson>,
}

#[derive(Clone, Serialize)]
struct VerseJson {
    n: u32,
    t: String,
}

#[derive(Serialize)]
struct VerseFile {
    translation: &'static str,
    edition: &'static str,
    book: &'static str,
    chapter: u32,
    verse: u32,
    t: String,
}

fn usage() -> ! {
    eprintln!(
        "Usage: ksiag-import-kjv --source <Bible-kjv-repo> --out <repo/data> [--commit <sha>]"
    );
    std::process::exit(2);
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut source: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut commit = String::from("unknown");

    while let Some(a) = args.next() {
        match a.as_str() {
            "--source" => source = args.next().map(PathBuf::from),
            "--out" => out = args.next().map(PathBuf::from),
            "--commit" => commit = args.next().unwrap_or_else(|| usage()),
            "-h" | "--help" => usage(),
            other => {
                eprintln!("unknown arg: {other}");
                usage();
            }
        }
    }

    let source = source.unwrap_or_else(|| usage());
    let out_root = out.unwrap_or_else(|| usage());
    let dest = out_root.join(TRANSLATION).join(EDITION);

    if let Err(e) = run(&source, &dest, &commit) {
        eprintln!("import failed: {e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn run(source: &Path, dest: &Path, commit: &str) -> io::Result<()> {
    if !source.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("source not a directory: {}", source.display()),
        ));
    }
    if dest.exists() {
        fs::remove_dir_all(dest)?;
    }
    fs::create_dir_all(dest)?;

    let mut book_entries = Vec::with_capacity(BOOKS.len());
    let mut chapters_total = 0usize;

    for meta in BOOKS {
        let path = source.join(format!("{}.json", meta.source_file));
        let chapters = import_book(meta, &path, dest)?;
        chapters_total += chapters;
        book_entries.push(BookEntry {
            id: meta.id,
            name: meta.name,
            short: meta.short,
            aliases: meta.aliases,
            testament: meta.testament,
            chapters,
        });
        eprint!(".");
        let _ = io::stderr().flush();
    }
    eprintln!();

    write_json(
        &dest.join("books.json"),
        &BooksFile {
            translation: TRANSLATION,
            edition: EDITION,
            numbering: "kjv",
            books: book_entries,
        },
    )?;

    write_json(
        &dest.join("manifest.json"),
        &Manifest {
            translation: TRANSLATION,
            edition: EDITION,
            title: "King James Version",
            language: "en",
            api_version: API_VERSION,
            numbering: "kjv",
            source: ManifestSource {
                name: "aruljohn/Bible-kjv",
                url: "https://github.com/aruljohn/Bible-kjv",
                commit: commit.to_string(),
                note: "Public-domain KJV text (commonly 1769 Blayney lineage). UI inspiration: 1611 folio scans.",
            },
            formats: vec!["json", "txt"],
            llms_txt: "/llms.txt",
            books: "./books.json",
        },
    )?;

    // catalog tip for multi-translation hosts
    let catalog = serde_json::json!({
        "api_version": API_VERSION,
        "numbering": "kjv",
        "note": "All translations in this project share KJV/Protestant chapter–verse numbering (BG remapped).",
        "translations": [
            {"id": "bg", "edition": "1879", "language": "pl", "path": "/bg/1879", "title": "Biblia Gdańska"},
            {"id": "kjv", "edition": "1769", "language": "en", "path": "/kjv/1769", "title": "King James Version"}
        ]
    });
    // write next to edition root: data/translations.json
    if let Some(data_root) = dest.parent().and_then(|p| p.parent()) {
        write_json(&data_root.join("translations.json"), &catalog)?;
    }

    println!(
        "OK → {} ({} books, {} chapters)",
        dest.display(),
        BOOKS.len(),
        chapters_total
    );
    Ok(())
}

fn import_book(meta: &BookMeta, src: &Path, dest_root: &Path) -> io::Result<usize> {
    let raw = fs::read_to_string(src).map_err(|e| {
        io::Error::new(e.kind(), format!("{}: {}", src.display(), e))
    })?;
    let book: SourceBook = serde_json::from_str(&raw)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("{}: {e}", src.display())))?;

    let book_dest = dest_root.join(meta.id);
    fs::create_dir_all(&book_dest)?;

    let book_meta = serde_json::json!({
        "translation": TRANSLATION,
        "edition": EDITION,
        "id": meta.id,
        "name": meta.name,
        "short": meta.short,
        "aliases": meta.aliases,
        "testament": meta.testament,
        "chapters": book.chapters.len(),
    });
    write_json(&book_dest.join("book.json"), &book_meta)?;

    for ch in &book.chapters {
        let chapter: u32 = ch
            .chapter
            .parse()
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let verses: Vec<VerseJson> = ch
            .verses
            .iter()
            .map(|v| {
                let n: u32 = v.verse.parse().unwrap_or(0);
                VerseJson {
                    n,
                    t: v.text.trim().to_string(),
                }
            })
            .filter(|v| v.n > 0 && !v.t.is_empty())
            .collect();

        write_json(
            &book_dest.join(format!("{chapter}.json")),
            &ChapterJson {
                translation: TRANSLATION,
                edition: EDITION,
                book: meta.id,
                chapter,
                verses: verses.clone(),
            },
        )?;

        let mut txt = format!("# {TRANSLATION}/{EDITION} {} {chapter}\n", meta.id);
        for v in &verses {
            txt.push_str(&format!("{} {}\n", v.n, v.t));
        }
        fs::write(book_dest.join(format!("{chapter}.txt")), txt)?;

        let verse_dir = book_dest.join(chapter.to_string());
        fs::create_dir_all(&verse_dir)?;
        for v in &verses {
            write_json(
                &verse_dir.join(format!("{}.json", v.n)),
                &VerseFile {
                    translation: TRANSLATION,
                    edition: EDITION,
                    book: meta.id,
                    chapter,
                    verse: v.n,
                    t: v.t.clone(),
                },
            )?;
            fs::write(
                verse_dir.join(format!("{}.txt", v.n)),
                format!(
                    "# {TRANSLATION}/{EDITION} {} {chapter}:{}\n{}\n",
                    meta.id, v.n, v.t
                ),
            )?;
        }
    }

    Ok(book.chapters.len())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let mut body = serde_json::to_vec_pretty(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    body.push(b'\n');
    fs::write(path, body)
}
