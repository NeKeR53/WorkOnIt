use crate::domain::{Board, DomainError};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceFormat {
    Json,
    Jsonl,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    pub title: String,
    pub description: Option<String>,
    pub external_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRecord {
    pub title: String,
    pub description: String,
    pub external_key: Option<String>,
    pub source_line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewError {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreview {
    pub records: Vec<PreviewRecord>,
    pub errors: Vec<PreviewError>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub created: usize,
    pub updated: usize,
}

#[derive(Debug, Error)]
pub enum SourceError {
    #[error("Expression régulière invalide : {0}")]
    InvalidRegex(#[from] regex::Error),
    #[error("Erreur de domaine : {0}")]
    Domain(#[from] DomainError),
}

pub fn preview(
    format: SourceFormat,
    input: &str,
    mapping: &FieldMapping,
    text_pattern: Option<&str>,
) -> SourcePreview {
    let mut result = SourcePreview::default();
    match format {
        SourceFormat::Json => match serde_json::from_str::<Value>(input) {
            Ok(Value::Array(values)) => {
                for (index, value) in values.iter().enumerate() {
                    map_json_record(value, index + 1, mapping, &mut result);
                }
            }
            Ok(value) => map_json_record(&value, 1, mapping, &mut result),
            Err(error) => result.errors.push(PreviewError {
                line: error.line(),
                message: error.to_string(),
            }),
        },
        SourceFormat::Jsonl => {
            for (index, line) in input.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(line) {
                    Ok(value) => map_json_record(&value, index + 1, mapping, &mut result),
                    Err(error) => result.errors.push(PreviewError {
                        line: index + 1,
                        message: error.to_string(),
                    }),
                }
            }
        }
        SourceFormat::Text => match text_pattern.map(Regex::new) {
            Some(Ok(regex)) => {
                for (index, line) in input.lines().enumerate() {
                    match regex.captures(line) {
                        Some(captures) => {
                            let title = captures
                                .name("title")
                                .map(|value| value.as_str().trim().to_owned());
                            match title.filter(|title| !title.is_empty()) {
                                Some(title) => result.records.push(PreviewRecord {
                                    title,
                                    description: captures
                                        .name("description")
                                        .map(|value| value.as_str().to_owned())
                                        .unwrap_or_default(),
                                    external_key: captures
                                        .name("external_key")
                                        .map(|value| value.as_str().to_owned()),
                                    source_line: index + 1,
                                }),
                                None => result.errors.push(PreviewError {
                                    line: index + 1,
                                    message: "Le groupe nommé « title » est vide".into(),
                                }),
                            }
                        }
                        None => result.errors.push(PreviewError {
                            line: index + 1,
                            message: "Aucune correspondance".into(),
                        }),
                    }
                }
            }
            Some(Err(error)) => result.errors.push(PreviewError {
                line: 0,
                message: error.to_string(),
            }),
            None => result.errors.push(PreviewError {
                line: 0,
                message: "Une expression régulière est obligatoire".into(),
            }),
        },
    }
    if mapping.external_key.is_none()
        || result
            .records
            .iter()
            .any(|record| record.external_key.is_none())
    {
        result.warnings.push(
            "Aucune clé externe pour certains éléments : chaque collecte créera une tâche".into(),
        );
    }
    result
}

pub fn apply_preview(
    board: &mut Board,
    column_id: &str,
    source_name: &str,
    preview: &SourcePreview,
) -> Result<ImportSummary, SourceError> {
    let mut summary = ImportSummary {
        created: 0,
        updated: 0,
    };
    for record in &preview.records {
        let existing = record.external_key.as_ref().and_then(|key| {
            board
                .tasks
                .iter()
                .position(|task| task.external_key.as_ref() == Some(key))
        });
        if let Some(index) = existing {
            let task = &mut board.tasks[index];
            task.title = record.title.clone();
            task.description = record.description.clone();
            task.source_name = Some(source_name.to_owned());
            task.updated_at = Utc::now();
            summary.updated += 1;
        } else {
            let id = board.add_task(&record.title, column_id)?;
            let task = board
                .tasks
                .iter_mut()
                .find(|task| task.id == id)
                .expect("newly created task exists");
            task.description = record.description.clone();
            task.external_key = record.external_key.clone();
            task.source_name = Some(source_name.to_owned());
            summary.created += 1;
        }
    }
    Ok(summary)
}

fn map_json_record(
    value: &Value,
    line: usize,
    mapping: &FieldMapping,
    preview: &mut SourcePreview,
) {
    let title = value_at_path(value, &mapping.title).and_then(value_to_string);
    match title.filter(|title| !title.trim().is_empty()) {
        Some(title) => preview.records.push(PreviewRecord {
            title,
            description: mapping
                .description
                .as_deref()
                .and_then(|path| value_at_path(value, path))
                .and_then(value_to_string)
                .unwrap_or_default(),
            external_key: mapping
                .external_key
                .as_deref()
                .and_then(|path| value_at_path(value, path))
                .and_then(value_to_string),
            source_line: line,
        }),
        None => preview.errors.push(PreviewError {
            line,
            message: format!("Titre introuvable avec le chemin « {} »", mapping.title),
        }),
    }
}

fn value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let path = path.trim_start_matches('$').trim_start_matches('.');
    if path.is_empty() {
        return Some(value);
    }
    path.split('.').try_fold(value, |current, segment| {
        current.get(segment.trim_matches(['[', ']', '\'', '"']))
    })
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    }
}
