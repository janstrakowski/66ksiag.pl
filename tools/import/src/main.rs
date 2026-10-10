mod books;

use books::{BookMeta, BOOKS};
use serde::Serialize;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const TRANSLATION: &str = "bg";
const EDITION: &str = "1879";
const API_VERSION: &str = "1";

#[derive(Serialize)]
struct Manifest {
    translation: &'static str,
    edition: &'static str,
    title: &'static str,
    language: &'static str,
    api_version: &'static str,
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
    path: &'static str,
}

#[derive(Serialize)]
struct BooksFile {
    translation: &'static str,
    edition: &'static str,
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
        "Usage: ksiag-import --source <biblia-druk-tekst/1879> --out <repo/data> [--commit <sha>]"
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

    let mut book_entries: Vec<BookEntry> = Vec::with_capacity(BOOKS.len());
    let mut chapters_total = 0usize;

    for meta in BOOKS {
        let book_src = source.join(meta.id);
        if !book_src.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("missing book dir: {}", book_src.display()),
            ));
        }
        let chapters = import_book(meta, &book_src, dest)?;
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

    let verses_total = count_verse_dirs(dest)?;

    let books_file = BooksFile {
        translation: TRANSLATION,
        edition: EDITION,
        books: book_entries,
    };
    write_json(&dest.join("books.json"), &books_file)?;

    let manifest = Manifest {
        translation: TRANSLATION,
        edition: EDITION,
        title: "Biblia Gdańska",
        language: "pl",
        api_version: API_VERSION,
        source: ManifestSource {
            name: "UczenJezusa/biblia-druk-tekst",
            url: "https://github.com/UczenJezusa/biblia-druk-tekst",
            commit: commit.to_string(),
            path: "1879",
        },
        formats: vec!["json", "txt"],
        llms_txt: "/llms.txt",
        books: "./books.json",
    };
    write_json(&dest.join("manifest.json"), &manifest)?;

    println!(
        "OK → {} ({} ksiąg, {} rozdziałów, ~{} wersetów)",
        dest.display(),
        BOOKS.len(),
        chapters_total,
        verses_total
    );
    Ok(())
}

fn import_book(meta: &BookMeta, book_src: &Path, dest_root: &Path) -> io::Result<usize> {
    let book_dest = dest_root.join(meta.id);
    fs::create_dir_all(&book_dest)?;

    let mut chapter_files: Vec<(u32, PathBuf)> = Vec::new();
    for entry in fs::read_dir(book_src)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad chapter name"))?;
        let chapter: u32 = stem
            .parse()
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        chapter_files.push((chapter, path));
    }
    chapter_files.sort_by_key(|(n, _)| *n);

    let book_meta = serde_json::json!({
        "translation": TRANSLATION,
        "edition": EDITION,
        "id": meta.id,
        "name": meta.name,
        "short": meta.short,
        "aliases": meta.aliases,
        "testament": meta.testament,
        "chapters": chapter_files.len(),
    });
    write_json(&book_dest.join("book.json"), &book_meta)?;

    for (chapter, path) in &chapter_files {
        import_chapter(meta, *chapter, path, &book_dest)?;
    }
    Ok(chapter_files.len())
}

fn import_chapter(
    meta: &BookMeta,
    chapter: u32,
    src: &Path,
    book_dest: &Path,
) -> io::Result<()> {
    let raw = fs::read_to_string(src)?;
    let mut verses: Vec<VerseJson> = Vec::new();
    for (i, line) in raw.lines().enumerate() {
        let t = line.trim_end().to_string();
        if t.is_empty() {
            continue;
        }
        verses.push(VerseJson {
            n: (i + 1) as u32,
            t,
        });
    }

    let chapter_json = ChapterJson {
        translation: TRANSLATION,
        edition: EDITION,
        book: meta.id,
        chapter,
        verses: verses.clone(),
    };
    write_json(&book_dest.join(format!("{chapter}.json")), &chapter_json)?;

    let mut txt = format!("# {TRANSLATION}/{EDITION} {} {chapter}\n", meta.id);
    for v in &verses {
        txt.push_str(&format!("{} {}\n", v.n, strip_tags(&v.t)));
    }
    fs::write(book_dest.join(format!("{chapter}.txt")), txt)?;

    let verse_dir = book_dest.join(chapter.to_string());
    fs::create_dir_all(&verse_dir)?;
    for v in &verses {
        let vf = VerseFile {
            translation: TRANSLATION,
            edition: EDITION,
            book: meta.id,
            chapter,
            verse: v.n,
            t: v.t.clone(),
        };
        write_json(&verse_dir.join(format!("{}.json", v.n)), &vf)?;
        let plain = format!(
            "# {TRANSLATION}/{EDITION} {} {chapter}:{}\n{}\n",
            meta.id,
            v.n,
            strip_tags(&v.t)
        );
        fs::write(verse_dir.join(format!("{}.txt", v.n)), plain)?;
    }
    Ok(())
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let mut body = serde_json::to_vec_pretty(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    body.push(b'\n');
    fs::write(path, body)
}

fn count_verse_dirs(dest: &Path) -> io::Result<usize> {
    let mut n = 0usize;
    for book in fs::read_dir(dest)? {
        let book = book?;
        if !book.file_type()?.is_dir() {
            continue;
        }
        for entry in fs::read_dir(book.path())? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                for v in fs::read_dir(entry.path())? {
                    let v = v?;
                    if v.path().extension().and_then(|e| e.to_str()) == Some("json") {
                        n += 1;
                    }
                }
            }
        }
    }
    Ok(n)
}
