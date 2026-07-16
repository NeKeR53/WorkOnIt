use chrono::Utc;
use std::io::{Cursor, Write};
use workonit_lib::{
    automation::{
        ActionStep, CommandAction, CommandVariant, ExecutionRecord, OperatingSystem,
        TransitionAutomation,
    },
    domain::{Board, TransitionOrigin, WipPolicy},
    exchange::{
        apply_import, export_bundle, import_bundle, preview_conflicts, ConflictDecision,
        ExchangeError, ExportBundle, ExportLog, ImportObjectKind, ImportResolution, Manifest,
    },
    scheduler::{ScheduleSpec, TriggerDefinition},
    sources::{FieldMapping, SourceDefinition, SourceFormat},
};

#[test]
fn imported_shell_actions_require_fresh_trust() {
    let mut board = Board::new("Release");
    board.add_column("À faire", WipPolicy::None);
    let mut action = CommandAction::shell("Publier", "");
    action.variants = vec![CommandVariant {
        operating_system: OperatingSystem::Windows,
        runner: "pwsh".into(),
        script: "deploy".into(),
    }];
    action.enabled = true;
    let bytes = export_bundle(&ExportBundle {
        boards: vec![board],
        actions: vec![action],
        automations: vec![],
        sources: vec![],
        triggers: vec![],
        execution_history: vec![],
        logs: vec![],
    })
    .expect("export succeeds");

    let imported = import_bundle(&bytes).expect("import succeeds");

    assert_eq!(imported.manifest.format_version, 1);
    assert_eq!(imported.bundle.boards[0].name, "Release");
    assert!(!imported.bundle.actions[0].enabled);
    assert_eq!(imported.trust_required_actions.len(), 1);
}

#[test]
fn copy_import_remaps_nested_board_source_history_and_log_references() {
    let mut board = Board::starter("Nested");
    let task_id = board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    board.allow_transition(&board.columns[0].id.clone(), &board.columns[1].id.clone());
    board
        .move_task(
            &task_id,
            &board.columns[1].id.clone(),
            TransitionOrigin::User,
        )
        .unwrap();
    let action = CommandAction::shell("Action", "run");
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[1].id.clone()),
        &board.columns[2].id,
        vec![ActionStep::new(&action.id)],
    );
    let mut source = SourceDefinition::new(
        &board.id,
        "Source",
        "collect",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: None,
            column: Some("$.column".into()),
        },
        &board.columns[0].id,
    );
    source.fallback_column_id = Some(board.columns[1].id.clone());
    source
        .column_mapping
        .insert("done".into(), board.columns[2].id.clone());
    let trigger = TriggerDefinition::manual(&source.id);
    let history = ExecutionRecord::running(&task_id, vec![automation.id.clone()], 1);
    let bundle = ExportBundle {
        boards: vec![board.clone()],
        actions: vec![action.clone()],
        automations: vec![automation.clone()],
        sources: vec![source.clone()],
        triggers: vec![trigger.clone()],
        execution_history: vec![history],
        logs: vec![ExportLog {
            execution_id: "log".into(),
            stdout: "out".into(),
            stderr: "err".into(),
        }],
    };
    let round_trip = import_bundle(&export_bundle(&bundle).unwrap()).unwrap();
    assert_eq!(round_trip.bundle.execution_history.len(), 1);
    assert_eq!(round_trip.bundle.logs.len(), 1);
    let decisions = vec![
        (ImportObjectKind::Board, board.id.clone()),
        (ImportObjectKind::Action, action.id.clone()),
        (ImportObjectKind::Automation, automation.id.clone()),
        (ImportObjectKind::Source, source.id.clone()),
        (ImportObjectKind::Trigger, trigger.id.clone()),
    ]
    .into_iter()
    .map(|(kind, id)| ConflictDecision {
        id,
        kind,
        resolution: ImportResolution::Copy,
    })
    .collect::<Vec<_>>();

    let merged = apply_import(&bundle, &bundle, &decisions).unwrap();
    let copied_board = &merged.boards[1];
    let copied_source = &merged.sources[1];
    assert_ne!(copied_board.tasks[0].id, task_id);
    assert_eq!(copied_board.tasks[0].column_id, copied_board.columns[1].id);
    assert_eq!(
        copied_board.tasks[0].history[0].from_column_id,
        copied_board.columns[0].id
    );
    assert_eq!(
        copied_board.allowed_transitions[0].to_column_id,
        copied_board.columns[1].id
    );
    assert_eq!(copied_source.initial_column_id, copied_board.columns[0].id);
    assert_eq!(
        copied_source.fallback_column_id.as_deref(),
        Some(copied_board.columns[1].id.as_str())
    );
    assert_eq!(
        copied_source.column_mapping["done"],
        copied_board.columns[2].id
    );
    assert_eq!(
        merged.execution_history[1].task_id,
        copied_board.tasks[0].id
    );
    assert_eq!(merged.logs.len(), 2);
}

#[test]
fn update_and_ignore_resolutions_replace_or_preserve_every_conflicting_kind() {
    let mut board = Board::starter("Original");
    let action = CommandAction::shell("Original", "run");
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[1].id,
        vec![ActionStep::new(&action.id)],
    );
    let source = SourceDefinition::new(
        &board.id,
        "Original",
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
    let existing = ExportBundle {
        boards: vec![board.clone()],
        actions: vec![action.clone()],
        automations: vec![automation.clone()],
        sources: vec![source.clone()],
        triggers: vec![trigger.clone()],
        execution_history: vec![],
        logs: vec![],
    };
    board.name = "Updated".into();
    let mut imported = existing.clone();
    imported.boards[0] = board;
    imported.actions[0].name = "Updated".into();
    imported.sources[0].name = "Updated".into();
    let conflicts = preview_conflicts(&imported, &existing);
    let updates = conflicts
        .iter()
        .map(|item| ConflictDecision {
            id: item.id.clone(),
            kind: item.kind.clone(),
            resolution: ImportResolution::Update,
        })
        .collect::<Vec<_>>();
    let updated = apply_import(&existing, &imported, &updates).unwrap();
    assert_eq!(updated.boards[0].name, "Updated");
    assert_eq!(updated.actions[0].name, "Updated");
    assert_eq!(updated.sources[0].name, "Updated");
    let ignores = conflicts
        .into_iter()
        .map(|item| ConflictDecision {
            id: item.id,
            kind: item.kind,
            resolution: ImportResolution::Ignore,
        })
        .collect::<Vec<_>>();
    let ignored = apply_import(&existing, &imported, &ignores).unwrap();
    assert_eq!(ignored.boards[0].name, "Original");
    assert_eq!(ignored.actions[0].name, "Original");
    assert_eq!(ignored.sources[0].name, "Original");
}

#[test]
fn importer_rejects_invalid_archives_and_unsupported_manifest_versions() {
    assert!(matches!(
        import_bundle(b"not a zip"),
        Err(ExchangeError::Zip(_))
    ));
    let cursor = Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default();
    writer.start_file("manifest.json", options).unwrap();
    writer
        .write_all(
            serde_json::to_string(&Manifest {
                format_version: 99,
                exported_at: Utc::now(),
                product: "WorkOnIt".into(),
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
    let bytes = writer.finish().unwrap().into_inner();
    assert!(matches!(
        import_bundle(&bytes),
        Err(ExchangeError::UnsupportedVersion(99))
    ));
}

#[test]
fn portable_bundle_disables_all_imported_shell_entry_points_and_previews_conflicts() {
    let mut board = Board::new("Release");
    let first = board.add_column("À faire", WipPolicy::None);
    let second = board.add_column("Fait", WipPolicy::None);
    let action = CommandAction::shell("Publier", "deploy");
    let automation = TransitionAutomation::new(
        &board.id,
        Some(first.clone()),
        &second,
        vec![ActionStep::new(&action.id)],
    );
    let mut source = SourceDefinition::new(
        &board.id,
        "Tickets",
        "collect",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: None,
            column: None,
        },
        &first,
    );
    source.enabled = true;
    let trigger = TriggerDefinition::scheduled(&source.id, ScheduleSpec::Interval { seconds: 60 });
    let original = ExportBundle {
        boards: vec![board],
        actions: vec![action],
        automations: vec![automation],
        sources: vec![source],
        triggers: vec![trigger],
        execution_history: vec![],
        logs: vec![],
    };

    let imported = import_bundle(&export_bundle(&original).unwrap()).unwrap();

    assert!(!imported.bundle.actions[0].enabled);
    assert!(!imported.bundle.automations[0].enabled);
    assert!(!imported.bundle.sources[0].enabled);
    assert!(!imported.bundle.triggers[0].enabled);
    assert_eq!(imported.trust_required_sources.len(), 1);
    let conflicts = preview_conflicts(&imported.bundle, &original);
    assert_eq!(conflicts.len(), 5);
    assert!(conflicts
        .iter()
        .any(|item| item.kind == ImportObjectKind::Board));

    assert!(apply_import(&original, &imported.bundle, &[]).is_err());
    let decisions: Vec<ConflictDecision> = conflicts
        .into_iter()
        .map(|conflict| ConflictDecision {
            id: conflict.id,
            kind: conflict.kind,
            resolution: ImportResolution::Copy,
        })
        .collect();
    let merged = apply_import(&original, &imported.bundle, &decisions).unwrap();
    assert_eq!(merged.boards.len(), 2);
    assert_eq!(merged.actions.len(), 2);
    assert_eq!(merged.sources.len(), 2);
    let copied_board = &merged.boards[1];
    let copied_source = &merged.sources[1];
    let copied_automation = &merged.automations[1];
    assert_eq!(copied_source.board_id, copied_board.id);
    assert_eq!(copied_automation.board_id, copied_board.id);
    assert_eq!(copied_automation.steps[0].action_id, merged.actions[1].id);
    assert_eq!(merged.triggers[1].source_id, copied_source.id);
}
