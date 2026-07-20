use tempfile::tempdir;
use workonit_lib::{
    automation::{ActionStep, CommandAction, ExecutionRecord, TransitionAutomation},
    domain::{Board, ExecutionStatus, FieldKind, WipPolicy},
    drafts::AutomationDraft,
    scheduler::{ScheduleSpec, TriggerDefinition},
    sources::{FieldMapping, SourceDefinition, SourceFormat},
    storage::{BackupKind, StorageError, Store},
};

#[test]
fn saved_board_survives_store_reopen() {
    let directory = tempdir().expect("temporary directory");
    let database = directory.path().join("workonit.db");
    let board_id;

    {
        let store = Store::open(&database).expect("store opens");
        let mut board = Board::new("Produit");
        let inbox = board.add_column("Entrée", WipPolicy::None);
        board.add_task("Qualifier", &inbox).expect("task created");
        board_id = board.id.clone();
        store.save_board(&board).expect("board saved");
    }

    let reopened = Store::open(&database).expect("store reopens");
    let loaded = reopened
        .get_board(&board_id)
        .expect("board query succeeds")
        .expect("board exists");

    assert_eq!(loaded.name, "Produit");
    assert_eq!(loaded.tasks[0].title, "Qualifier");
}

#[test]
fn storage_crud_round_trips_every_record_kind_and_status() {
    let store = Store::in_memory().unwrap();
    assert!(store.get_board("missing").unwrap().is_none());
    let mut board = Board::starter("Everything");
    let task_id = board
        .add_task("Imported", &board.columns[0].id.clone())
        .unwrap();
    board.tasks[0].source_id = Some("source-stable-id".into());
    board
        .add_custom_field("Field", FieldKind::Text, false)
        .unwrap();
    board.allow_transition(&board.columns[0].id.clone(), &board.columns[1].id.clone());
    store.save_board(&board).unwrap();
    assert_eq!(store.list_boards().unwrap().len(), 1);
    assert_eq!(
        store
            .get_board(&board.id)
            .unwrap()
            .unwrap()
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .and_then(|task| task.source_id.as_deref()),
        Some("source-stable-id")
    );
    store.set_setting("theme", "dark").unwrap();
    store.set_setting("theme", "light").unwrap();
    assert_eq!(
        store.get_setting("theme").unwrap().as_deref(),
        Some("light")
    );
    assert_eq!(store.get_setting("missing").unwrap(), None);

    let action = CommandAction::shell("Action", "run");
    store.save_action(&action).unwrap();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[1].id,
        vec![ActionStep::new(&action.id)],
    );
    store.save_transition_automation(&automation).unwrap();
    let draft = AutomationDraft::new(automation.clone());
    store.save_automation_draft(&draft).unwrap();
    assert_eq!(
        store
            .get_automation_draft(&draft.automation_id)
            .unwrap()
            .unwrap()
            .automation_id,
        draft.automation_id
    );
    assert!(store.get_automation_draft("missing").unwrap().is_none());
    assert_eq!(store.list_automation_drafts(&board.id).unwrap().len(), 1);

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
    store.save_source(&source).unwrap();
    assert_eq!(
        store.get_source(&source.id).unwrap().unwrap().name,
        "Source"
    );
    assert!(store.get_source("missing").unwrap().is_none());
    let trigger = TriggerDefinition::manual(&source.id);
    store.save_trigger(&trigger).unwrap();
    assert_eq!(store.list_all_triggers().unwrap().len(), 1);

    for status in [
        ExecutionStatus::Idle,
        ExecutionStatus::Pending,
        ExecutionStatus::Running { step: 1, total: 1 },
        ExecutionStatus::Failed,
        ExecutionStatus::Succeeded,
        ExecutionStatus::Cancelled,
        ExecutionStatus::Interrupted,
    ] {
        let mut execution = ExecutionRecord::running("task", vec![automation.id.clone()], 1);
        execution.status = status;
        store.save_execution(&execution).unwrap();
        assert_eq!(
            store.get_execution(&execution.id).unwrap().unwrap().id,
            execution.id
        );
    }
    assert!(store.get_execution("missing").unwrap().is_none());
    assert!(store.delete_board(&board.id).unwrap());
    assert!(!store.delete_board(&board.id).unwrap());
}

#[test]
fn opening_legacy_and_future_databases_migrates_with_snapshot_or_rejects() {
    let directory = tempdir().unwrap();
    let legacy_path = directory.path().join("legacy-v1.sqlite");
    let connection = rusqlite::Connection::open(&legacy_path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE automations (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE executions (id TEXT PRIMARY KEY, task_id TEXT, automation_id TEXT, status TEXT NOT NULL, stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT);
             PRAGMA user_version = 1;",
        )
        .unwrap();
    drop(connection);
    let migrated = Store::open(&legacy_path).unwrap();
    assert!(migrated.list_boards().unwrap().is_empty());
    assert!(directory
        .path()
        .join("backups")
        .read_dir()
        .unwrap()
        .flatten()
        .any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with("pre-migration-")));

    let future_path = directory.path().join("future.sqlite");
    let connection = rusqlite::Connection::open(&future_path).unwrap();
    connection.pragma_update(None, "user_version", 99).unwrap();
    drop(connection);
    assert!(matches!(
        Store::open(future_path),
        Err(StorageError::UnsupportedSchema(99))
    ));
}

#[test]
fn version_six_migration_adds_and_backfills_stable_source_ids() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("legacy-v6.sqlite");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE tasks (board_id TEXT NOT NULL, source_name TEXT);
             CREATE TABLE board_settings (board_id TEXT PRIMARY KEY, transitions_restricted INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE sources (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT '');
             INSERT INTO board_settings (board_id) VALUES ('board');
             INSERT INTO tasks (board_id, source_name) VALUES ('board', 'Renamable feed');
             INSERT INTO sources (id, board_id, name) VALUES ('stable-source', 'board', 'Renamable feed');
             PRAGMA user_version = 6;",
        )
        .unwrap();
    drop(connection);

    drop(Store::open(&path).unwrap());

    let connection = rusqlite::Connection::open(&path).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let source_id: Option<String> = connection
        .query_row("SELECT source_id FROM tasks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 8);
    assert_eq!(source_id.as_deref(), Some("stable-source"));
}

#[test]
fn version_two_legacy_board_json_is_normalized_during_migration() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("legacy-v2.sqlite");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE automations (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE executions (id TEXT PRIMARY KEY, task_id TEXT, automation_id TEXT, status TEXT NOT NULL, stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT, data TEXT);
             CREATE TABLE actions (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE transition_automations (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
             PRAGMA user_version = 2;",
        )
        .unwrap();
    let board = Board::starter("Legacy JSON");
    connection
        .execute(
            "INSERT INTO boards (id, name, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![board.id, board.name, serde_json::to_string(&board).unwrap(), board.created_at.to_rfc3339(), board.updated_at.to_rfc3339()],
        )
        .unwrap();
    let board_id = board.id.clone();
    drop(connection);

    let migrated = Store::open(path).unwrap();
    assert_eq!(
        migrated
            .get_board(&board_id)
            .unwrap()
            .unwrap()
            .columns
            .len(),
        3
    );
}

#[test]
fn every_backup_kind_uses_a_distinct_prefix() {
    let store = Store::in_memory().unwrap();
    let directory = tempdir().unwrap();
    for (kind, prefix) in [
        (BackupKind::Daily, "daily-"),
        (BackupKind::Weekly, "weekly-"),
        (BackupKind::PreMigration, "pre-migration-"),
    ] {
        let path = store.create_backup(directory.path(), kind).unwrap();
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(prefix));
    }
}

#[test]
fn backup_restore_recovers_previous_database_state() {
    let directory = tempdir().unwrap();
    let database = directory.path().join("workonit.db");
    let backups = directory.path().join("backups");
    let mut store = Store::open(&database).unwrap();
    let board = Board::starter("Sauvegardé");
    store.save_board(&board).unwrap();
    let snapshot = store
        .create_backup(&backups, BackupKind::PreImport)
        .unwrap();
    store.delete_board(&board.id).unwrap();
    assert!(store.get_board(&board.id).unwrap().is_none());

    store.restore_backup(&snapshot).unwrap();

    assert_eq!(
        store.get_board(&board.id).unwrap().unwrap().name,
        "Sauvegardé"
    );
}

#[test]
fn automation_library_and_running_execution_survive_and_recover() {
    let directory = tempdir().expect("temporary directory");
    let database = directory.path().join("workonit.db");
    let store = Store::open(&database).expect("store opens");
    let mut board = Board::starter("Ops");
    store.save_board(&board).unwrap();
    let action = CommandAction::shell("Déployer", "deploy");
    store.save_action(&action).unwrap();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[2].id,
        vec![ActionStep::new(&action.id)],
    );
    store.save_transition_automation(&automation).unwrap();
    let source = SourceDefinition::new(
        &board.id,
        "Collecte",
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
    store.save_source(&source).unwrap();
    board.source_ids.push(source.id.clone());
    store.save_board(&board).unwrap();
    let trigger = TriggerDefinition::scheduled(&source.id, ScheduleSpec::Interval { seconds: 300 });
    store.save_trigger(&trigger).unwrap();
    let running = ExecutionRecord::running("task-1", vec![automation.id.clone()], 1);
    store.save_execution(&running).unwrap();
    drop(store);

    let reopened = Store::open(&database).unwrap();
    assert_eq!(reopened.list_actions().unwrap().len(), 1);
    assert_eq!(
        reopened
            .list_transition_automations(&board.id)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(reopened.list_sources(&board.id).unwrap().len(), 1);
    assert_eq!(reopened.list_triggers(&source.id).unwrap().len(), 1);
    assert_eq!(reopened.recover_interrupted_executions().unwrap(), 1);
    let executions = reopened.list_executions().unwrap();
    assert_eq!(executions[0].status, ExecutionStatus::Interrupted);
}

#[test]
fn backup_retention_keeps_seven_daily_and_four_weekly_by_default() {
    let directory = tempdir().unwrap();
    for index in 0..9 {
        std::fs::write(
            directory.path().join(format!("daily-{index:02}.sqlite")),
            index.to_string(),
        )
        .unwrap();
    }
    for index in 0..6 {
        std::fs::write(
            directory.path().join(format!("weekly-{index:02}.sqlite")),
            index.to_string(),
        )
        .unwrap();
    }
    std::fs::write(directory.path().join("pre-import-safe.sqlite"), "keep").unwrap();

    let removed = Store::prune_backups(directory.path(), 7, 4).unwrap();

    assert_eq!(removed.len(), 4);
    assert!(directory.path().join("daily-08.sqlite").exists());
    assert!(directory.path().join("weekly-05.sqlite").exists());
    assert!(directory.path().join("pre-import-safe.sqlite").exists());
}
