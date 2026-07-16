use chrono::{TimeZone, Utc};
use tempfile::tempdir;
use workonit_lib::{
    automation::{ActionStep, CommandAction, ExecutionRecord, TransitionAutomation},
    domain::{Board, WipPolicy},
    exchange::{ExportBundle, ExportLog},
    scheduler::TriggerDefinition,
    service::{apply_import_to_store, export_selected, maintain_backups},
    sources::{FieldMapping, SourceDefinition, SourceFormat},
    storage::Store,
};

fn bundle(board: Board) -> ExportBundle {
    ExportBundle {
        boards: vec![board],
        actions: vec![],
        automations: vec![],
        sources: vec![],
        triggers: vec![],
        execution_history: vec![],
        logs: vec![],
    }
}

#[test]
fn selective_export_keeps_only_actions_referenced_by_selected_boards() {
    let store = Store::in_memory().unwrap();
    let selected = Board::starter("Selected");
    let unrelated = Board::starter("Unrelated");
    store.save_board(&selected).unwrap();
    store.save_board(&unrelated).unwrap();
    let selected_action = CommandAction::shell("Selected action", "selected");
    let unrelated_action = CommandAction::shell("Unrelated action", "unrelated");
    store.save_action(&selected_action).unwrap();
    store.save_action(&unrelated_action).unwrap();
    store
        .save_transition_automation(&TransitionAutomation::new(
            &selected.id,
            None,
            &selected.columns[1].id,
            vec![ActionStep::new(&selected_action.id)],
        ))
        .unwrap();
    store
        .save_transition_automation(&TransitionAutomation::new(
            &unrelated.id,
            None,
            &unrelated.columns[1].id,
            vec![ActionStep::new(&unrelated_action.id)],
        ))
        .unwrap();

    let exported = export_selected(
        &store,
        std::slice::from_ref(&selected.id),
        true,
        false,
        false,
    )
    .unwrap();

    assert_eq!(exported.boards.len(), 1);
    assert_eq!(exported.actions.len(), 1);
    assert_eq!(exported.actions[0].id, selected_action.id);
}

#[test]
fn import_service_persists_every_portable_object_and_history() {
    let directory = tempdir().unwrap();
    let store = Store::open(directory.path().join("db.sqlite")).unwrap();
    let board = Board::starter("Imported");
    let action = CommandAction::shell("Action", "run");
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[1].id,
        vec![ActionStep::new(&action.id)],
    );
    let source = SourceDefinition::new(
        &board.id,
        "Source",
        "collect",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: None,
            column: None,
        },
        &board.columns[0].id,
    );
    let trigger = TriggerDefinition::manual(&source.id);
    let execution = ExecutionRecord::running("task", vec![automation.id.clone()], 1);
    let imported = ExportBundle {
        boards: vec![board.clone()],
        actions: vec![action],
        automations: vec![automation],
        sources: vec![source.clone()],
        triggers: vec![trigger],
        execution_history: vec![execution],
        logs: vec![ExportLog {
            execution_id: "log".into(),
            stdout: "out".into(),
            stderr: "err".into(),
        }],
    };
    let merged =
        apply_import_to_store(&store, &directory.path().join("backups"), &imported, &[]).unwrap();
    assert_eq!(merged.logs.len(), 1);
    assert_eq!(store.list_actions().unwrap().len(), 1);
    assert_eq!(
        store.list_transition_automations(&board.id).unwrap().len(),
        1
    );
    assert_eq!(store.list_sources(&board.id).unwrap().len(), 1);
    assert_eq!(store.list_triggers(&source.id).unwrap().len(), 1);
    assert_eq!(store.list_executions().unwrap().len(), 1);
}

#[test]
fn scheduled_backup_is_idempotent_per_day_and_import_snapshots_before_write() {
    let directory = tempdir().unwrap();
    let database = directory.path().join("workonit.sqlite");
    let backups = directory.path().join("backups");
    let store = Store::open(&database).unwrap();
    let mut current = Board::new("Current");
    current.add_column("A", WipPolicy::None);
    store.save_board(&current).unwrap();
    let monday = Utc.with_ymd_and_hms(2026, 7, 13, 8, 0, 0).unwrap();

    let first = maintain_backups(&store, &backups, monday).unwrap();
    let second = maintain_backups(&store, &backups, monday).unwrap();

    assert_eq!(first.len(), 2);
    assert!(second.is_empty());
    let mut imported = Board::new("Imported");
    imported.add_column("B", WipPolicy::None);
    apply_import_to_store(&store, &backups, &bundle(imported), &[]).unwrap();
    assert_eq!(store.list_boards().unwrap().len(), 2);
    assert!(std::fs::read_dir(&backups)
        .unwrap()
        .flatten()
        .any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with("pre-import-")));
}
