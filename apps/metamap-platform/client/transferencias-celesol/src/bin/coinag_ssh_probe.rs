use anyhow::{Result, anyhow, bail};
use transferencias_celesol::{coinag_client::CoinagClient, config::CoinagConfig};

fn main() -> Result<()> {
    env_logger::init();

    let config = CoinagConfig::from_env()?;
    if !config.ssh.is_enabled() {
        bail!("TRANSFERENCIAS_COINAG_SSH_ENABLED debe estar en true para este probe.");
    }

    let timeout_seconds = std::env::var("TRANSFERENCIAS_REQUEST_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(15);
    let probe_url = std::env::var("TRANSFERENCIAS_COINAG_PROBE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!config.token_url.trim().is_empty()).then(|| config.token_url.clone()))
        .ok_or_else(|| {
            anyhow!("Falta TRANSFERENCIAS_COINAG_PROBE_URL o TRANSFERENCIAS_COINAG_TOKEN_URL.")
        })?;

    let client = CoinagClient::new(&config, std::time::Duration::from_secs(timeout_seconds))?;
    let status = client.probe_get_status(&probe_url)?;

    println!(
        "coinag probe via {} => GET {} -> {}",
        if client.uses_ssh() { "ssh" } else { "direct" },
        probe_url,
        status
    );

    Ok(())
}
