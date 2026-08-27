use std::{
    env, fs,
    io::{self, Write},
    path::PathBuf,
};

use anyhow::{Context, Result, anyhow};
use transferencias_celesol::secure_config;

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut input = PathBuf::from("transferencias.env");
    let mut output = PathBuf::from("transferencias.env.enc");
    let mut decrypt = false;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("Falta valor para --input"))?;
                input = PathBuf::from(value);
            }
            "--output" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("Falta valor para --output"))?;
                output = PathBuf::from(value);
            }
            "--decrypt" => {
                decrypt = true;
            }
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            other => {
                return Err(anyhow!("Parametro no soportado: {other}"));
            }
        }
    }

    let passphrase = resolve_passphrase()?;
    let input_text =
        fs::read_to_string(&input).with_context(|| format!("No se pudo leer {:?}", input))?;
    let output_text = if decrypt {
        secure_config::decrypt_config_text(&input_text, &passphrase)?
    } else {
        secure_config::encrypt_config_text(&input_text, &passphrase)?
    };
    fs::write(&output, output_text).with_context(|| format!("No se pudo escribir {:?}", output))?;

    println!(
        "Archivo {} generado en {}",
        if decrypt { "descifrado" } else { "cifrado" },
        output.display()
    );
    Ok(())
}

fn resolve_passphrase() -> Result<String> {
    if let Some(value) = env::var("TRANSFERENCIAS_CONFIG_PASSPHRASE")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        return Ok(value);
    }

    let first = prompt("Passphrase: ")?;
    let second = prompt("Confirmar passphrase: ")?;
    if first != second {
        return Err(anyhow!("Las passphrases no coinciden."));
    }
    if first.trim().is_empty() {
        return Err(anyhow!("La passphrase no puede estar vacia."));
    }
    Ok(first)
}

fn prompt(label: &str) -> Result<String> {
    let mut stdout = io::stdout();
    stdout
        .write_all(label.as_bytes())
        .context("No se pudo escribir el prompt.")?;
    stdout.flush().context("No se pudo flushar el prompt.")?;

    let mut buffer = String::new();
    io::stdin()
        .read_line(&mut buffer)
        .context("No se pudo leer la passphrase.")?;
    Ok(buffer.trim().to_owned())
}

fn print_help() {
    println!("Uso:");
    println!(
        "  cargo run --bin encrypt_transferencias_env -- --input transferencias.env --output transferencias.env.enc"
    );
    println!(
        "  cargo run --bin encrypt_transferencias_env -- --decrypt --input transferencias.env.enc --output transferencias.env"
    );
    println!();
    println!(
        "Si TRANSFERENCIAS_CONFIG_PASSPHRASE no esta definida, la herramienta la pide por consola."
    );
}
