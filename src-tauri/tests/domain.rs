use workonit_lib::{
    automation::{ActionStep, TransitionAutomation},
    domain::{Board, CustomFieldValue, DomainError, FieldKind, TransitionOrigin, WipPolicy},
    engine::delete_column,
};

#[test]
fn board_blocks_forbidden_transitions_and_hard_wip_limits() {
    let mut board = Board::new("Livraison");
    let todo = board.add_column("À faire", WipPolicy::None);
    let done = board.add_column("Terminé", WipPolicy::Hard(1));
    let task = board.add_task("Publier", &todo).expect("task created");
    board.allow_transition(&todo, &done);

    board
        .move_task(&task, &done, TransitionOrigin::User)
        .expect("allowed transition");
    let other = board.add_task("Documenter", &todo).expect("task created");
    let error = board
        .move_task(&other, &done, TransitionOrigin::User)
        .expect_err("hard limit must block");

    assert_eq!(
        error.to_string(),
        "La limite de 1 tâche de « Terminé » est atteinte"
    );
}

#[test]
fn typed_custom_fields_and_safe_column_deletion_preserve_data() {
    let mut board = Board::new("Produit");
    let old = board.add_column("Ancien", WipPolicy::None);
    let destination = board.add_column("À faire", WipPolicy::None);
    let task_id = board.add_task("Migrer", &old).unwrap();
    let score = board
        .add_custom_field("Score", FieldKind::Number, true)
        .unwrap();
    let token = board
        .add_custom_field("Jeton", FieldKind::Secret, true)
        .unwrap();
    board
        .set_custom_value(&task_id, &score, CustomFieldValue::Number(4.5))
        .unwrap();
    board
        .set_custom_value(
            &task_id,
            &token,
            CustomFieldValue::SecretRef("deployment-token".into()),
        )
        .unwrap();
    let mut automations = vec![TransitionAutomation::new(
        &board.id,
        Some(old.clone()),
        &destination,
        vec![ActionStep::new("action")],
    )];

    let impact = delete_column(&mut board, &mut automations, &old, &destination).unwrap();

    assert_eq!(impact.moved_task_ids, vec![task_id.clone()]);
    assert_eq!(
        impact.disabled_automation_ids,
        vec![automations[0].id.clone()]
    );
    assert!(!automations[0].enabled);
    assert!(board.columns.iter().all(|column| column.id != old));
    assert_eq!(
        board
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .unwrap()
            .column_id,
        destination
    );
}

#[test]
fn columns_keep_stable_ids_when_renamed_and_reordered() {
    let mut board = Board::new("Projet");
    let first = board.add_column("A", WipPolicy::None);
    let second = board.add_column("B", WipPolicy::None);

    board.rename_column(&first, "Nouveau nom").unwrap();
    board.reorder_column(&second, 0).unwrap();

    assert_eq!(board.columns[0].id, second);
    assert_eq!(board.columns[1].id, first);
    assert_eq!(board.columns[1].name, "Nouveau nom");
    assert_eq!(
        board.reorder_column(&first, 4),
        Err(DomainError::InvalidPosition)
    );
}

#[test]
fn manual_task_order_and_archive_lifecycle_are_explicit() {
    let mut board = Board::new("Projet");
    let column = board.add_column("À faire", WipPolicy::None);
    let first = board.add_task("Premier", &column).unwrap();
    let second = board.add_task("Second", &column).unwrap();

    board.reorder_task(&second, 0).unwrap();
    assert_eq!(
        board
            .tasks
            .iter()
            .find(|task| task.id == second)
            .unwrap()
            .position,
        0
    );
    assert!(matches!(
        board.permanently_delete_task(&first),
        Err(DomainError::TaskNotArchived)
    ));
    board.archive_task(&first).unwrap();
    board.restore_task(&first).unwrap();
    assert!(
        !board
            .tasks
            .iter()
            .find(|task| task.id == first)
            .unwrap()
            .archived
    );
    board.archive_task(&first).unwrap();
    assert_eq!(board.permanently_delete_task(&first).unwrap().id, first);
}

#[test]
fn board_validation_covers_configuration_updates_and_safe_removal_edges() {
    let mut board = Board::new("Validation");
    let first = board.add_column("A", WipPolicy::None);
    let second = board.add_column("B", WipPolicy::Hard(1));
    assert_eq!(
        board.rename_column(&first, "  "),
        Err(DomainError::EmptyTitle)
    );
    assert_eq!(
        board.rename_column("missing", "X"),
        Err(DomainError::ColumnNotFound)
    );
    assert_eq!(
        board.configure_column(&first, "", "#fff", WipPolicy::None),
        Err(DomainError::EmptyTitle)
    );
    assert_eq!(
        board.configure_column("missing", "X", "#fff", WipPolicy::None),
        Err(DomainError::ColumnNotFound)
    );
    board
        .configure_column(&first, " Renommée ", "#123456", WipPolicy::Warning(1))
        .unwrap();
    assert_eq!(board.columns[0].name, "Renommée");
    assert_eq!(
        board.set_transition_rules(
            true,
            vec![workonit_lib::domain::TransitionRule {
                from_column_id: first.clone(),
                to_column_id: "missing".into(),
            }],
        ),
        Err(DomainError::ColumnNotFound)
    );
    board
        .set_transition_rules(
            true,
            vec![workonit_lib::domain::TransitionRule {
                from_column_id: first.clone(),
                to_column_id: second.clone(),
            }],
        )
        .unwrap();
    assert_eq!(board.add_task("", &first), Err(DomainError::EmptyTitle));
    let task = board.add_task("Task", &first).unwrap();
    assert!(board.wip_warning(&first).unwrap().contains("1 tâche"));
    assert_eq!(board.wip_warning("missing"), None);
    assert_eq!(board.wip_warning(&second), None);
    assert_eq!(
        board.move_task(&task, &first, TransitionOrigin::User),
        Ok(())
    );
    assert_eq!(
        board.move_task(&task, "missing", TransitionOrigin::User),
        Err(DomainError::ColumnNotFound)
    );
    board.allowed_transitions.clear();
    assert!(matches!(
        board.move_task(&task, &second, TransitionOrigin::User),
        Err(DomainError::ForbiddenTransition(_))
    ));
    assert_eq!(
        board.remove_column(&first),
        Err(DomainError::ColumnNotEmpty)
    );
    board.archive_task(&task).unwrap();
    board.remove_column(&first).unwrap();
    assert_eq!(
        board.remove_column("missing"),
        Err(DomainError::ColumnNotFound)
    );
}

#[test]
fn custom_fields_updates_wip_migration_and_missing_records_are_validated() {
    let mut board = Board::new("Fields");
    let source = board.add_column("Source", WipPolicy::None);
    let target = board.add_column("Target", WipPolicy::Hard(1));
    let task = board.add_task("Task", &source).unwrap();
    assert_eq!(
        board.add_custom_field("", FieldKind::Text, false),
        Err(DomainError::EmptyFieldName)
    );
    for index in 0..3 {
        board
            .add_custom_field(format!("Pinned {index}"), FieldKind::Text, true)
            .unwrap();
    }
    assert_eq!(
        board.add_custom_field("Fourth", FieldKind::Text, true),
        Err(DomainError::TooManyPinnedFields)
    );
    let number = board
        .add_custom_field("N", FieldKind::Number, false)
        .unwrap();
    let boolean = board
        .add_custom_field("B", FieldKind::Boolean, false)
        .unwrap();
    let date = board.add_custom_field("D", FieldKind::Date, false).unwrap();
    let list = board
        .add_custom_field(
            "L",
            FieldKind::List {
                options: vec!["one".into()],
            },
            false,
        )
        .unwrap();
    let secret = board
        .add_custom_field("S", FieldKind::Secret, false)
        .unwrap();
    board
        .set_custom_value(&task, &number, CustomFieldValue::Number(1.5))
        .unwrap();
    board
        .set_custom_value(&task, &boolean, CustomFieldValue::Boolean(true))
        .unwrap();
    board
        .set_custom_value(&task, &date, CustomFieldValue::Date("2026-01-01".into()))
        .unwrap();
    board
        .set_custom_value(&task, &list, CustomFieldValue::List("one".into()))
        .unwrap();
    board
        .set_custom_value(&task, &secret, CustomFieldValue::SecretRef("key".into()))
        .unwrap();
    assert_eq!(CustomFieldValue::Number(1.5).text(), "1.5");
    assert_eq!(CustomFieldValue::Boolean(true).text(), "true");
    assert_eq!(
        board.set_custom_value(&task, &number, CustomFieldValue::Number(f64::NAN)),
        Err(DomainError::InvalidCustomFieldValue)
    );
    assert_eq!(
        board.set_custom_value(&task, &list, CustomFieldValue::List("other".into())),
        Err(DomainError::InvalidCustomFieldValue)
    );
    assert_eq!(
        board.set_custom_value(&task, &number, CustomFieldValue::Text("wrong".into())),
        Err(DomainError::InvalidCustomFieldValue)
    );
    assert_eq!(
        board.set_custom_value(&task, "missing", CustomFieldValue::Text("x".into())),
        Err(DomainError::CustomFieldNotFound)
    );
    assert_eq!(
        board.set_custom_value("missing", &number, CustomFieldValue::Number(1.0)),
        Err(DomainError::TaskNotFound)
    );

    let mut updated = board.tasks[0].clone();
    updated.title.clear();
    assert_eq!(board.update_task(updated), Err(DomainError::EmptyTitle));
    let mut missing = board.tasks[0].clone();
    missing.id = "missing".into();
    assert_eq!(board.update_task(missing), Err(DomainError::TaskNotFound));
    let mut updated = board.tasks[0].clone();
    updated.title = "Updated".into();
    board.update_task(updated).unwrap();
    assert_eq!(
        board.archive_task("missing"),
        Err(DomainError::TaskNotFound)
    );
    assert_eq!(
        board.restore_task("missing"),
        Err(DomainError::TaskNotFound)
    );
    assert_eq!(
        board.reorder_task("missing", 0),
        Err(DomainError::TaskNotFound)
    );
    assert_eq!(
        board.reorder_task(&task, 4),
        Err(DomainError::InvalidPosition)
    );
    assert_eq!(
        board.migrate_and_remove_column(&source, &source),
        Err(DomainError::SameColumn)
    );
    board.add_task("Occupied", &target).unwrap();
    assert!(matches!(
        board.migrate_and_remove_column(&source, &target),
        Err(DomainError::HardWipLimit { .. })
    ));
    let mut migratable = Board::new("Migration");
    let from = migratable.add_column("From", WipPolicy::None);
    let to = migratable.add_column("To", WipPolicy::Hard(2));
    migratable.add_task("One", &from).unwrap();
    assert_eq!(
        migratable
            .migrate_and_remove_column(&from, &to)
            .unwrap()
            .len(),
        1
    );
}
