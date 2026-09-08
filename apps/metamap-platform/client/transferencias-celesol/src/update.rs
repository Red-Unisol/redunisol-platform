//! Signed, code-only updates. All paths are installation-local; configuration is never copied.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow, ensure};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use chrono::{DateTime, Utc};
use fs2::FileExt;
use ring::signature::{ED25519, UnparsedPublicKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const BASE_URL: &str =
    "https://kestra.redunisol.com.ar/metamap-platform/updates/transferencias/";
const PUBLIC_KEY: &str = include_str!("../update-public-key.base64");
const EXE: &str = "transferencias-celesol.exe";
const MAX_BINARY: u64 = 200 * 1024 * 1024;
const MAX_METADATA: u64 = 16 * 1024;
const STATE_DIR: &str = ".transferencias-update";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema: u32,
    pub application: String,
    pub version: String,
    pub channel: String,
    pub target: String,
    pub key_id: String,
    pub filename: String,
    pub sha256: String,
    pub size: u64,
    pub published_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    manifest: String,
    signature: String,
}

pub fn verify_manifest(envelope: &[u8], key: &str, now: DateTime<Utc>) -> Result<Manifest> {
    ensure!(
        envelope.len() as u64 <= MAX_METADATA,
        "Metadatos demasiado grandes"
    );
    let envelope: Envelope = serde_json::from_slice(envelope)?;
    let raw = BASE64.decode(envelope.manifest)?;
    let signature = BASE64.decode(envelope.signature)?;
    let key = BASE64.decode(key.trim())?;
    UnparsedPublicKey::new(&ED25519, key)
        .verify(&raw, &signature)
        .map_err(|_| anyhow!("Firma de actualizacion invalida"))?;
    let m: Manifest = serde_json::from_slice(&raw)?;
    ensure!(
        m.schema == 1
            && m.application == "transferencias-celesol"
            && m.channel == "production"
            && m.target == "x86_64-pc-windows-msvc"
            && m.key_id == "production-2026",
        "Actualizacion incompatible"
    );
    let version = Version::parse(&m.version)?;
    ensure!(
        version.pre.is_empty() && version.build.is_empty(),
        "Version no estable"
    );
    ensure!(
        m.filename == format!("{version}/{EXE}"),
        "Ruta de actualizacion invalida"
    );
    ensure!(
        m.size > 0 && m.size <= MAX_BINARY,
        "Tamano de actualizacion invalido"
    );
    ensure!(
        m.sha256.len() == 64 && m.sha256.bytes().all(|b| b.is_ascii_hexdigit()),
        "Hash invalido"
    );
    ensure!(
        m.published_at <= now + chrono::Duration::minutes(5)
            && m.expires_at > now
            && m.expires_at > m.published_at
            && m.expires_at - m.published_at <= chrono::Duration::days(91),
        "Metadatos vencidos o fecha invalida"
    );
    Ok(m)
}

fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_binary(path: &Path, manifest: &Manifest) -> Result<()> {
    ensure!(
        fs::metadata(path)?.len() == manifest.size,
        "Descarga incompleta"
    );
    ensure!(
        hash_file(path)? == manifest.sha256.to_ascii_lowercase(),
        "El hash del ejecutable no coincide"
    );
    Ok(())
}

fn state_dir(root: &Path) -> PathBuf {
    root.join(STATE_DIR)
}

/// Held for the whole GUI lifetime, including startup and configuration prompt.
pub struct InstanceLock {
    _file: File,
}
impl InstanceLock {
    pub fn acquire(root: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".transferencias-instance.lock"))?;
        file.try_lock_exclusive()
            .context("Ya hay otra instancia abierta o una actualizacion en curso")?;
        Ok(Self { _file: file })
    }
}

#[derive(Deserialize, Serialize)]
struct Journal {
    old_hash: String,
    new_hash: String,
}

#[derive(Deserialize, Serialize, Default)]
struct History {
    highest_version: Option<String>,
    failed_hash: Option<String>,
}

fn eligible(manifest: &Manifest, installed: &str, previous: &History) -> Result<bool> {
    let version = Version::parse(&manifest.version)?;
    if version <= Version::parse(installed)? {
        return Ok(false);
    }
    if let Some(highest) = &previous.highest_version {
        ensure!(
            version >= Version::parse(highest)?,
            "Se rechazo una version anterior a la ya observada"
        );
    }
    ensure!(
        previous.failed_hash.as_deref() != Some(&manifest.sha256),
        "La version publicada fallo al arrancar anteriormente"
    );
    Ok(true)
}

fn history(root: &Path) -> Result<History> {
    let path = state_dir(root).join("history.json");
    if !path.exists() {
        return Ok(History::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temp = path.with_extension("json.new");
    let mut out = File::create(&temp)?;
    out.write_all(&serde_json::to_vec(value)?)?;
    out.sync_all()?;
    drop(out);
    replace_file(&temp, path, None)
}

/// Persist the backup first, then use a single same-volume replacement rename.
/// Unlike ReplaceFileW's multi-step error cases, we never rename the live target away.
#[cfg(windows)]
fn replace_file(source: &Path, target: &Path, backup: Option<&Path>) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    if let Some(backup) = backup {
        let staged_backup = backup.with_extension("exe.new");
        fs::copy(target, &staged_backup)?;
        OpenOptions::new()
            .write(true)
            .open(&staged_backup)?
            .sync_all()?;
        replace_file(&staged_backup, backup, None)?;
    }
    let wide = |p: &Path| {
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let src = wide(source);
    let dst = wide(target);
    let ok = unsafe {
        MoveFileExW(
            src.as_ptr(),
            dst.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path, backup: Option<&Path>) -> Result<()> {
    if let Some(backup) = backup {
        fs::copy(target, backup)?;
    }
    fs::rename(source, target)?;
    Ok(())
}

fn download(
    client: &reqwest::blocking::Client,
    url: &str,
    max: u64,
    output: &mut impl Write,
) -> Result<u64> {
    let response = client.get(url).send()?.error_for_status()?;
    ensure!(
        response.content_length().is_none_or(|size| size <= max),
        "Descarga demasiado grande"
    );
    let size = std::io::copy(&mut response.take(max + 1), output)?;
    ensure!(size <= max, "Descarga demasiado grande");
    Ok(size)
}

/// Called before constructing any banking services. Never installs a downgrade or the last failed binary.
pub fn check_and_stage(root: &Path) -> Result<bool> {
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("TransferenciasCelesol/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let mut envelope = Vec::new();
    // A shorter bound for the startup check; binary downloads have their own timeout.
    let response = client
        .get(format!("{BASE_URL}latest.json"))
        .timeout(Duration::from_secs(6))
        .send()?
        .error_for_status()?;
    response.take(MAX_METADATA + 1).read_to_end(&mut envelope)?;
    let manifest = verify_manifest(&envelope, PUBLIC_KEY, Utc::now())?;
    let mut previous = history(root)?;
    if !eligible(&manifest, crate::BUILD_TAG, &previous)? {
        return Ok(false);
    }
    let dir = state_dir(root);
    fs::create_dir_all(&dir)?;
    previous.highest_version = Some(manifest.version.clone());
    atomic_json(&dir.join("history.json"), &previous)?;
    let pending = dir.join("download.exe");
    let mut file = File::create(&pending)?;
    download(
        &client,
        &format!("{BASE_URL}{}", manifest.filename),
        manifest.size,
        &mut file,
    )?;
    file.sync_all()?;
    drop(file);
    verify_binary(&pending, &manifest)?;
    fs::write(dir.join("envelope.json"), &envelope)?;
    // The helper is a copy of the already trusted running binary. It uses the same verifier.
    fs::copy(std::env::current_exe()?, dir.join("helper.exe"))?;
    let mut command = Command::new(dir.join("helper.exe"));
    command.arg("--update-apply").arg(root);
    hidden(&mut command);
    command
        .spawn()
        .context("No se pudo iniciar el actualizador")?;
    Ok(true)
}

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn wait_lock(root: &Path) -> Result<InstanceLock> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match InstanceLock::acquire(root) {
            Ok(lock) => return Ok(lock),
            Err(error) if Instant::now() >= deadline => return Err(error),
            Err(_) => thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn restore(root: &Path, journal: &Journal) -> Result<()> {
    let backup = state_dir(root).join("previous.exe");
    ensure!(
        hash_file(&backup)? == journal.old_hash,
        "El respaldo anterior no es valido; requiere recuperacion manual"
    );
    replace_file(&backup, &root.join(EXE), None)?;
    let mut previous = history(root)?;
    previous.failed_hash = Some(journal.new_hash.clone());
    atomic_json(&state_dir(root).join("history.json"), &previous)?;
    fs::remove_file(state_dir(root).join("pending.json"))?;
    Ok(())
}

/// The lock must be held. Detects interrupted swaps/trials without discarding durable business data.
pub fn recovery_needed(root: &Path) -> Result<bool> {
    let path = state_dir(root).join("pending.json");
    if !path.exists() {
        return Ok(false);
    }
    let journal: Journal = serde_json::from_slice(&fs::read(&path)?)?;
    if hash_file(&root.join(EXE))? == journal.old_hash {
        fs::remove_file(path)?;
        return Ok(false);
    }
    Ok(true)
}

pub fn start_recovery(root: &Path) -> Result<()> {
    let helper = state_dir(root).join("helper.exe");
    // Never execute leftover helpers without checking against the known backup hash.
    let journal: Journal =
        serde_json::from_slice(&fs::read(state_dir(root).join("pending.json"))?)?;
    ensure!(
        hash_file(&helper)? == journal.old_hash,
        "Actualizador de recuperacion invalido"
    );
    let mut command = Command::new(helper);
    command.arg("--update-recover").arg(root);
    hidden(&mut command);
    command.spawn()?;
    Ok(())
}

/// Mark ready only after the new GUI has actually been constructed.
pub fn mark_ready(root: &Path) -> Result<()> {
    let path = state_dir(root).join("pending.json");
    if path.exists() {
        let journal: Journal = serde_json::from_slice(&fs::read(&path)?)?;
        ensure!(
            hash_file(&root.join(EXE))? == journal.new_hash,
            "La version iniciada no coincide con la actualizacion"
        );
        fs::remove_file(path)?;
    }
    Ok(())
}

fn helper(root: &Path, recover: bool) -> Result<()> {
    helper_with_key(root, recover, PUBLIC_KEY)
}

fn helper_with_key(root: &Path, recover: bool, public_key: &str) -> Result<()> {
    let root = fs::canonicalize(root)?;
    let lock = wait_lock(&root)?;
    let dir = state_dir(&root);
    ensure!(
        fs::canonicalize(std::env::current_exe()?)? == fs::canonicalize(dir.join("helper.exe"))?,
        "Ruta de actualizador invalida"
    );
    if recover {
        let journal: Journal = serde_json::from_slice(&fs::read(dir.join("pending.json"))?)?;
        restore(&root, &journal)?;
    } else {
        ensure!(
            !dir.join("pending.json").exists(),
            "Existe una actualizacion pendiente de recuperar"
        );
        let manifest = verify_manifest(
            &fs::read(dir.join("envelope.json"))?,
            public_key,
            Utc::now(),
        )?;
        ensure!(
            eligible(&manifest, crate::BUILD_TAG, &history(&root)?)?,
            "No se permiten downgrades"
        );
        verify_binary(&dir.join("download.exe"), &manifest)?;
        let old_hash = hash_file(&root.join(EXE))?;
        ensure!(
            old_hash == hash_file(&std::env::current_exe()?)?,
            "El ejecutable instalado cambio durante la actualizacion"
        );
        let journal = Journal {
            old_hash,
            new_hash: manifest.sha256,
        };
        atomic_json(&dir.join("pending.json"), &journal)?;
        // Antivirus may hold a recently closed image briefly.
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match replace_file(
                &dir.join("download.exe"),
                &root.join(EXE),
                Some(&dir.join("previous.exe")),
            ) {
                Ok(()) => break,
                Err(error) if Instant::now() >= deadline => return Err(error),
                Err(_) => thread::sleep(Duration::from_millis(200)),
            }
        }
    }
    drop(lock);
    let mut command = Command::new(root.join(EXE));
    command.arg(if recover {
        "--update-restored"
    } else {
        "--update-trial"
    });
    hidden(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if !recover => {
            let _lock = wait_lock(&root)?;
            let journal = serde_json::from_slice(&fs::read(dir.join("pending.json"))?)?;
            restore(&root, &journal)?;
            drop(_lock);
            let mut restored = Command::new(root.join(EXE));
            restored.arg("--update-restored");
            hidden(&mut restored);
            restored.spawn()?;
            log::warn!("La nueva version no pudo iniciarse; se restauro la anterior: {error}");
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };
    if !recover {
        // No timeout: the user may legitimately take time to enter the config passphrase.
        while dir.join("pending.json").exists() {
            if child.try_wait()?.is_some() {
                let lock = wait_lock(&root)?;
                if dir.join("pending.json").exists() {
                    let journal = serde_json::from_slice(&fs::read(dir.join("pending.json"))?)?;
                    restore(&root, &journal)?;
                }
                drop(lock);
                let mut restored = Command::new(root.join(EXE));
                restored.arg("--update-restored");
                hidden(&mut restored);
                restored.spawn()?;
                break;
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
    Ok(())
}

pub fn run_helper_if_requested() -> Option<Result<()>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args
        .get(1)
        .is_some_and(|a| a == "--update-apply" || a == "--update-recover")
    {
        return Some((|| {
            ensure!(args.len() == 3, "Argumentos invalidos");
            helper(Path::new(&args[2]), args[1] == "--update-recover")
        })());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::{
        rand::SystemRandom,
        signature::{Ed25519KeyPair, KeyPair},
    };

    fn signed(change: impl FnOnce(&mut Manifest)) -> (Vec<u8>, String) {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let key = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let mut m = Manifest {
            schema: 1,
            application: "transferencias-celesol".into(),
            version: "2.2.0".into(),
            channel: "production".into(),
            target: "x86_64-pc-windows-msvc".into(),
            key_id: "production-2026".into(),
            filename: format!("2.2.0/{EXE}"),
            sha256: "a".repeat(64),
            size: 10,
            published_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::days(90),
        };
        change(&mut m);
        let raw = serde_json::to_vec(&m).unwrap();
        (
            serde_json::to_vec(&Envelope {
                manifest: BASE64.encode(&raw),
                signature: BASE64.encode(key.sign(&raw)),
            })
            .unwrap(),
            BASE64.encode(key.public_key().as_ref()),
        )
    }

    #[test]
    fn signed_manifest_accepts_only_trusted_unchanged_metadata() {
        let (bytes, key) = signed(|_| {});
        assert_eq!(
            verify_manifest(&bytes, &key, Utc::now()).unwrap().version,
            "2.2.0"
        );
        let (_, wrong_key) = signed(|_| {});
        assert!(verify_manifest(&bytes, &wrong_key, Utc::now()).is_err());
        let mut e: Envelope = serde_json::from_slice(&bytes).unwrap();
        e.manifest = BASE64.encode(b"tampered");
        assert!(verify_manifest(&serde_json::to_vec(&e).unwrap(), &key, Utc::now()).is_err());
    }

    #[test]
    fn verifies_python_release_signature_with_rust_client() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tools/update_release.py");
        let keygen = Command::new("python")
            .arg(&script)
            .args(["keygen", "--private-key"])
            .arg(root.join("private.key"))
            .output()
            .unwrap();
        assert!(
            keygen.status.success(),
            "{}",
            String::from_utf8_lossy(&keygen.stderr)
        );
        let public = String::from_utf8(keygen.stdout).unwrap();
        fs::write(root.join("public.key"), public.trim()).unwrap();
        fs::write(root.join("input.exe"), b"MZ cross-language test").unwrap();
        let signing = Command::new("python")
            .arg(script)
            .args(["release", "--version", "2.2.0", "--exe"])
            .arg(root.join("input.exe"))
            .arg("--output")
            .arg(root.join("output"))
            .arg("--public-key")
            .arg(root.join("public.key"))
            .env(
                "TRANSFERENCIAS_UPDATE_SIGNING_KEY",
                fs::read_to_string(root.join("private.key")).unwrap(),
            )
            .output()
            .unwrap();
        assert!(
            signing.status.success(),
            "{}",
            String::from_utf8_lossy(&signing.stderr)
        );
        let manifest = verify_manifest(
            &fs::read(root.join("output/latest.json")).unwrap(),
            public.trim(),
            Utc::now(),
        )
        .unwrap();
        verify_binary(
            &root.join("output/2.2.0/transferencias-celesol.exe"),
            &manifest,
        )
        .unwrap();
    }

    #[test]
    fn refuses_downgrades_replays_and_previous_failed_binary() {
        let (bytes, key) = signed(|_| {});
        let m = verify_manifest(&bytes, &key, Utc::now()).unwrap();
        assert!(eligible(&m, "2.1.0", &History::default()).unwrap());
        assert!(!eligible(&m, "2.2.0", &History::default()).unwrap());
        assert!(!eligible(&m, "2.3.0", &History::default()).unwrap());
        assert!(
            eligible(
                &m,
                "2.1.0",
                &History {
                    highest_version: Some("2.3.0".into()),
                    failed_hash: None
                }
            )
            .is_err()
        );
        assert!(
            eligible(
                &m,
                "2.1.0",
                &History {
                    highest_version: None,
                    failed_hash: Some(m.sha256.clone())
                }
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_expiry_future_wrong_platform_and_traversal() {
        for change in [
            (|m: &mut Manifest| m.expires_at = Utc::now() - chrono::Duration::days(1))
                as fn(&mut Manifest),
            |m| m.published_at = Utc::now() + chrono::Duration::days(1),
            |m| m.target = "linux".into(),
            |m| m.channel = "dev".into(),
            |m| m.filename = "../transferencias.env.enc".into(),
            |m| m.filename = "https://evil.example/app.exe".into(),
            |m| m.size = MAX_BINARY + 1,
            |m| m.sha256 = "x".repeat(64),
            |m| m.version = "2.2.0-beta".into(),
            |m| m.application = "other".into(),
        ] {
            let (bytes, key) = signed(change);
            assert!(verify_manifest(&bytes, &key, Utc::now()).is_err());
        }
    }

    #[test]
    fn detects_incomplete_or_corrupt_binary() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.exe");
        fs::write(&path, b"original").unwrap();
        let (bytes, key) = signed(|m| {
            m.size = 8;
            m.sha256 = hash_file(&path).unwrap();
        });
        let m = verify_manifest(&bytes, &key, Utc::now()).unwrap();
        verify_binary(&path, &m).unwrap();
        fs::write(&path, b"corrupt!").unwrap();
        assert!(verify_binary(&path, &m).is_err());
        fs::write(&path, b"short").unwrap();
        assert!(verify_binary(&path, &m).is_err());
    }

    #[test]
    fn prevents_two_instances_and_releases_after_exit() {
        let root = tempfile::tempdir().unwrap();
        let lock = InstanceLock::acquire(root.path()).unwrap();
        assert!(InstanceLock::acquire(root.path()).is_err());
        drop(lock);
        InstanceLock::acquire(root.path()).unwrap();
    }

    #[test]
    fn interrupted_trial_restores_only_executable_and_remembers_failure() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        fs::create_dir(state_dir(root)).unwrap();
        let data = [
            "transferencias.env.enc",
            "lineas.toml",
            "acreedores-confiables.toml",
            "transferencias_realizadas.jsonl",
            "transfer-trace-outbox.jsonl",
        ];
        for name in data {
            fs::write(root.join(name), b"user state").unwrap();
        }
        fs::write(root.join(EXE), b"old").unwrap();
        let staged = state_dir(root).join("download.exe");
        fs::write(&staged, b"new").unwrap();
        let journal = Journal {
            old_hash: hash_file(&root.join(EXE)).unwrap(),
            new_hash: hash_file(&staged).unwrap(),
        };
        atomic_json(&state_dir(root).join("pending.json"), &journal).unwrap();
        assert!(!recovery_needed(root).unwrap()); // Journal written, swap not yet performed.
        atomic_json(&state_dir(root).join("pending.json"), &journal).unwrap();
        replace_file(
            &staged,
            &root.join(EXE),
            Some(&state_dir(root).join("previous.exe")),
        )
        .unwrap();
        assert!(recovery_needed(root).unwrap());
        restore(root, &journal).unwrap();
        assert_eq!(fs::read(root.join(EXE)).unwrap(), b"old");
        assert_eq!(history(root).unwrap().failed_hash, Some(journal.new_hash));
        for name in data {
            assert_eq!(fs::read(root.join(name)).unwrap(), b"user state");
        }
    }

    #[test]
    fn ready_clears_journal_but_keeps_backup() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        fs::create_dir(state_dir(root)).unwrap();
        fs::write(root.join(EXE), b"new").unwrap();
        fs::write(state_dir(root).join("previous.exe"), b"old").unwrap();
        atomic_json(
            &state_dir(root).join("pending.json"),
            &Journal {
                old_hash: "unused".into(),
                new_hash: hash_file(&root.join(EXE)).unwrap(),
            },
        )
        .unwrap();
        mark_ready(root).unwrap();
        assert!(!recovery_needed(root).unwrap());
        assert!(state_dir(root).join("previous.exe").exists());
    }

    #[test]
    fn successive_updates_refresh_backup_and_failed_rename_keeps_installed_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let live = root.join("app.exe");
        let backup = root.join("previous.exe");
        let source = root.join("new.exe");
        fs::write(&live, b"v1").unwrap();
        fs::write(&source, b"v2").unwrap();
        replace_file(&source, &live, Some(&backup)).unwrap();
        fs::write(&source, b"v3").unwrap();
        replace_file(&source, &live, Some(&backup)).unwrap();
        assert_eq!(fs::read(&live).unwrap(), b"v3");
        assert_eq!(fs::read(&backup).unwrap(), b"v2");
        assert!(replace_file(&source, &live, None).is_err()); // Missing source must never remove live target.
        assert_eq!(fs::read(&live).unwrap(), b"v3");
    }

    #[test]
    fn bounded_download_rejects_http_error_oversize_and_disconnect() {
        use std::net::TcpListener;
        for response in [
            "HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\n01234567890123456789",
            "HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nshort",
            "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n01234567890123456789",
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = [0; 2048];
                let _ = stream.read(&mut buffer);
                stream.write_all(response.as_bytes()).unwrap();
            });
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap();
            assert!(download(&client, &format!("http://{address}/"), 10, &mut Vec::new()).is_err());
            server.join().unwrap();
        }
    }

    #[test]
    #[ignore = "invoked only by Windows subprocess test"]
    fn helper_process_fixture() {
        let root = std::env::var_os("TEST_UPDATE_ROOT").unwrap();
        let key = std::env::var("TEST_UPDATE_KEY").unwrap();
        helper_with_key(Path::new(&root), false, &key).unwrap();
    }

    #[test]
    #[ignore = "invoked only by Windows subprocess test"]
    fn running_app_fixture() {
        let root = PathBuf::from(std::env::var_os("TEST_UPDATE_ROOT").unwrap());
        let _lock = InstanceLock::acquire(&root).unwrap();
        fs::write(root.join("parent-ready"), b"ready").unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !root.join("parent-release").exists() {
            assert!(Instant::now() < deadline, "Parent release timeout");
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[test]
    #[cfg(windows)]
    fn real_windows_process_swap_success_crash_and_invalid_executable() {
        let fixture = tempfile::tempdir().unwrap();
        let compiled = fixture.path().join("trial.exe");
        assert!(
            Command::new("rustc")
                .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/update_app.rs"))
                .arg("-o")
                .arg(&compiled)
                .status()
                .unwrap()
                .success()
        );
        for mode in ["ready", "crash", "invalid-executable"] {
            let installation = tempfile::tempdir().unwrap();
            let root = installation.path();
            fs::create_dir(state_dir(root)).unwrap();
            let old = std::env::current_exe().unwrap();
            fs::copy(&old, root.join(EXE)).unwrap();
            fs::copy(&old, state_dir(root).join("helper.exe")).unwrap();
            let staged = state_dir(root).join("download.exe");
            if mode == "invalid-executable" {
                fs::write(&staged, b"not a Windows executable").unwrap();
            } else {
                fs::copy(&compiled, &staged).unwrap();
            }
            let (envelope, key) = signed(|m| {
                m.sha256 = hash_file(&staged).unwrap();
                m.size = fs::metadata(&staged).unwrap().len();
            });
            fs::write(state_dir(root).join("envelope.json"), envelope).unwrap();
            fs::write(
                root.join("transferencias.env.enc"),
                b"private settings stay local",
            )
            .unwrap();
            let mut running = Command::new(root.join(EXE))
                .args(["--exact", "update::tests::running_app_fixture", "--ignored"])
                .env("TEST_UPDATE_ROOT", root)
                .spawn()
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(20);
            while !root.join("parent-ready").exists() {
                assert!(Instant::now() < deadline);
                thread::sleep(Duration::from_millis(25));
            }
            let mut process = Command::new(state_dir(root).join("helper.exe"))
                .args([
                    "--exact",
                    "update::tests::helper_process_fixture",
                    "--ignored",
                    "--nocapture",
                ])
                .current_dir(fixture.path())
                .env("TEST_UPDATE_ROOT", root)
                .env("TEST_UPDATE_KEY", key)
                .env("TEST_UPDATE_MODE", mode)
                .spawn()
                .unwrap();
            thread::sleep(Duration::from_millis(300));
            assert!(
                !state_dir(root).join("pending.json").exists(),
                "Must wait for running app"
            );
            fs::write(root.join("parent-release"), b"release").unwrap();
            assert!(running.wait().unwrap().success());
            let deadline = Instant::now() + Duration::from_secs(40);
            while process.try_wait().unwrap().is_none() {
                if Instant::now() >= deadline {
                    let _ = process.kill();
                    panic!("Helper process timed out");
                }
                thread::sleep(Duration::from_millis(100));
            }
            assert!(
                process.wait().unwrap().success(),
                "Helper failed for {mode}"
            );
            if mode == "ready" {
                assert_eq!(
                    fs::read_to_string(root.join("child-cwd.txt")).unwrap(),
                    fixture.path().to_string_lossy()
                );
                assert_eq!(
                    hash_file(&root.join(EXE)).unwrap(),
                    hash_file(&compiled).unwrap()
                );
                assert!(state_dir(root).join("previous.exe").exists());
            } else {
                assert_eq!(
                    hash_file(&root.join(EXE)).unwrap(),
                    hash_file(&old).unwrap()
                );
                assert!(history(root).unwrap().failed_hash.is_some());
            }
            assert!(!state_dir(root).join("pending.json").exists());
            assert_eq!(
                fs::read(root.join("transferencias.env.enc")).unwrap(),
                b"private settings stay local"
            );
            // Restored test executable exits on the app-only flag; give Windows time to close its handle.
            thread::sleep(Duration::from_millis(200));
        }
    }
}
