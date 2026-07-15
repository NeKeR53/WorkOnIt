use crate::{automation::CommandAction, domain::Board};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};
use thiserror::Error;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format_version: u32,
    pub exported_at: DateTime<Utc>,
    pub product: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub boards: Vec<Board>,
    pub actions: Vec<CommandAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub manifest: Manifest,
    pub bundle: ExportBundle,
    pub trust_required_actions: Vec<String>,
}

#[derive(Debug, Error)]
pub enum ExchangeError {
    #[error("Erreur d’archive : {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Erreur de lecture : {0}")]
    Io(#[from] std::io::Error),
    #[error("Manifeste invalide : {0}")]
    Json(#[from] serde_json::Error),
    #[error("Version de format non prise en charge : {0}")]
    UnsupportedVersion(u32),
}

pub fn export_bundle(bundle: &ExportBundle) -> Result<Vec<u8>, ExchangeError> {
    let manifest = Manifest {
        format_version: FORMAT_VERSION,
        exported_at: Utc::now(),
        product: "WorkOnIt".into(),
    };
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    write_json(&mut archive, "manifest.json", &manifest, options)?;
    write_json(&mut archive, "boards.json", &bundle.boards, options)?;
    write_json(&mut archive, "actions.json", &bundle.actions, options)?;
    Ok(archive.finish()?.into_inner())
}

pub fn import_bundle(bytes: &[u8]) -> Result<ImportResult, ExchangeError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let manifest: Manifest = read_json(&mut archive, "manifest.json")?;
    if manifest.format_version != FORMAT_VERSION {
        return Err(ExchangeError::UnsupportedVersion(manifest.format_version));
    }
    let boards = read_json(&mut archive, "boards.json")?;
    let mut actions: Vec<CommandAction> = read_json(&mut archive, "actions.json")?;
    let trust_required_actions = actions
        .iter()
        .filter(|action| !action.script.trim().is_empty())
        .map(|action| action.id.clone())
        .collect();
    for action in &mut actions {
        if !action.script.trim().is_empty() {
            action.enabled = false;
        }
    }
    Ok(ImportResult {
        manifest,
        bundle: ExportBundle { boards, actions },
        trust_required_actions,
    })
}

fn write_json<T: Serialize>(
    archive: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    value: &T,
    options: SimpleFileOptions,
) -> Result<(), ExchangeError> {
    archive.start_file(name, options)?;
    archive.write_all(&serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Result<T, ExchangeError> {
    let mut file = archive.by_name(name)?;
    let mut value = String::new();
    file.read_to_string(&mut value)?;
    Ok(serde_json::from_str(&value)?)
}
