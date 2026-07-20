pub mod automation;
pub mod domain;
pub mod drafts;
pub mod engine;
pub mod exchange;
pub mod logging;
pub mod scheduler;
pub mod secrets;
pub mod service;
pub mod sources;
pub mod storage;

use automation::{
    ActionChain, ActionExecutor, ChainExecution, CommandAction, ExecutionCoordinator,
    ExecutionRecord, SystemActionExecutor, TransitionAutomation,
};
use domain::{
    Board, CustomFieldValue, FieldKind, Task, TransitionOrigin, TransitionRule, WipPolicy,
};
use drafts::{AutomationDraft, CommandPreview};
use exchange::{
    export_bundle as create_export, import_bundle as read_import, preview_conflicts,
    ConflictDecision, ExportBundle, ImportConflict, ImportResult,
};
use scheduler::TriggerDefinition;
use secrets::SecretStore;
use serde::{Deserialize, Serialize};
use sources::{
    inspect_source_controlled, preview, run_source_controlled, FieldMapping, SourceCoordinator,
    SourceDefinition, SourceFormat, SourcePreview, SourceRunRequest, SourceRunResult,
    SystemSourceExecutor,
};
use std::{
    cell::Cell,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};
use storage::{BackupKind, Store};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

struct AppState {
    store: Mutex<Store>,
    source_coordinator: SourceCoordinator,
    execution_coordinator: ExecutionCoordinator,
    pending_imports: Mutex<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupInfo {
    path: String,
    name: String,
    bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionProgress {
    task_id: String,
    step: u32,
    total: u32,
}

struct ProgressExecutor<E> {
    inner: E,
    app: tauri::AppHandle,
    step: Cell<u32>,
    total: u32,
}

impl<E: ActionExecutor> ActionExecutor for ProgressExecutor<E> {
    fn execute(&self, action: &CommandAction, task: &Task) -> automation::StepExecution {
        let step = self.step.get();
        let _ = self.app.emit(
            "execution-progress",
            ExecutionProgress {
                task_id: task.id.clone(),
                step,
                total: self.total,
            },
        );
        let result = self.inner.execute(action, task);
        self.step.set(step.saturating_add(1));
        result
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportSelection {
    board_ids: Vec<String>,
    include_actions: bool,
    include_sources: bool,
    include_triggers: bool,
}

fn locked_store<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Store>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Base de données indisponible".to_owned())
}

fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn notification_enabled(store: &Store, key: &str, default: bool) -> bool {
    store
        .get_setting(key)
        .ok()
        .flatten()
        .map(|value| value == "true")
        .unwrap_or(default)
}

fn prune_execution_logs(store: &Store, logs: &logging::LogStore) {
    let retention_days = store
        .get_setting("logs.retention_days")
        .ok()
        .flatten()
        .and_then(|value| value.parse().ok())
        .unwrap_or(30);
    let max_megabytes: u64 = store
        .get_setting("logs.max_megabytes")
        .ok()
        .flatten()
        .and_then(|value| value.parse().ok())
        .unwrap_or(100);
    let _ = logs.prune(retention_days, max_megabytes.saturating_mul(1024 * 1024));
}

fn automation_notification_enabled(
    store: &Store,
    board_id: &str,
    automation_ids: &[String],
    event: &str,
    global_default: bool,
) -> bool {
    let overrides: Vec<bool> = store
        .list_transition_automations(board_id)
        .unwrap_or_default()
        .into_iter()
        .filter(|automation| automation_ids.contains(&automation.id))
        .filter_map(|automation| match event {
            "success" => automation.notifications.success,
            "failure" => automation.notifications.failure,
            "confirmation" => automation.notifications.confirmation,
            "source_blocked" => automation.notifications.source_blocked,
            _ => None,
        })
        .collect();
    if overrides.is_empty() {
        global_default
    } else {
        overrides.into_iter().any(|enabled| enabled)
    }
}

fn matching_transition_automation_ids(
    store: &Store,
    board_id: &str,
    task_id: &str,
    target_column_id: &str,
    origin: &TransitionOrigin,
) -> Vec<String> {
    let Ok(Some(board)) = store.get_board(board_id) else {
        return Vec::new();
    };
    let Some(task) = board.tasks.iter().find(|task| task.id == task_id) else {
        return Vec::new();
    };
    store
        .list_transition_automations(board_id)
        .unwrap_or_default()
        .into_iter()
        .filter(|automation| {
            automation.enabled
                && automation.to_column_id == target_column_id
                && automation
                    .from_column_id
                    .as_deref()
                    .is_none_or(|from| from == task.column_id)
                && automation.origins.contains(origin)
        })
        .map(|automation| automation.id)
        .collect()
}

#[tauri::command]
fn list_boards(state: State<'_, AppState>) -> Result<Vec<Board>, String> {
    locked_store(&state)?
        .list_boards()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_board(board: Board, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .save_board(&board)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_board(name: String, state: State<'_, AppState>) -> Result<Board, String> {
    if name.trim().is_empty() {
        return Err("Le nom du kanban est obligatoire".into());
    }
    let board = Board::starter(name.trim());
    locked_store(&state)?
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn add_task(
    board_id: String,
    column_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .add_task(title, &column_id)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn add_column(
    board_id: String,
    name: String,
    wip_policy: WipPolicy,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board.add_column(name, wip_policy);
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn configure_column(
    board_id: String,
    column_id: String,
    name: String,
    color: String,
    wip_policy: WipPolicy,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .configure_column(&column_id, name, color, wip_policy)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn reorder_column(
    board_id: String,
    column_id: String,
    position: usize,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .reorder_column(&column_id, position)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn reorder_task(
    board_id: String,
    task_id: String,
    position: usize,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .reorder_task(&task_id, position)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn delete_column(
    board_id: String,
    column_id: String,
    destination_id: String,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    let mut automations = store
        .list_transition_automations(&board_id)
        .map_err(|error| error.to_string())?;
    engine::delete_column(&mut board, &mut automations, &column_id, &destination_id)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    for automation in automations {
        store
            .save_transition_automation(&automation)
            .map_err(|error| error.to_string())?;
    }
    Ok(board)
}

#[tauri::command]
fn set_transition_rules(
    board_id: String,
    restricted: bool,
    rules: Vec<TransitionRule>,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .set_transition_rules(restricted, rules)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn add_custom_field(
    board_id: String,
    name: String,
    kind: FieldKind,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .add_custom_field(name, kind, pinned)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn set_custom_value(
    board_id: String,
    task_id: String,
    field_id: String,
    value: CustomFieldValue,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .set_custom_value(&task_id, &field_id, value)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn update_task(board_id: String, task: Task, state: State<'_, AppState>) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board.update_task(task).map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn archive_task(
    board_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .archive_task(&task_id)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn restore_task(
    board_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .restore_task(&task_id)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn permanently_delete_task(
    board_id: String,
    task_id: String,
    confirmed: bool,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    if !confirmed {
        return Err("Une confirmation est obligatoire".into());
    }
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .permanently_delete_task(&task_id)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn move_task(
    board_id: String,
    task_id: String,
    column_id: String,
    origin: TransitionOrigin,
    confirmed: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let execution = state
        .execution_coordinator
        .start(&task_id)
        .map_err(str::to_owned)?;
    let store = locked_store(&state)?;
    let notification_automation_ids =
        matching_transition_automation_ids(&store, &board_id, &task_id, &column_id, &origin);
    let matching_automations = store
        .list_transition_automations(&board_id)
        .unwrap_or_default()
        .into_iter()
        .filter(|automation| notification_automation_ids.contains(&automation.id))
        .collect::<Vec<_>>();
    let task = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .and_then(|board| board.tasks.into_iter().find(|task| task.id == task_id))
        .ok_or_else(|| "Tâche introuvable".to_owned())?;
    let total_steps = engine::executable_step_count(
        &matching_automations,
        &store.list_actions().unwrap_or_default(),
        &task,
        &origin,
    )
    .map_err(|error| error.to_string())?;
    let executor = ProgressExecutor {
        inner: execution.executor(),
        app: app.clone(),
        step: Cell::new(1),
        total: total_steps.max(1),
    };
    let result = service::execute_transition(
        &store,
        &executor,
        &board_id,
        engine::TransitionRequest {
            task_id,
            target_column_id: column_id,
            origin,
            confirmed: confirmed.unwrap_or(false),
        },
    );
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let global_confirmation =
                notification_enabled(&store, "notifications.confirmation", true);
            if error.to_string().contains("confirmation")
                && automation_notification_enabled(
                    &store,
                    &board_id,
                    &notification_automation_ids,
                    "confirmation",
                    global_confirmation,
                )
            {
                notify(&app, "Confirmation requise", &error.to_string());
            }
            return Err(error.to_string());
        }
    };
    if let Some(execution) = result.execution {
        let global_failure = notification_enabled(&store, "notifications.failure", true);
        let global_success = notification_enabled(&store, "notifications.success", false);
        if execution.status != automation::ChainStatus::Succeeded
            && automation_notification_enabled(
                &store,
                &board_id,
                &result.automation_ids,
                "failure",
                global_failure,
            )
        {
            notify(
                &app,
                "Automatisation en échec",
                "Une chaîne d’actions nécessite votre attention.",
            );
        } else if execution.status == automation::ChainStatus::Succeeded
            && automation_notification_enabled(
                &store,
                &board_id,
                &result.automation_ids,
                "success",
                global_success,
            )
        {
            notify(
                &app,
                "Automatisation terminée",
                "La chaîne d’actions a réussi.",
            );
        }
        let logs = logging::LogStore::open(
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("logs"),
        )
        .map_err(|error| error.to_string())?;
        logs.write(&execution.id, &execution.steps, Vec::<String>::new())
            .map_err(|error| error.to_string())?;
        prune_execution_logs(&store, &logs);
    }
    store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())
}

#[tauri::command]
fn cancel_task_execution(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if state.execution_coordinator.cancel(&task_id) {
        Ok(())
    } else {
        Err("Aucune exécution active pour cette tâche".into())
    }
}

#[tauri::command]
fn resume_execution(
    board_id: String,
    execution_id: String,
    restart_all: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ChainExecution, String> {
    let store = locked_store(&state)?;
    let record = store
        .get_execution(&execution_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Exécution introuvable".to_owned())?;
    let active = state
        .execution_coordinator
        .start(&record.task_id)
        .map_err(str::to_owned)?;
    let execution = service::resume_execution(
        &store,
        &active.executor(),
        &board_id,
        &execution_id,
        restart_all,
    )
    .map_err(|error| error.to_string())?;
    if let Some(record) = store
        .get_execution(&execution_id)
        .map_err(|error| error.to_string())?
    {
        let logs = logging::LogStore::open(
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("logs"),
        )
        .map_err(|error| error.to_string())?;
        logs.write(&execution_id, &record.steps, Vec::<String>::new())
            .map_err(|error| error.to_string())?;
        prune_execution_logs(&store, &logs);
    }
    Ok(execution)
}

#[tauri::command]
fn abandon_execution(
    board_id: String,
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = locked_store(&state)?;
    service::abandon_execution(&store, &board_id, &execution_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_source(
    format: SourceFormat,
    input: String,
    mapping: FieldMapping,
    text_pattern: Option<String>,
) -> SourcePreview {
    preview(format, &input, &mapping, text_pattern.as_deref())
}

#[tauri::command]
fn list_actions(state: State<'_, AppState>) -> Result<Vec<CommandAction>, String> {
    locked_store(&state)?
        .list_actions()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_action(action: CommandAction, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .save_action(&action)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_automations(
    board_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TransitionAutomation>, String> {
    locked_store(&state)?
        .list_transition_automations(&board_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_automation(
    automation: TransitionAutomation,
    state: State<'_, AppState>,
) -> Result<(), String> {
    locked_store(&state)?
        .save_transition_automation(&automation)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_automation_draft(draft: AutomationDraft, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .save_automation_draft(&draft)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_automation_drafts(
    board_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AutomationDraft>, String> {
    locked_store(&state)?
        .list_automation_drafts(&board_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_automation_draft(
    automation_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CommandPreview>, String> {
    let store = locked_store(&state)?;
    let draft = store
        .get_automation_draft(&automation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Brouillon introuvable".to_owned())?;
    draft
        .preview(&store.list_actions().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn test_automation_draft(
    automation_id: String,
    task_id: String,
    confirmed: bool,
    state: State<'_, AppState>,
) -> Result<ChainExecution, String> {
    let store = locked_store(&state)?;
    let mut draft = store
        .get_automation_draft(&automation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Brouillon introuvable".to_owned())?;
    let board = store
        .get_board(&draft.board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    let task = board
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| "Tâche exemple introuvable".to_owned())?;
    let execution = draft
        .execute_test(
            &store.list_actions().map_err(|error| error.to_string())?,
            task,
            confirmed,
            &SystemActionExecutor,
        )
        .map_err(|error| error.to_string())?;
    store
        .save_automation_draft(&draft)
        .map_err(|error| error.to_string())?;
    Ok(execution)
}

#[tauri::command]
fn activate_automation_draft(
    automation_id: String,
    state: State<'_, AppState>,
) -> Result<TransitionAutomation, String> {
    let store = locked_store(&state)?;
    let mut draft = store
        .get_automation_draft(&automation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Brouillon introuvable".to_owned())?;
    let active = draft.activate().map_err(|error| error.to_string())?;
    store
        .save_transition_automation(&active)
        .map_err(|error| error.to_string())?;
    store
        .save_automation_draft(&draft)
        .map_err(|error| error.to_string())?;
    Ok(active)
}

#[tauri::command]
fn list_sources(
    board_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SourceDefinition>, String> {
    locked_store(&state)?
        .list_sources(&board_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_all_sources(state: State<'_, AppState>) -> Result<Vec<SourceDefinition>, String> {
    locked_store(&state)?
        .list_all_sources()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_source(source: SourceDefinition, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .save_source(&source)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_source(source_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let store = locked_store(&state)?;
    for mut board in store.list_boards().map_err(|error| error.to_string())? {
        let previous_len = board.source_ids.len();
        board.source_ids.retain(|id| id != &source_id);
        if board.source_ids.len() != previous_len {
            store
                .save_board(&board)
                .map_err(|error| error.to_string())?;
        }
    }
    store
        .delete_source(&source_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn run_source_now(
    source_id: String,
    force_import: bool,
    allow_truncated: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SourceRunResult, String> {
    let active = state
        .source_coordinator
        .start(&source_id)
        .map_err(|error| error.to_string())?;
    let store = locked_store(&state)?;
    let source = store
        .get_source(&source_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Source introuvable".to_owned())?;
    let mut board = store
        .get_board(&source.board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    let mut execution_source = source.clone();
    execution_source.move_existing_tasks = false;
    let result = run_source_controlled(
        &mut board,
        &execution_source,
        &SystemSourceExecutor,
        SourceRunRequest {
            force_import,
            allow_truncated,
        },
        active.cancellation(),
    );
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            if notification_enabled(&store, "notifications.source_blocked", true) {
                notify(&app, "Source bloquée", &error.to_string());
            }
            return Err(error.to_string());
        }
    };
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    let mut result = result;
    let pending_moves =
        service::execute_source_moves(&store, &SystemActionExecutor, &source, &result.preview)
            .map_err(|error| error.to_string())?;
    let mut summary = result.import.take().unwrap_or(sources::ImportSummary {
        created: 0,
        updated: 0,
        pending_moves: 0,
    });
    summary.pending_moves = pending_moves;
    if pending_moves > 0 {
        result.preview.warnings.push(format!(
            "{} déplacement(s) restent en attente (WIP, confirmation ou action)",
            pending_moves
        ));
    }
    result.import = Some(summary);
    Ok(result)
}

#[tauri::command]
fn cancel_source_execution(source_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if state.source_coordinator.cancel(&source_id) {
        Ok(())
    } else {
        Err("Aucune exécution active pour cette source".into())
    }
}

#[tauri::command]
fn inspect_source_now(
    source_id: String,
    state: State<'_, AppState>,
) -> Result<SourceRunResult, String> {
    let active = state
        .source_coordinator
        .start(&source_id)
        .map_err(|error| error.to_string())?;
    let store = locked_store(&state)?;
    let source = store
        .get_source(&source_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Source introuvable".to_owned())?;
    inspect_source_controlled(&source, &SystemSourceExecutor, active.cancellation())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_source_result(
    source_id: String,
    preview: SourcePreview,
    confirmed: bool,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    if !confirmed {
        return Err("Une confirmation est obligatoire pour importer cette sortie".into());
    }
    let store = locked_store(&state)?;
    let source = store
        .get_source(&source_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Source introuvable".to_owned())?;
    service::apply_source_with_transitions(&store, &SystemActionExecutor, &source, &preview)
        .map_err(|error| error.to_string())?;
    store
        .get_board(&source.board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())
}

#[tauri::command]
fn list_triggers(
    source_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TriggerDefinition>, String> {
    locked_store(&state)?
        .list_triggers(&source_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_trigger(trigger: TriggerDefinition, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .save_trigger(&trigger)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_executions(state: State<'_, AppState>) -> Result<Vec<ExecutionRecord>, String> {
    locked_store(&state)?
        .list_executions()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_secret(name: String, value: String) -> Result<(), String> {
    secrets::OsSecretStore
        .set(&name, &value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_secret(name: String) -> Result<(), String> {
    secrets::OsSecretStore
        .delete(&name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_setting(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .set_setting(&key, &value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_setting(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    locked_store(&state)?
        .get_setting(&key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_scheduler_journal(
    state: State<'_, AppState>,
) -> Result<Vec<service::SchedulerJournalEntry>, String> {
    let store = locked_store(&state)?;
    service::list_scheduler_journal(&store).map_err(|error| error.to_string())
}

#[tauri::command]
fn take_pending_imports(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut pending = state
        .pending_imports
        .lock()
        .map_err(|_| "File d’import indisponible".to_owned())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn run_action_chain(
    task: domain::Task,
    actions: Vec<CommandAction>,
    start_at: Option<usize>,
) -> ChainExecution {
    ActionChain::new(actions).run(&task, start_at.unwrap_or(0))
}

#[tauri::command]
fn export_bundle(bundle: ExportBundle) -> Result<Vec<u8>, String> {
    create_export(&bundle).map_err(|error| error.to_string())
}

#[tauri::command]
fn import_bundle(bytes: Vec<u8>) -> Result<ImportResult, String> {
    read_import(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_import_file(path: String) -> Result<ImportResult, String> {
    if !path.to_ascii_lowercase().ends_with(".workonit") {
        return Err("Le fichier doit porter l’extension .workonit".into());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    read_import(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_import_conflicts(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<ImportConflict>, String> {
    let imported = preview_import_file(path)?;
    let store = locked_store(&state)?;
    let existing = service::export_all(&store).map_err(|error| error.to_string())?;
    Ok(preview_conflicts(&imported.bundle, &existing))
}

#[tauri::command]
fn apply_import_file(
    path: String,
    decisions: Vec<ConflictDecision>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportBundle, String> {
    let imported = preview_import_file(path)?;
    let store = locked_store(&state)?;
    let merged = service::apply_import_to_store(
        &store,
        &backup_directory(&app)?,
        &imported.bundle,
        &decisions,
    )
    .map_err(|error| error.to_string())?;
    persist_imported_logs(&app, &imported.bundle.logs)?;
    Ok(merged)
}

#[tauri::command]
fn trust_imported_commands(
    action_ids: Vec<String>,
    source_ids: Vec<String>,
    confirmed: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !confirmed {
        return Err("La confiance explicite est obligatoire".into());
    }
    let store = locked_store(&state)?;
    for mut action in store.list_actions().map_err(|error| error.to_string())? {
        if action_ids.contains(&action.id) {
            action.enabled = true;
            store
                .save_action(&action)
                .map_err(|error| error.to_string())?;
        }
    }
    for mut source in store
        .list_all_sources()
        .map_err(|error| error.to_string())?
    {
        if source_ids.contains(&source.id) {
            source.enabled = true;
            source.command.enabled = true;
            store
                .save_source(&source)
                .map_err(|error| error.to_string())?;
        }
    }
    for board in store.list_boards().map_err(|error| error.to_string())? {
        for mut automation in store
            .list_transition_automations(&board.id)
            .map_err(|error| error.to_string())?
        {
            if automation
                .steps
                .iter()
                .all(|step| action_ids.contains(&step.action_id))
            {
                automation.enabled = true;
                store
                    .save_transition_automation(&automation)
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    for mut trigger in store
        .list_all_triggers()
        .map_err(|error| error.to_string())?
    {
        if source_ids.contains(&trigger.source_id) {
            trigger.enabled = true;
            store
                .save_trigger(&trigger)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn write_export_file(
    path: String,
    include_history: bool,
    selection: ExportSelection,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = if path.to_ascii_lowercase().ends_with(".workonit") {
        path
    } else {
        format!("{path}.workonit")
    };
    let store = locked_store(&state)?;
    let mut bundle = service::export_selected(
        &store,
        &selection.board_ids,
        selection.include_actions,
        selection.include_sources,
        selection.include_triggers,
    )
    .map_err(|error| error.to_string())?;
    if include_history {
        bundle.logs = logging::LogStore::open(
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("logs"),
        )
        .and_then(|logs| logs.export())
        .map_err(|error| error.to_string())?;
        let execution_ids: std::collections::HashSet<String> = bundle
            .execution_history
            .iter()
            .map(|execution| execution.id.clone())
            .collect();
        bundle
            .logs
            .retain(|log| execution_ids.contains(&log.execution_id));
    } else {
        bundle.execution_history.clear();
        bundle.logs.clear();
    }
    let bytes = create_export(&bundle).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_all_bundle(
    include_history: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let store = locked_store(&state)?;
    let mut bundle = service::export_all(&store).map_err(|error| error.to_string())?;
    if include_history {
        bundle.logs = logging::LogStore::open(
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("logs"),
        )
        .and_then(|logs| logs.export())
        .map_err(|error| error.to_string())?;
    } else {
        bundle.execution_history.clear();
        bundle.logs.clear();
    }
    create_export(&bundle).map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_import_bundle(
    bytes: Vec<u8>,
    decisions: Vec<ConflictDecision>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportBundle, String> {
    let imported = read_import(&bytes).map_err(|error| error.to_string())?;
    let backup_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("backups");
    let store = locked_store(&state)?;
    let merged =
        service::apply_import_to_store(&store, &backup_directory, &imported.bundle, &decisions)
            .map_err(|error| error.to_string())?;
    persist_imported_logs(&app, &imported.bundle.logs)?;
    Ok(merged)
}

fn persist_imported_logs(
    app: &tauri::AppHandle,
    logs: &[exchange::ExportLog],
) -> Result<(), String> {
    let store = logging::LogStore::open(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("logs"),
    )
    .map_err(|error| error.to_string())?;
    for log in logs {
        store.import(log).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn backup_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("backups"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let directory = backup_directory(&app)?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut backups = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("sqlite") {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        backups.push(BackupInfo {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            bytes: metadata.len(),
        });
    }
    backups.sort_by(|left, right| right.name.cmp(&left.name));
    Ok(backups)
}

#[tauri::command]
fn create_backup(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<BackupInfo, String> {
    let path = locked_store(&state)?
        .create_backup(backup_directory(&app)?, BackupKind::Daily)
        .map_err(|error| error.to_string())?;
    let bytes = std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    Ok(BackupInfo {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        bytes,
    })
}

#[tauri::command]
fn restore_backup(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Board>, String> {
    let requested = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    let directory =
        std::fs::canonicalize(backup_directory(&app)?).map_err(|error| error.to_string())?;
    if !requested.starts_with(directory) {
        return Err("Sauvegarde hors du dossier WorkOnIt refusée".into());
    }
    let mut store = locked_store(&state)?;
    store
        .restore_backup(&requested)
        .map_err(|error| error.to_string())?;
    store.list_boards().map_err(|error| error.to_string())
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    Ok(directory.join("workonit.db"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let autostart = tauri_plugin_autostart::Builder::new().app_name("WorkOnIt");
    #[cfg(target_os = "macos")]
    let autostart = autostart.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(autostart.build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let files: Vec<String> = args
                .into_iter()
                .filter(|argument| argument.ends_with(".workonit"))
                .collect();
            if !files.is_empty() {
                if let Ok(mut pending) = app.state::<AppState>().pending_imports.lock() {
                    pending.extend(files.clone());
                }
                let _ = app.emit("import-file-requested", files);
            }
        }))
        .setup(|app| {
            let store = Store::open(database_path(app.handle())?)?;
            store.recover_interrupted_executions()?;
            let pending_imports = std::env::args()
                .filter(|argument| argument.ends_with(".workonit"))
                .collect();
            app.manage(AppState {
                store: Mutex::new(store),
                source_coordinator: SourceCoordinator::default(),
                execution_coordinator: ExecutionCoordinator::default(),
                pending_imports: Mutex::new(pending_imports),
            });
            start_scheduler(app.handle().clone());
            let show = MenuItem::with_id(app, "show", "Afficher WorkOnIt", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter WorkOnIt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_boards,
            save_board,
            create_board,
            add_task,
            add_column,
            configure_column,
            reorder_column,
            reorder_task,
            delete_column,
            set_transition_rules,
            add_custom_field,
            set_custom_value,
            update_task,
            archive_task,
            restore_task,
            permanently_delete_task,
            move_task,
            cancel_task_execution,
            resume_execution,
            abandon_execution,
            preview_source,
            list_actions,
            save_action,
            list_automations,
            save_automation,
            save_automation_draft,
            list_automation_drafts,
            preview_automation_draft,
            test_automation_draft,
            activate_automation_draft,
            list_sources,
            list_all_sources,
            save_source,
            delete_source,
            run_source_now,
            cancel_source_execution,
            inspect_source_now,
            apply_source_result,
            list_triggers,
            save_trigger,
            list_executions,
            set_secret,
            delete_secret,
            set_setting,
            get_setting,
            list_scheduler_journal,
            take_pending_imports,
            run_action_chain,
            export_bundle,
            import_bundle,
            preview_import_file,
            preview_import_conflicts,
            apply_import_file,
            trust_imported_commands,
            write_export_file,
            export_all_bundle,
            apply_import_bundle,
            list_backups,
            create_backup,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WorkOnIt");
}

fn start_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_tick = std::time::Instant::now();
        let mut first_tick = true;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let resumed_or_started =
                first_tick || last_tick.elapsed() > std::time::Duration::from_secs(5);
            first_tick = false;
            last_tick = std::time::Instant::now();
            let state = app.state::<AppState>();
            let Ok(store) = state.store.lock() else {
                continue;
            };
            if let Ok(directory) = app.path().app_data_dir() {
                let _ = service::maintain_backups(
                    &store,
                    &directory.join("backups"),
                    chrono::Utc::now(),
                );
            }
            if let Err(error) = service::run_scheduler_tick(
                &store,
                &state.source_coordinator,
                &SystemSourceExecutor,
                chrono::Utc::now(),
                resumed_or_started,
            ) {
                eprintln!("scheduler: {error}");
            }
        }
    });
}
