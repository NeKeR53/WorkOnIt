use crate::{
    automation::{ActionExecutor, CancellationToken, CommandAction, ControlledActionExecutor},
    domain::{Board, CustomFieldValue, DomainError, ExecutionStatus, FieldKind, Task},
};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json_path::JsonPath;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Mutex,
};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceFormat {
    Json,
    Jsonl,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SourceEncoding {
    #[default]
    Utf8,
    Windows1252,
    System,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    pub title: String,
    pub description: Option<String>,
    pub external_key: Option<String>,
    #[serde(default)]
    pub column: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceUpdateField {
    Title,
    Description,
}

fn default_update_fields() -> Vec<SourceUpdateField> {
    vec![SourceUpdateField::Title, SourceUpdateField::Description]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDefinition {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub command: CommandAction,
    pub format: SourceFormat,
    pub mapping: FieldMapping,
    pub text_pattern: Option<String>,
    pub initial_column_id: String,
    #[serde(default)]
    pub column_mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub fallback_column_id: Option<String>,
    #[serde(default = "default_update_fields")]
    pub allowed_update_fields: Vec<SourceUpdateField>,
    #[serde(default)]
    pub custom_field_mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub allowed_update_custom_fields: Vec<String>,
    #[serde(default)]
    pub move_existing_tasks: bool,
    pub accept_partial: bool,
    pub absence_threshold: u32,
    pub output_limit_bytes: usize,
    #[serde(default)]
    pub encoding: SourceEncoding,
    pub enabled: bool,
}

impl SourceDefinition {
    pub fn new(
        board_id: impl Into<String>,
        name: impl Into<String>,
        script: impl Into<String>,
        format: SourceFormat,
        mapping: FieldMapping,
        initial_column_id: impl Into<String>,
    ) -> Self {
        let name = name.into();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            board_id: board_id.into(),
            command: CommandAction::shell(&name, script),
            name,
            format,
            mapping,
            text_pattern: None,
            initial_column_id: initial_column_id.into(),
            column_mapping: BTreeMap::new(),
            fallback_column_id: None,
            allowed_update_fields: default_update_fields(),
            custom_field_mapping: BTreeMap::new(),
            allowed_update_custom_fields: Vec::new(),
            move_existing_tasks: false,
            accept_partial: false,
            absence_threshold: 3,
            output_limit_bytes: 10 * 1024 * 1024,
            encoding: SourceEncoding::Utf8,
            enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCommandOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub encoding_errors: bool,
}

pub trait SourceExecutor {
    fn execute(&self, source: &SourceDefinition) -> SourceCommandOutput;

    fn execute_controlled(
        &self,
        source: &SourceDefinition,
        _cancellation: &CancellationToken,
    ) -> SourceCommandOutput {
        self.execute(source)
    }
}

pub struct SystemSourceExecutor;

impl SourceExecutor for SystemSourceExecutor {
    fn execute(&self, source: &SourceDefinition) -> SourceCommandOutput {
        self.execute_controlled(source, &CancellationToken::default())
    }

    fn execute_controlled(
        &self,
        source: &SourceDefinition,
        cancellation: &CancellationToken,
    ) -> SourceCommandOutput {
        let mut command = source.command.clone();
        command.output_limit_bytes = source.output_limit_bytes;
        let execution = ControlledActionExecutor::new(cancellation.clone())
            .execute(&command, &source_context_task(source));
        let (stdout, stdout_errors) = decode_output(&execution.stdout_bytes, &source.encoding);
        let (stderr, stderr_errors) = decode_output(&execution.stderr_bytes, &source.encoding);
        SourceCommandOutput {
            exit_code: execution.exit_code,
            stdout,
            stderr,
            truncated: execution.stdout_truncated || execution.stderr_truncated,
            cancelled: execution.status == crate::automation::StepStatus::Cancelled,
            encoding_errors: stdout_errors || stderr_errors,
        }
    }
}

fn decode_output(bytes: &[u8], encoding: &SourceEncoding) -> (String, bool) {
    match encoding {
        SourceEncoding::Utf8 => match String::from_utf8(bytes.to_vec()) {
            Ok(value) => (value, false),
            Err(error) => (String::from_utf8_lossy(error.as_bytes()).into_owned(), true),
        },
        SourceEncoding::Windows1252 => {
            let (value, _, errors) = encoding_rs::WINDOWS_1252.decode(bytes);
            (value.into_owned(), errors)
        }
        SourceEncoding::System => decode_system_output(bytes),
        SourceEncoding::Auto => match String::from_utf8(bytes.to_vec()) {
            Ok(value) => (value, false),
            Err(_) => {
                let (value, _, errors) = encoding_rs::WINDOWS_1252.decode(bytes);
                (value.into_owned(), errors)
            }
        },
    }
}

#[cfg(target_os = "windows")]
fn decode_system_output(bytes: &[u8]) -> (String, bool) {
    let (value, _, errors) = encoding_rs::WINDOWS_1252.decode(bytes);
    (value.into_owned(), errors)
}

#[cfg(not(target_os = "windows"))]
fn decode_system_output(bytes: &[u8]) -> (String, bool) {
    decode_output(bytes, &SourceEncoding::Utf8)
}

#[derive(Debug, Clone, Copy)]
pub struct SourceRunRequest {
    pub force_import: bool,
    pub allow_truncated: bool,
}

impl SourceRunRequest {
    pub fn automatic() -> Self {
        Self {
            force_import: false,
            allow_truncated: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRecord {
    pub title: String,
    pub description: String,
    pub external_key: Option<String>,
    pub source_line: usize,
    pub column_value: Option<String>,
    #[serde(default)]
    pub custom_values: BTreeMap<String, String>,
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
    #[serde(default)]
    pub pending_moves: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMoveRequest {
    pub task_id: String,
    pub target_column_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRunResult {
    pub output: SourceCommandOutput,
    pub preview: SourcePreview,
    pub import: Option<ImportSummary>,
}

#[derive(Debug, Error)]
pub enum SourceError {
    #[error("Expression régulière invalide : {0}")]
    InvalidRegex(#[from] regex::Error),
    #[error("Erreur de domaine : {0}")]
    Domain(#[from] DomainError),
    #[error("La commande source a échoué avec le code {0:?}")]
    CommandFailed(Option<i32>),
    #[error("La sortie source est tronquée et exige une validation manuelle")]
    TruncatedOutput,
    #[error("Une exécution de cette source est déjà active")]
    AlreadyActive,
    #[error("L’exécution de la source a été annulée")]
    Cancelled,
    #[error("Valeur invalide pour le champ personnalisé « {0} »")]
    InvalidCustomValue(String),
}

pub fn run_source(
    board: &mut Board,
    source: &SourceDefinition,
    executor: &impl SourceExecutor,
    request: SourceRunRequest,
) -> Result<SourceRunResult, SourceError> {
    run_source_controlled(
        board,
        source,
        executor,
        request,
        &CancellationToken::default(),
    )
}

pub fn run_source_controlled(
    board: &mut Board,
    source: &SourceDefinition,
    executor: &impl SourceExecutor,
    request: SourceRunRequest,
    cancellation: &CancellationToken,
) -> Result<SourceRunResult, SourceError> {
    if source.board_id != board.id {
        return Err(SourceError::Domain(DomainError::BoardNotFound));
    }
    let mut result = inspect_source_controlled(source, executor, cancellation)?;
    if result.output.truncated && !request.allow_truncated {
        return Err(SourceError::TruncatedOutput);
    }
    let accepted = result
        .output
        .exit_code
        .is_some_and(|code| source.command.accepted_exit_codes.contains(&code));
    if !accepted && !source.accept_partial && !request.force_import {
        return Err(SourceError::CommandFailed(result.output.exit_code));
    }
    result.import = Some(apply_source_preview(board, source, &result.preview)?);
    Ok(result)
}

pub fn inspect_source_controlled(
    source: &SourceDefinition,
    executor: &impl SourceExecutor,
    cancellation: &CancellationToken,
) -> Result<SourceRunResult, SourceError> {
    let output = executor.execute_controlled(source, cancellation);
    if output.cancelled {
        return Err(SourceError::Cancelled);
    }
    let mut source_preview = preview_with_custom_fields(
        source.format.clone(),
        &output.stdout,
        &source.mapping,
        source.text_pattern.as_deref(),
        &source.custom_field_mapping,
    );
    if output.encoding_errors {
        source_preview
            .warnings
            .push("La sortie contient des octets invalides pour l’encodage choisi".into());
    }
    Ok(SourceRunResult {
        output,
        preview: source_preview,
        import: None,
    })
}

#[derive(Default)]
pub struct SourceCoordinator {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl SourceCoordinator {
    pub fn start<'a>(&'a self, source_id: &str) -> Result<SourceRunGuard<'a>, SourceError> {
        let mut active = self
            .active
            .lock()
            .expect("source coordinator lock poisoned");
        if active.contains_key(source_id) {
            return Err(SourceError::AlreadyActive);
        }
        let cancellation = CancellationToken::default();
        active.insert(source_id.to_owned(), cancellation.clone());
        Ok(SourceRunGuard {
            coordinator: self,
            source_id: source_id.to_owned(),
            cancellation,
        })
    }

    pub fn cancel(&self, source_id: &str) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.get(source_id).cloned())
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }
}

pub struct SourceRunGuard<'a> {
    coordinator: &'a SourceCoordinator,
    source_id: String,
    cancellation: CancellationToken,
}

impl SourceRunGuard<'_> {
    pub fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }
}

impl Drop for SourceRunGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.coordinator.active.lock() {
            active.remove(&self.source_id);
        }
    }
}

pub fn preview(
    format: SourceFormat,
    input: &str,
    mapping: &FieldMapping,
    text_pattern: Option<&str>,
) -> SourcePreview {
    preview_with_custom_fields(format, input, mapping, text_pattern, &BTreeMap::new())
}

pub fn preview_with_custom_fields(
    format: SourceFormat,
    input: &str,
    mapping: &FieldMapping,
    text_pattern: Option<&str>,
    custom_field_mapping: &BTreeMap<String, String>,
) -> SourcePreview {
    let mut result = SourcePreview::default();
    match format {
        SourceFormat::Json => match serde_json::from_str::<Value>(input) {
            Ok(Value::Array(values)) => {
                for (index, value) in values.iter().enumerate() {
                    map_json_record(value, index + 1, mapping, custom_field_mapping, &mut result);
                }
            }
            Ok(value) => map_json_record(&value, 1, mapping, custom_field_mapping, &mut result),
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
                    Ok(value) => map_json_record(
                        &value,
                        index + 1,
                        mapping,
                        custom_field_mapping,
                        &mut result,
                    ),
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
                                    column_value: None,
                                    custom_values: custom_field_mapping
                                        .iter()
                                        .filter_map(|(field_id, capture_name)| {
                                            captures.name(capture_name).map(|value| {
                                                (field_id.clone(), value.as_str().to_owned())
                                            })
                                        })
                                        .collect(),
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
    let source = SourceDefinition {
        id: String::new(),
        board_id: board.id.clone(),
        name: source_name.to_owned(),
        command: CommandAction::shell(source_name, ""),
        format: SourceFormat::Json,
        mapping: FieldMapping {
            title: String::new(),
            description: None,
            external_key: None,
            column: None,
        },
        text_pattern: None,
        initial_column_id: column_id.to_owned(),
        column_mapping: BTreeMap::new(),
        fallback_column_id: None,
        allowed_update_fields: default_update_fields(),
        custom_field_mapping: BTreeMap::new(),
        allowed_update_custom_fields: Vec::new(),
        move_existing_tasks: false,
        accept_partial: false,
        absence_threshold: 0,
        output_limit_bytes: 10 * 1024 * 1024,
        encoding: SourceEncoding::Utf8,
        enabled: false,
    };
    apply_source_preview(board, &source, preview)
}

pub fn apply_source_preview(
    board: &mut Board,
    source: &SourceDefinition,
    preview: &SourcePreview,
) -> Result<ImportSummary, SourceError> {
    let mut summary = ImportSummary {
        created: 0,
        updated: 0,
        pending_moves: 0,
    };
    let present_keys: HashSet<&str> = preview
        .records
        .iter()
        .filter_map(|record| record.external_key.as_deref())
        .collect();
    for record in &preview.records {
        let target_column = record
            .column_value
            .as_ref()
            .and_then(|value| source.column_mapping.get(value))
            .or(source.fallback_column_id.as_ref())
            .unwrap_or(&source.initial_column_id)
            .clone();
        let existing = record.external_key.as_ref().and_then(|key| {
            board.tasks.iter().position(|task| {
                task.source_id.as_deref() == Some(source.id.as_str())
                    && task.external_key.as_ref() == Some(key)
            })
        });
        let was_existing = existing.is_some();
        let task_id = if let Some(index) = existing {
            if source.move_existing_tasks && board.tasks[index].column_id != target_column {
                let task_id = board.tasks[index].id.clone();
                board.move_task(
                    &task_id,
                    &target_column,
                    crate::domain::TransitionOrigin::Source,
                )?;
            }
            let task = &mut board.tasks[index];
            if source
                .allowed_update_fields
                .contains(&SourceUpdateField::Title)
            {
                task.title = record.title.clone();
            }
            if source
                .allowed_update_fields
                .contains(&SourceUpdateField::Description)
            {
                task.description = record.description.clone();
            }
            task.source_name = Some(source.name.clone());
            task.source_id = Some(source.id.clone());
            task.source_absence_count = 0;
            task.absent_from_source = false;
            task.updated_at = Utc::now();
            summary.updated += 1;
            task.id.clone()
        } else {
            let id = board.add_task(&record.title, &target_column)?;
            let task = board
                .tasks
                .iter_mut()
                .find(|task| task.id == id)
                .expect("newly created task exists");
            task.description = record.description.clone();
            task.external_key = record.external_key.clone();
            task.source_name = Some(source.name.clone());
            task.source_id = Some(source.id.clone());
            summary.created += 1;
            id
        };
        for (field_id, raw_value) in &record.custom_values {
            if was_existing && !source.allowed_update_custom_fields.contains(field_id) {
                continue;
            }
            let kind = board
                .custom_fields
                .iter()
                .find(|field| field.id == *field_id)
                .map(|field| field.kind.clone())
                .ok_or(DomainError::CustomFieldNotFound)?;
            let value = custom_field_value(&kind, raw_value)
                .ok_or_else(|| SourceError::InvalidCustomValue(field_id.clone()))?;
            board.set_custom_value(&task_id, field_id, value)?;
        }
    }
    if source.absence_threshold > 0 {
        for task in board.tasks.iter_mut().filter(|task| {
            task.source_id.as_deref() == Some(source.id.as_str())
                && task.external_key.is_some()
                && !present_keys.contains(task.external_key.as_deref().unwrap_or_default())
        }) {
            task.source_absence_count = task.source_absence_count.saturating_add(1);
            task.absent_from_source = task.source_absence_count >= source.absence_threshold;
            task.updated_at = Utc::now();
        }
    }
    Ok(summary)
}

fn custom_field_value(kind: &FieldKind, value: &str) -> Option<CustomFieldValue> {
    Some(match kind {
        FieldKind::Text => CustomFieldValue::Text(value.to_owned()),
        FieldKind::Number => CustomFieldValue::Number(value.parse().ok()?),
        FieldKind::Boolean => {
            CustomFieldValue::Boolean(match value.to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" => true,
                "false" | "0" | "no" => false,
                _ => return None,
            })
        }
        FieldKind::Date => CustomFieldValue::Date(value.to_owned()),
        FieldKind::List { .. } => CustomFieldValue::List(value.to_owned()),
        FieldKind::Secret => return None,
    })
}

pub fn planned_source_moves(
    board: &Board,
    source: &SourceDefinition,
    preview: &SourcePreview,
) -> Vec<SourceMoveRequest> {
    if !source.move_existing_tasks {
        return Vec::new();
    }
    preview
        .records
        .iter()
        .filter_map(|record| {
            let external_key = record.external_key.as_ref()?;
            let task = board.tasks.iter().find(|task| {
                task.source_id.as_deref() == Some(source.id.as_str())
                    && task.external_key.as_ref() == Some(external_key)
            })?;
            let target_column_id = record
                .column_value
                .as_ref()
                .and_then(|value| source.column_mapping.get(value))
                .or(source.fallback_column_id.as_ref())
                .unwrap_or(&source.initial_column_id)
                .clone();
            (task.column_id != target_column_id).then(|| SourceMoveRequest {
                task_id: task.id.clone(),
                target_column_id,
            })
        })
        .collect()
}

fn map_json_record(
    value: &Value,
    line: usize,
    mapping: &FieldMapping,
    custom_field_mapping: &BTreeMap<String, String>,
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
            column_value: mapping
                .column
                .as_deref()
                .and_then(|path| value_at_path(value, path))
                .and_then(value_to_string),
            custom_values: custom_field_mapping
                .iter()
                .filter_map(|(field_id, path)| {
                    value_at_path(value, path)
                        .and_then(value_to_string)
                        .map(|value| (field_id.clone(), value))
                })
                .collect(),
        }),
        None => preview.errors.push(PreviewError {
            line,
            message: format!("Titre introuvable avec le chemin « {} »", mapping.title),
        }),
    }
}

fn value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let normalized = if path.starts_with('$') {
        path.to_owned()
    } else {
        format!("$.{path}")
    };
    JsonPath::parse(&normalized).ok()?.query(value).first()
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    }
}

fn source_context_task(source: &SourceDefinition) -> Task {
    let now = Utc::now();
    Task {
        id: source.id.clone(),
        title: source.name.clone(),
        description: "Exécution de source".into(),
        column_id: source.initial_column_id.clone(),
        position: 0,
        tags: Vec::new(),
        notes: String::new(),
        priority: None,
        due_date: None,
        source_id: Some(source.id.clone()),
        source_name: Some(source.name.clone()),
        external_key: None,
        source_absence_count: 0,
        absent_from_source: false,
        custom_values: BTreeMap::new(),
        execution_status: ExecutionStatus::Running { step: 1, total: 1 },
        history: Vec::new(),
        archived: false,
        created_at: now,
        updated_at: now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_decoding_covers_invalid_utf8_auto_and_system_paths() {
        let invalid = [0xff];
        assert!(decode_output(&invalid, &SourceEncoding::Utf8).1);
        assert_eq!(
            decode_output(b"ok", &SourceEncoding::Auto),
            ("ok".into(), false)
        );
        assert_eq!(decode_output(&[0xe9], &SourceEncoding::Auto).0, "é");
        assert_eq!(
            decode_output(b"system", &SourceEncoding::System).0,
            "system"
        );
    }
}
