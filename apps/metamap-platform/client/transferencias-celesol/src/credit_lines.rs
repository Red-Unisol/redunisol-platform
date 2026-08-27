use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

pub const CREDIT_LINES_CONFIG_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CreditLineMode {
    #[default]
    Inhabilitada,
    Habilitada,
    Automatica,
}

impl CreditLineMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Inhabilitada => "Inhabilitada",
            Self::Habilitada => "Habilitada",
            Self::Automatica => "Automatica",
        }
    }

    pub fn allows_manual(self) -> bool {
        matches!(self, Self::Habilitada | Self::Automatica)
    }

    pub fn allows_automatic(self) -> bool {
        self == Self::Automatica
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CreditLineEntry {
    pub id: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub codigo: String,
    #[serde(default)]
    pub descripcion: String,
    pub modo: CreditLineMode,
    #[serde(skip)]
    pub present_in_core: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditLineCatalogEntry {
    pub id: u64,
    pub codigo: String,
    pub descripcion: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CreditLinesFile {
    pub version: u32,
    #[serde(default)]
    pub lineas: Vec<CreditLineEntry>,
}

impl Default for CreditLinesFile {
    fn default() -> Self {
        Self {
            version: CREDIT_LINES_CONFIG_VERSION,
            lineas: Vec::new(),
        }
    }
}

impl CreditLinesFile {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path)
            .with_context(|| format!("No se pudo leer la configuracion de lineas {path:?}"))?;
        let mut config = toml::from_str::<Self>(&raw)
            .with_context(|| format!("La configuracion de lineas {path:?} no es valida"))?;
        config.validate_and_normalize()?;
        Ok(config)
    }

    pub fn mode_for(&self, id: Option<u64>) -> CreditLineMode {
        let Some(id) = id else {
            return CreditLineMode::Inhabilitada;
        };
        self.lineas
            .iter()
            .find(|line| line.id == id)
            .map(|line| line.modo)
            .unwrap_or_default()
    }

    pub fn enabled_count(&self) -> usize {
        self.lineas
            .iter()
            .filter(|line| line.modo.allows_manual())
            .count()
    }

    pub fn automatic_count(&self) -> usize {
        self.lineas
            .iter()
            .filter(|line| line.modo.allows_automatic())
            .count()
    }

    pub fn reconcile(&mut self, catalog: Vec<CreditLineCatalogEntry>) -> Result<ReconcileSummary> {
        validate_catalog(&catalog)?;
        let mut existing = self
            .lineas
            .drain(..)
            .map(|line| (line.id, line))
            .collect::<HashMap<_, _>>();
        let mut refreshed = Vec::with_capacity(catalog.len() + existing.len());
        let mut summary = ReconcileSummary::default();

        for catalog_line in catalog {
            if let Some(mut line) = existing.remove(&catalog_line.id) {
                if line.codigo != catalog_line.codigo
                    || line.descripcion != catalog_line.descripcion
                {
                    summary.updated += 1;
                }
                line.codigo = catalog_line.codigo;
                line.descripcion = catalog_line.descripcion;
                line.present_in_core = Some(true);
                refreshed.push(line);
            } else {
                summary.added += 1;
                refreshed.push(CreditLineEntry {
                    id: catalog_line.id,
                    codigo: catalog_line.codigo,
                    descripcion: catalog_line.descripcion,
                    modo: CreditLineMode::Inhabilitada,
                    present_in_core: Some(true),
                });
            }
        }

        summary.missing = existing.len();
        for (_, mut line) in existing {
            line.present_in_core = Some(false);
            refreshed.push(line);
        }
        self.lineas = refreshed;
        self.validate_and_normalize()?;
        Ok(summary)
    }

    pub fn save_atomic(&self, path: &Path) -> Result<()> {
        let mut normalized = self.clone();
        normalized.validate_and_normalize()?;
        for line in &mut normalized.lineas {
            line.present_in_core = None;
        }
        let serialized = toml::to_string_pretty(&normalized)
            .context("No se pudo serializar la configuracion de lineas")?;
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)
            .with_context(|| format!("No se pudo crear la carpeta {parent:?}"))?;
        let temporary = temporary_path(path);

        let write_result = (|| -> Result<()> {
            let mut file = File::create(&temporary)
                .with_context(|| format!("No se pudo crear el temporal {temporary:?}"))?;
            file.write_all(serialized.as_bytes())
                .with_context(|| format!("No se pudo escribir el temporal {temporary:?}"))?;
            file.sync_all()
                .with_context(|| format!("No se pudo sincronizar el temporal {temporary:?}"))?;
            let verification = Self::load(&temporary)?;
            if verification != normalized {
                return Err(anyhow!("La verificacion del archivo temporal no coincide"));
            }

            if path.exists() {
                let backup = backup_path(path);
                fs::copy(path, &backup)
                    .with_context(|| format!("No se pudo crear el respaldo {backup:?}"))?;
            }
            replace_file(&temporary, path)
        })();

        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }

    fn validate_and_normalize(&mut self) -> Result<()> {
        if self.version != CREDIT_LINES_CONFIG_VERSION {
            return Err(anyhow!(
                "Version de configuracion de lineas no soportada: {}",
                self.version
            ));
        }
        let mut ids = HashSet::new();
        for line in &mut self.lineas {
            if line.id == 0 {
                return Err(anyhow!("Una linea tiene ID 0, que no es valido"));
            }
            if !ids.insert(line.id) {
                return Err(anyhow!("El ID de linea {} aparece mas de una vez", line.id));
            }
            line.codigo = line.codigo.trim().to_owned();
            line.descripcion = line.descripcion.trim().to_owned();
        }
        self.lineas.sort_by_key(|line| line.id);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ReconcileSummary {
    pub added: usize,
    pub updated: usize,
    pub missing: usize,
}

fn validate_catalog(catalog: &[CreditLineCatalogEntry]) -> Result<()> {
    let mut ids = HashSet::new();
    for line in catalog {
        if line.id == 0 {
            return Err(anyhow!("El core devolvio una linea con ID 0"));
        }
        if !ids.insert(line.id) {
            return Err(anyhow!(
                "El core devolvio el ID de linea {} duplicado",
                line.id
            ));
        }
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("lineas.toml");
    path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()))
}

fn backup_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("lineas.toml");
    path.with_file_name(format!("{file_name}.bak"))
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let succeeded = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error())
            .context("No se pudo reemplazar atomicamente la configuracion de lineas");
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination)
        .context("No se pudo reemplazar atomicamente la configuracion de lineas")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(id: u64, code: &str, description: &str) -> CreditLineCatalogEntry {
        CreditLineCatalogEntry {
            id,
            codigo: code.to_owned(),
            descripcion: description.to_owned(),
        }
    }

    #[test]
    fn reconcile_preserves_mode_by_id_and_updates_metadata() {
        let mut config = CreditLinesFile {
            version: CREDIT_LINES_CONFIG_VERSION,
            lineas: vec![CreditLineEntry {
                id: 10,
                codigo: "old".to_owned(),
                descripcion: "Nombre anterior".to_owned(),
                modo: CreditLineMode::Automatica,
                present_in_core: None,
            }],
        };

        let summary = config
            .reconcile(vec![catalog(10, "new", "Nombre nuevo")])
            .unwrap();

        assert_eq!(summary.updated, 1);
        assert_eq!(config.mode_for(Some(10)), CreditLineMode::Automatica);
        assert_eq!(config.lineas[0].descripcion, "Nombre nuevo");
    }

    #[test]
    fn reconcile_adds_unknown_ids_disabled_and_keeps_missing_ids() {
        let mut config = CreditLinesFile {
            version: CREDIT_LINES_CONFIG_VERSION,
            lineas: vec![CreditLineEntry {
                id: 10,
                codigo: String::new(),
                descripcion: "Anterior".to_owned(),
                modo: CreditLineMode::Habilitada,
                present_in_core: None,
            }],
        };

        let summary = config.reconcile(vec![catalog(20, "20", "Nueva")]).unwrap();

        assert_eq!(summary.added, 1);
        assert_eq!(summary.missing, 1);
        assert_eq!(config.mode_for(Some(20)), CreditLineMode::Inhabilitada);
        assert_eq!(config.mode_for(Some(10)), CreditLineMode::Habilitada);
        assert_eq!(
            config
                .lineas
                .iter()
                .find(|line| line.id == 10)
                .unwrap()
                .present_in_core,
            Some(false)
        );
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let mut config = CreditLinesFile {
            version: CREDIT_LINES_CONFIG_VERSION,
            lineas: vec![
                CreditLineEntry {
                    id: 10,
                    codigo: String::new(),
                    descripcion: String::new(),
                    modo: CreditLineMode::Inhabilitada,
                    present_in_core: None,
                },
                CreditLineEntry {
                    id: 10,
                    codigo: String::new(),
                    descripcion: String::new(),
                    modo: CreditLineMode::Automatica,
                    present_in_core: None,
                },
            ],
        };

        assert!(config.validate_and_normalize().is_err());
    }

    #[test]
    fn save_and_load_round_trip() {
        let directory = std::env::temp_dir().join(format!(
            "transferencias-credit-lines-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("lineas.toml");
        let mut config = CreditLinesFile::default();
        config.reconcile(vec![catalog(10, "A", "Linea A")]).unwrap();
        config.lineas[0].modo = CreditLineMode::Automatica;

        config.save_atomic(&path).unwrap();
        let loaded = CreditLinesFile::load(&path).unwrap();

        assert_eq!(loaded.mode_for(Some(10)), CreditLineMode::Automatica);
        let _ = fs::remove_dir_all(directory);
    }
}
