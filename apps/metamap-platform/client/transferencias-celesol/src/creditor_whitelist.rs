use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Write,
    path::Path,
};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use crate::{cancellations::is_legal_entity_cuit, validation::normalize_digits};

pub const CREDITOR_WHITELIST_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrustedCreditor {
    pub cuit: String,
    pub name: String,
    #[serde(default)]
    pub cbus: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CreditorWhitelistFile {
    pub version: u32,
    #[serde(default)]
    pub creditors: Vec<TrustedCreditor>,
}

impl Default for CreditorWhitelistFile {
    fn default() -> Self {
        Self {
            version: CREDITOR_WHITELIST_VERSION,
            creditors: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrustStatus {
    Trusted,
    KnownEntityNewCbu,
    NewEntity,
}

impl CreditorWhitelistFile {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path)
            .with_context(|| format!("No se pudo leer la whitelist {path:?}"))?;
        let mut value = toml::from_str::<Self>(&raw)
            .with_context(|| format!("La whitelist {path:?} no es valida"))?;
        value.validate_and_normalize()?;
        Ok(value)
    }

    pub fn status(&self, cuit: &str, cbu: &str) -> TrustStatus {
        let Some(cuit) = normalize_digits(cuit) else {
            return TrustStatus::NewEntity;
        };
        let Some(cbu) = normalize_digits(cbu) else {
            return TrustStatus::NewEntity;
        };
        match self.creditors.iter().find(|item| item.cuit == cuit) {
            Some(item) if item.cbus.contains(&cbu) => TrustStatus::Trusted,
            Some(_) => TrustStatus::KnownEntityNewCbu,
            None => TrustStatus::NewEntity,
        }
    }

    pub fn approve(&mut self, cuit: &str, name: &str, cbu: &str) -> Result<TrustStatus> {
        let cuit = normalize_digits(cuit).ok_or_else(|| anyhow!("CUIT vacio"))?;
        let cbu = normalize_digits(cbu).ok_or_else(|| anyhow!("CBU vacio"))?;
        let name = name.trim();
        if !is_legal_entity_cuit(&cuit) {
            return Err(anyhow!(
                "El CUIT no corresponde a una persona juridica valida"
            ));
        }
        if cbu.len() != 22 {
            return Err(anyhow!("El CBU debe tener 22 digitos"));
        }
        if name.is_empty() {
            return Err(anyhow!("Coinag no devolvio el nombre del titular"));
        }
        let previous = self.status(&cuit, &cbu);
        match self.creditors.iter_mut().find(|item| item.cuit == cuit) {
            Some(item) => {
                item.name = name.to_owned();
                item.cbus.insert(cbu);
            }
            None => self.creditors.push(TrustedCreditor {
                cuit,
                name: name.to_owned(),
                cbus: BTreeSet::from([cbu]),
            }),
        }
        self.validate_and_normalize()?;
        Ok(previous)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let mut normalized = self.clone();
        normalized.validate_and_normalize()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("No se pudo crear la carpeta {parent:?}"))?;
        }
        let serialized =
            toml::to_string_pretty(&normalized).context("No se pudo serializar la whitelist")?;
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("whitelist.toml");
        let temporary = path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));
        let result = (|| -> Result<()> {
            let mut file = File::create(&temporary)
                .with_context(|| format!("No se pudo crear {temporary:?}"))?;
            file.write_all(serialized.as_bytes())?;
            file.sync_all()?;
            let verification = Self::load(&temporary)?;
            if verification != normalized {
                return Err(anyhow!(
                    "La verificacion de la whitelist temporal no coincide"
                ));
            }
            if path.exists() {
                fs::copy(path, path.with_file_name(format!("{file_name}.bak")))
                    .context("No se pudo respaldar la whitelist")?;
            }
            crate::credit_lines::replace_file(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    fn validate_and_normalize(&mut self) -> Result<()> {
        if self.version != CREDITOR_WHITELIST_VERSION {
            return Err(anyhow!(
                "Version de whitelist no soportada: {}",
                self.version
            ));
        }
        let mut seen = BTreeSet::new();
        for item in &mut self.creditors {
            item.cuit = normalize_digits(&item.cuit).ok_or_else(|| anyhow!("CUIT vacio"))?;
            if !is_legal_entity_cuit(&item.cuit) {
                return Err(anyhow!("CUIT de persona juridica invalido: {}", item.cuit));
            }
            if !seen.insert(item.cuit.clone()) {
                return Err(anyhow!("CUIT duplicado en whitelist: {}", item.cuit));
            }
            item.name = item.name.trim().to_owned();
            if item.name.is_empty() {
                return Err(anyhow!("Acreedor sin nombre: {}", item.cuit));
            }
            item.cbus = item
                .cbus
                .iter()
                .filter_map(normalize_digits)
                .collect::<BTreeSet<_>>();
            if item.cbus.iter().any(|cbu| cbu.len() != 22) {
                return Err(anyhow!("CBU invalido para acreedor {}", item.cuit));
            }
        }
        self.creditors.sort_by(|a, b| a.cuit.cmp(&b.cuit));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_seen_then_known_entity_then_trusted_pair() {
        let mut whitelist = CreditorWhitelistFile::default();
        assert_eq!(
            whitelist.status("30-62556738-2", "0970099413001097400111"),
            TrustStatus::NewEntity
        );
        whitelist
            .approve("30-62556738-2", "MUDON", "0970099413001097400111")
            .unwrap();
        assert_eq!(
            whitelist.status("30-62556738-2", "0970000000000000000000"),
            TrustStatus::KnownEntityNewCbu
        );
        assert_eq!(
            whitelist.status("30-62556738-2", "0970099413001097400111"),
            TrustStatus::Trusted
        );
    }
}
