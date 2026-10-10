use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Debug, Deserialize, Serialize)]
struct BooksFile {
    books: Vec<BookEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct BookEntry {
    id: String,
    name: String,
    short: String,
    aliases: Vec<String>,
    chapters: u32,
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        print_help();
        return ExitCode::FAILURE;
    }

    let mut data_root = default_data_root();
    let mut edition_rel = String::from("bg/1879");
    let mut json_out = false;
    let mut rest: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--data" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("--data wymaga ścieżki");
                    return ExitCode::FAILURE;
                }
                data_root = PathBuf::from(&args[i]);
            }
            "--edition" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("--edition wymaga np. bg/1879 lub kjv/1769");
                    return ExitCode::FAILURE;
                }
                edition_rel = args[i].clone();
            }
            "--json" => json_out = true,
            "-h" | "--help" => {
                print_help();
                return ExitCode::SUCCESS;
            }
            other => rest.push(other.to_string()),
        }
        i += 1;
    }

    if rest.is_empty() {
        print_help();
        return ExitCode::FAILURE;
    }

    let edition = {
        let mut p = data_root.clone();
        for part in edition_rel.split('/') {
            p.push(part);
        }
        p
    };
    let cmd = rest[0].as_str();
    let result = match cmd {
        "books" => cmd_books(&edition, json_out),
        "get" => cmd_get(&edition, &rest[1..], json_out),
        "chapter" => cmd_chapter(&edition, &rest[1..], json_out),
        "path" => cmd_path(&edition, &edition_rel, &rest[1..]),
        other => {
            eprintln!("nieznana komenda: {other}");
            print_help();
            Err(io::Error::new(io::ErrorKind::InvalidInput, "unknown"))
        }
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

fn print_help() {
    eprintln!(
        "\
66ksiag — klient kanonicznego drzewa (numeracja KJV)

Użycie:
  66ksiag [--data DIR] [--edition bg/1879|kjv/1769] books
  66ksiag […] get <księga> <rozdział> <werset> [--json]
  66ksiag […] chapter <księga> <rozdział> [--json]
  66ksiag […] path <księga> <rozdział> [werset]

Domyślne: --edition bg/1879, --data = ./data lub DATA_DIR.
Wszystkie wydania dzielą te same ID ksiąg i numery rozdziałów (remap do KJV).
"
    );
}

fn default_data_root() -> PathBuf {
    if let Ok(d) = env::var("DATA_DIR") {
        return PathBuf::from(d);
    }
    // try cwd/data, then repo-relative from exe
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("data/bg/1879/books.json").is_file() {
        return cwd.join("data");
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(root) = exe.ancestors().nth(3) {
            let p = root.join("data");
            if p.join("bg/1879/books.json").is_file() {
                return p;
            }
        }
    }
    cwd.join("data")
}

fn load_books(edition: &Path) -> io::Result<BooksFile> {
    let path = edition.join("books.json");
    let raw = fs::read_to_string(&path).map_err(|e| {
        io::Error::new(
            e.kind(),
            format!("{}: {} (uruchom ksiag-import)", path.display(), e),
        )
    })?;
    serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn resolve_book<'a>(books: &'a BooksFile, key: &str) -> io::Result<&'a BookEntry> {
    let k = key.to_lowercase();
    books
        .books
        .iter()
        .find(|b| {
            b.id == key
                || b.id.eq_ignore_ascii_case(&k)
                || b.short.eq_ignore_ascii_case(&k)
                || b.aliases.iter().any(|a| a.eq_ignore_ascii_case(&k))
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("nieznana księga: {key}")))
}

fn cmd_books(edition: &Path, json_out: bool) -> io::Result<()> {
    let books = load_books(edition)?;
    if json_out {
        println!("{}", serde_json::to_string_pretty(&books.books)?);
        return Ok(());
    }
    for b in &books.books {
        println!(
            "{:<8} {:<6} {} ({} rozdz.)",
            b.id, b.short, b.name, b.chapters
        );
    }
    Ok(())
}

fn cmd_get(edition: &Path, args: &[String], json_out: bool) -> io::Result<()> {
    if args.len() < 3 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "get wymaga: <księga> <rozdział> <werset>",
        ));
    }
    let books = load_books(edition)?;
    let book = resolve_book(&books, &args[0])?;
    let chapter: u32 = args[1]
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "zły rozdział"))?;
    let verse: u32 = args[2]
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "zły werset"))?;

    let path = edition
        .join(&book.id)
        .join(chapter.to_string())
        .join(format!("{verse}.json"));
    let raw = fs::read_to_string(&path).map_err(|e| {
        io::Error::new(e.kind(), format!("{}: {}", path.display(), e))
    })?;
    if json_out {
        print!("{raw}");
        if !raw.ends_with('\n') {
            println!();
        }
        return Ok(());
    }
    let v: Value = serde_json::from_str(&raw)?;
    let t = v
        .get("t")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    println!(
        "{} {}:{}  {}",
        book.short,
        chapter,
        verse,
        strip_tags(t)
    );
    Ok(())
}

fn cmd_chapter(edition: &Path, args: &[String], json_out: bool) -> io::Result<()> {
    if args.len() < 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "chapter wymaga: <księga> <rozdział>",
        ));
    }
    let books = load_books(edition)?;
    let book = resolve_book(&books, &args[0])?;
    let chapter: u32 = args[1]
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "zły rozdział"))?;

    if json_out {
        let path = edition.join(&book.id).join(format!("{chapter}.json"));
        let raw = fs::read_to_string(&path)?;
        print!("{raw}");
        if !raw.ends_with('\n') {
            println!();
        }
        return Ok(());
    }
    let path = edition.join(&book.id).join(format!("{chapter}.txt"));
    let raw = fs::read_to_string(&path)?;
    let mut out = io::stdout().lock();
    out.write_all(raw.as_bytes())?;
    Ok(())
}

fn cmd_path(edition: &Path, edition_rel: &str, args: &[String]) -> io::Result<()> {
    if args.len() < 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path wymaga: <księga> <rozdział> [werset]",
        ));
    }
    let books = load_books(edition)?;
    let book = resolve_book(&books, &args[0])?;
    let chapter: u32 = args[1]
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "zły rozdział"))?;
    let base = format!("/{}/{}/{}", edition_rel.trim_matches('/'), book.id, chapter);
    if args.len() >= 3 {
        let verse: u32 = args[2]
            .parse()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "zły werset"))?;
        println!("{base}/{verse}");
    } else {
        println!("{base}");
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
