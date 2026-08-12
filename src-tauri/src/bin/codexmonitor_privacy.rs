use std::env;
use std::fs;
use std::io::{self, Read};
use std::process;

#[allow(dead_code)]
#[path = "../shared/privacy_alias_core.rs"]
mod privacy_alias_core;

use privacy_alias_core::{anonymize_text, reveal_text};

fn print_usage(program: &str) {
    eprintln!(
        "Usage: {program} <anonymize|reveal> [--passphrase <passphrase>] <file|->\n\
         \n\
         Reads from <file>, or stdin when <file> is '-'. Writes transformed text to stdout."
    );
}

fn read_input(path: &str) -> Result<String, String> {
    if path == "-" {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .map_err(|err| format!("Failed to read stdin: {err}"))?;
        return Ok(input);
    }
    fs::read_to_string(path).map_err(|err| format!("Failed to read {path}: {err}"))
}

fn parse_args(args: &[String]) -> Result<(&str, Option<String>, &str), String> {
    if args.len() < 3 {
        return Err("missing arguments".to_string());
    }
    let action = args[1].as_str();
    if action != "anonymize" && action != "reveal" {
        return Err(format!("unknown action: {action}"));
    }

    let mut passphrase = None;
    let mut file = None;
    let mut i = 2usize;
    while i < args.len() {
        match args[i].as_str() {
            "--passphrase" => {
                let Some(value) = args.get(i + 1) else {
                    return Err("--passphrase requires a value".to_string());
                };
                passphrase = Some(value.clone());
                i += 2;
            }
            "--help" | "-h" => return Err(String::new()),
            value if file.is_none() => {
                file = Some(value);
                i += 1;
            }
            value => return Err(format!("unexpected argument: {value}")),
        }
    }

    let Some(file) = file else {
        return Err("missing file path".to_string());
    };
    Ok((action, passphrase, file))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let program = args
        .first()
        .map(String::as_str)
        .unwrap_or("codexmonitor_privacy");
    let (action, passphrase_arg, file) = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(err) => {
            if !err.is_empty() {
                eprintln!("Error: {err}");
            }
            print_usage(program);
            process::exit(2);
        }
    };

    let passphrase = match passphrase_arg {
        Some(value) => value,
        None => match rpassword::prompt_password("Privacy alias passphrase: ") {
            Ok(value) => value,
            Err(err) => {
                eprintln!("Error: failed to read passphrase: {err}");
                process::exit(1);
            }
        },
    };

    let input = match read_input(file) {
        Ok(input) => input,
        Err(err) => {
            eprintln!("Error: {err}");
            process::exit(1);
        }
    };

    let output = match action {
        "anonymize" => match anonymize_text(&input, &passphrase) {
            Ok(result) => result.text,
            Err(err) => {
                eprintln!("Error: {err}");
                process::exit(1);
            }
        },
        "reveal" => reveal_text(&input, &passphrase).text,
        _ => unreachable!(),
    };
    print!("{output}");
}
