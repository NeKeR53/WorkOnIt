use crate::{
    automation::{CommandAction, ExecutionRecord, TransitionAutomation},
    domain::Board,
    scheduler::TriggerDefinition,
    sources::SourceDefinition,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
};
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
    #[serde(default)]
    pub automations: Vec<TransitionAutomation>,
    #[serde(default)]
    pub sources: Vec<SourceDefinition>,
    #[serde(default)]
    pub triggers: Vec<TriggerDefinition>,
    #[serde(default)]
    pub execution_history: Vec<ExecutionRecord>,
    #[serde(default)]
    pub logs: Vec<ExportLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLog {
    pub execution_id: String,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ImportObjectKind {
    Board,
    Action,
    Automation,
    Source,
    Trigger,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    pub id: String,
    pub name: String,
    pub kind: ImportObjectKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportResolution {
    Update,
    Copy,
    Ignore,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDecision {
    pub id: String,
    pub kind: ImportObjectKind,
    pub resolution: ImportResolution,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub manifest: Manifest,
    pub bundle: ExportBundle,
    pub trust_required_actions: Vec<String>,
    pub trust_required_sources: Vec<String>,
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
    #[error("Conflit sans décision : {0}")]
    UnresolvedConflict(String),
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
    write_json(
        &mut archive,
        "automations.json",
        &bundle.automations,
        options,
    )?;
    write_json(&mut archive, "sources.json", &bundle.sources, options)?;
    write_json(&mut archive, "triggers.json", &bundle.triggers, options)?;
    if !bundle.execution_history.is_empty() {
        write_json(
            &mut archive,
            "execution-history.json",
            &bundle.execution_history,
            options,
        )?;
    }
    if !bundle.logs.is_empty() {
        write_json(&mut archive, "logs.json", &bundle.logs, options)?;
    }
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
    let mut automations: Vec<TransitionAutomation> =
        read_optional_json(&mut archive, "automations.json")?;
    let mut sources: Vec<SourceDefinition> = read_optional_json(&mut archive, "sources.json")?;
    let mut triggers: Vec<TriggerDefinition> = read_optional_json(&mut archive, "triggers.json")?;
    let execution_history = read_optional_json(&mut archive, "execution-history.json")?;
    let logs = read_optional_json(&mut archive, "logs.json")?;
    let trust_required_actions = actions
        .iter()
        .filter(|action| !action.script.trim().is_empty() || !action.variants.is_empty())
        .map(|action| action.id.clone())
        .collect();
    for action in &mut actions {
        if !action.script.trim().is_empty() || !action.variants.is_empty() {
            action.enabled = false;
        }
    }
    let trust_required_sources = sources
        .iter()
        .filter(|source| {
            !source.command.script.trim().is_empty() || !source.command.variants.is_empty()
        })
        .map(|source| source.id.clone())
        .collect();
    for source in &mut sources {
        source.enabled = false;
        source.command.enabled = false;
    }
    for automation in &mut automations {
        automation.enabled = false;
    }
    for trigger in &mut triggers {
        trigger.enabled = false;
    }
    Ok(ImportResult {
        manifest,
        bundle: ExportBundle {
            boards,
            actions,
            automations,
            sources,
            triggers,
            execution_history,
            logs,
        },
        trust_required_actions,
        trust_required_sources,
    })
}

pub fn preview_conflicts(imported: &ExportBundle, existing: &ExportBundle) -> Vec<ImportConflict> {
    let mut conflicts = Vec::new();
    for board in &imported.boards {
        if existing.boards.iter().any(|current| current.id == board.id) {
            conflicts.push(ImportConflict {
                id: board.id.clone(),
                name: board.name.clone(),
                kind: ImportObjectKind::Board,
            });
        }
    }
    for action in &imported.actions {
        if existing
            .actions
            .iter()
            .any(|current| current.id == action.id)
        {
            conflicts.push(ImportConflict {
                id: action.id.clone(),
                name: action.name.clone(),
                kind: ImportObjectKind::Action,
            });
        }
    }
    for automation in &imported.automations {
        if existing
            .automations
            .iter()
            .any(|current| current.id == automation.id)
        {
            conflicts.push(ImportConflict {
                id: automation.id.clone(),
                name: automation.name.clone(),
                kind: ImportObjectKind::Automation,
            });
        }
    }
    for source in &imported.sources {
        if existing
            .sources
            .iter()
            .any(|current| current.id == source.id)
        {
            conflicts.push(ImportConflict {
                id: source.id.clone(),
                name: source.name.clone(),
                kind: ImportObjectKind::Source,
            });
        }
    }
    for trigger in &imported.triggers {
        if existing
            .triggers
            .iter()
            .any(|current| current.id == trigger.id)
        {
            conflicts.push(ImportConflict {
                id: trigger.id.clone(),
                name: trigger.id.clone(),
                kind: ImportObjectKind::Trigger,
            });
        }
    }
    conflicts
}

pub fn apply_import(
    existing: &ExportBundle,
    imported: &ExportBundle,
    decisions: &[ConflictDecision],
) -> Result<ExportBundle, ExchangeError> {
    let decision_map: HashMap<(ImportObjectKind, String), ImportResolution> = decisions
        .iter()
        .map(|decision| {
            (
                (decision.kind.clone(), decision.id.clone()),
                decision.resolution.clone(),
            )
        })
        .collect();
    for conflict in preview_conflicts(imported, existing) {
        if !decision_map.contains_key(&(conflict.kind, conflict.id.clone())) {
            return Err(ExchangeError::UnresolvedConflict(conflict.id));
        }
    }

    let mut result = existing.clone();
    let mut board_ids = HashMap::new();
    let mut column_ids = HashMap::new();
    let mut task_ids = HashMap::new();
    let mut action_ids = HashMap::new();
    let mut source_ids = HashMap::new();

    for board in &imported.boards {
        let original_id = board.id.clone();
        let resolution = resolution_for(
            &decision_map,
            ImportObjectKind::Board,
            &board.id,
            result.boards.iter().any(|current| current.id == board.id),
        );
        if resolution == ImportResolution::Ignore {
            continue;
        }
        let mut board = board.clone();
        if resolution == ImportResolution::Copy {
            copy_board_ids(&mut board, &mut column_ids, &mut task_ids);
            board_ids.insert(original_id, board.id.clone());
        }
        upsert(&mut result.boards, board, |value| &value.id, resolution);
    }

    for action in &imported.actions {
        let exists = result.actions.iter().any(|current| current.id == action.id);
        let resolution =
            resolution_for(&decision_map, ImportObjectKind::Action, &action.id, exists);
        if resolution == ImportResolution::Ignore {
            continue;
        }
        let mut action = action.clone();
        if resolution == ImportResolution::Copy {
            let original = action.id.clone();
            action.id = uuid::Uuid::new_v4().to_string();
            action_ids.insert(original, action.id.clone());
        }
        upsert(&mut result.actions, action, |value| &value.id, resolution);
    }

    for source in &imported.sources {
        let exists = result.sources.iter().any(|current| current.id == source.id);
        let resolution =
            resolution_for(&decision_map, ImportObjectKind::Source, &source.id, exists);
        if resolution == ImportResolution::Ignore {
            continue;
        }
        let mut source = source.clone();
        source.board_id = board_ids
            .get(&source.board_id)
            .cloned()
            .unwrap_or(source.board_id);
        remap_source_columns(&mut source, &column_ids);
        if resolution == ImportResolution::Copy {
            let original = source.id.clone();
            source.id = uuid::Uuid::new_v4().to_string();
            source.command.id = uuid::Uuid::new_v4().to_string();
            source_ids.insert(original, source.id.clone());
        }
        upsert(&mut result.sources, source, |value| &value.id, resolution);
    }

    for automation in &imported.automations {
        let exists = result
            .automations
            .iter()
            .any(|current| current.id == automation.id);
        let resolution = resolution_for(
            &decision_map,
            ImportObjectKind::Automation,
            &automation.id,
            exists,
        );
        if resolution == ImportResolution::Ignore {
            continue;
        }
        let mut automation = automation.clone();
        automation.board_id = board_ids
            .get(&automation.board_id)
            .cloned()
            .unwrap_or(automation.board_id);
        automation.from_column_id = automation
            .from_column_id
            .map(|id| column_ids.get(&id).cloned().unwrap_or(id));
        automation.to_column_id = column_ids
            .get(&automation.to_column_id)
            .cloned()
            .unwrap_or(automation.to_column_id);
        for step in &mut automation.steps {
            step.action_id = action_ids
                .get(&step.action_id)
                .cloned()
                .unwrap_or_else(|| step.action_id.clone());
        }
        if resolution == ImportResolution::Copy {
            automation.id = uuid::Uuid::new_v4().to_string();
        }
        upsert(
            &mut result.automations,
            automation,
            |value| &value.id,
            resolution,
        );
    }

    for trigger in &imported.triggers {
        let exists = result
            .triggers
            .iter()
            .any(|current| current.id == trigger.id);
        let resolution = resolution_for(
            &decision_map,
            ImportObjectKind::Trigger,
            &trigger.id,
            exists,
        );
        if resolution == ImportResolution::Ignore {
            continue;
        }
        let mut trigger = trigger.clone();
        trigger.source_id = source_ids
            .get(&trigger.source_id)
            .cloned()
            .unwrap_or(trigger.source_id);
        if resolution == ImportResolution::Copy {
            trigger.id = uuid::Uuid::new_v4().to_string();
        }
        upsert(&mut result.triggers, trigger, |value| &value.id, resolution);
    }

    let mut history = imported.execution_history.clone();
    for execution in &mut history {
        execution.task_id = task_ids
            .get(&execution.task_id)
            .cloned()
            .unwrap_or_else(|| execution.task_id.clone());
    }
    result.execution_history.extend(history);
    result.logs.extend(imported.logs.clone());
    Ok(result)
}

fn resolution_for(
    decisions: &HashMap<(ImportObjectKind, String), ImportResolution>,
    kind: ImportObjectKind,
    id: &str,
    exists: bool,
) -> ImportResolution {
    if !exists {
        return ImportResolution::Update;
    }
    decisions
        .get(&(kind, id.to_owned()))
        .cloned()
        .unwrap_or(ImportResolution::Ignore)
}

fn upsert<T>(
    values: &mut Vec<T>,
    value: T,
    id: impl Fn(&T) -> &String,
    resolution: ImportResolution,
) {
    if resolution == ImportResolution::Update {
        if let Some(index) = values.iter().position(|current| id(current) == id(&value)) {
            values[index] = value;
            return;
        }
    }
    values.push(value);
}

fn copy_board_ids(
    board: &mut Board,
    column_ids: &mut HashMap<String, String>,
    task_ids: &mut HashMap<String, String>,
) {
    board.id = uuid::Uuid::new_v4().to_string();
    for column in &mut board.columns {
        let old = column.id.clone();
        column.id = uuid::Uuid::new_v4().to_string();
        column_ids.insert(old, column.id.clone());
    }
    for task in &mut board.tasks {
        let old = task.id.clone();
        task.id = uuid::Uuid::new_v4().to_string();
        task_ids.insert(old, task.id.clone());
        task.column_id = column_ids
            .get(&task.column_id)
            .cloned()
            .unwrap_or_else(|| task.column_id.clone());
        for history in &mut task.history {
            history.from_column_id = column_ids
                .get(&history.from_column_id)
                .cloned()
                .unwrap_or_else(|| history.from_column_id.clone());
            history.to_column_id = column_ids
                .get(&history.to_column_id)
                .cloned()
                .unwrap_or_else(|| history.to_column_id.clone());
        }
    }
    for rule in &mut board.allowed_transitions {
        rule.from_column_id = column_ids
            .get(&rule.from_column_id)
            .cloned()
            .unwrap_or_else(|| rule.from_column_id.clone());
        rule.to_column_id = column_ids
            .get(&rule.to_column_id)
            .cloned()
            .unwrap_or_else(|| rule.to_column_id.clone());
    }
}

fn remap_source_columns(source: &mut SourceDefinition, column_ids: &HashMap<String, String>) {
    source.initial_column_id = column_ids
        .get(&source.initial_column_id)
        .cloned()
        .unwrap_or_else(|| source.initial_column_id.clone());
    source.fallback_column_id = source
        .fallback_column_id
        .take()
        .map(|id| column_ids.get(&id).cloned().unwrap_or(id));
    for column_id in source.column_mapping.values_mut() {
        *column_id = column_ids
            .get(column_id)
            .cloned()
            .unwrap_or_else(|| column_id.clone());
    }
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

fn read_optional_json<T: for<'de> Deserialize<'de> + Default>(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Result<T, ExchangeError> {
    match archive.by_name(name) {
        Ok(mut file) => {
            let mut value = String::new();
            file.read_to_string(&mut value)?;
            Ok(serde_json::from_str(&value)?)
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}
