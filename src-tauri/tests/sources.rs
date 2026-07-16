use workonit_lib::{
    domain::{Board, CustomFieldValue, FieldKind, WipPolicy},
    sources::{
        apply_preview, apply_source_preview, planned_source_moves, preview,
        preview_with_custom_fields, FieldMapping, SourceDefinition, SourceFormat,
        SourceUpdateField,
    },
};

#[test]
fn jsonl_preview_keeps_valid_rows_and_deduplicates_imports() {
    let mapping = FieldMapping {
        title: "title".into(),
        description: Some("body".into()),
        external_key: Some("id".into()),
        column: None,
    };
    let input = "{\"id\":\"42\",\"title\":\"First\",\"body\":\"A\"}\nnot-json\n{\"id\":\"43\",\"title\":\"Second\"}";
    let result = preview(SourceFormat::Jsonl, input, &mapping, None);

    assert_eq!(result.records.len(), 2);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].line, 2);

    let mut board = Board::new("Collecte");
    let inbox = board.add_column("Entrée", WipPolicy::None);
    let first = apply_preview(&mut board, &inbox, "Tickets", &result).expect("import works");
    let mut changed = result.clone();
    changed.records[0].title = "First updated".into();
    let second = apply_preview(&mut board, &inbox, "Tickets", &changed).expect("update works");

    assert_eq!((first.created, first.updated), (2, 0));
    assert_eq!((second.created, second.updated), (0, 2));
    assert_eq!(board.tasks.len(), 2);
    assert_eq!(board.tasks[0].title, "First updated");
}

#[test]
fn previews_report_json_and_text_errors_and_convert_scalar_values() {
    let mapping = FieldMapping {
        title: "$.title".into(),
        description: Some("$.description".into()),
        external_key: None,
        column: None,
    };
    let single = preview(
        SourceFormat::Json,
        r#"{"title":42,"description":true}"#,
        &mapping,
        None,
    );
    assert_eq!(single.records[0].title, "42");
    assert_eq!(single.records[0].description, "true");
    assert!(!single.warnings.is_empty());
    assert!(!preview(SourceFormat::Json, "{", &mapping, None)
        .errors
        .is_empty());
    assert!(
        !preview(SourceFormat::Json, r#"{"title":null}"#, &mapping, None)
            .errors
            .is_empty()
    );
    assert_eq!(
        preview(
            SourceFormat::Jsonl,
            "\n{\"title\":\"ok\"}\n",
            &mapping,
            None
        )
        .records
        .len(),
        1
    );

    let text_mapping = FieldMapping {
        title: "title".into(),
        description: None,
        external_key: Some("external_key".into()),
        column: None,
    };
    let text = preview(
        SourceFormat::Text,
        "42|Title|Details\nno match\n43||Empty",
        &text_mapping,
        Some(r"^(?P<external_key>[^|]+)\|(?P<title>[^|]*)\|(?P<description>.*)$"),
    );
    assert_eq!(text.records[0].title, "Title");
    assert_eq!(text.records[0].description, "Details");
    assert_eq!(text.errors.len(), 2);
    assert!(!preview(SourceFormat::Text, "x", &text_mapping, Some("["))
        .errors
        .is_empty());
    assert!(!preview(SourceFormat::Text, "x", &text_mapping, None)
        .errors
        .is_empty());
}

#[test]
fn source_maps_dynamic_columns_protects_fields_and_marks_absences() {
    let mut board = Board::new("Collecte");
    let inbox = board.add_column("Entrée", WipPolicy::None);
    let done = board.add_column("Terminé", WipPolicy::None);
    let score = board
        .add_custom_field("Score", FieldKind::Number, false)
        .unwrap();
    let mapping = FieldMapping {
        title: "$.title".into(),
        description: Some("$.body".into()),
        external_key: Some("$.id".into()),
        column: Some("$.state".into()),
    };
    let mut source = SourceDefinition::new(
        &board.id,
        "Tickets",
        "ignored",
        SourceFormat::Json,
        mapping.clone(),
        &inbox,
    );
    source.column_mapping.insert("closed".into(), done.clone());
    source.fallback_column_id = Some(inbox.clone());
    source.allowed_update_fields = vec![SourceUpdateField::Description];
    source
        .custom_field_mapping
        .insert(score.clone(), "$.score".into());
    source.move_existing_tasks = true;
    source.absence_threshold = 2;
    let first = preview_with_custom_fields(
        SourceFormat::Json,
        r#"[{"id":"1","title":"Original","body":"A","state":"open","score":5}]"#,
        &mapping,
        None,
        &source.custom_field_mapping,
    );
    apply_source_preview(&mut board, &source, &first).unwrap();
    source.name = "Tickets renommés".into();

    let updated = preview_with_custom_fields(
        SourceFormat::Json,
        r#"[{"id":"1","title":"Ignored","body":"B","state":"closed","score":8}]"#,
        &mapping,
        None,
        &source.custom_field_mapping,
    );
    apply_source_preview(&mut board, &source, &updated).unwrap();
    assert_eq!(board.tasks.len(), 1);
    assert_eq!(
        board.tasks[0].source_id.as_deref(),
        Some(source.id.as_str())
    );
    assert_eq!(
        board.tasks[0].source_name.as_deref(),
        Some(source.name.as_str())
    );
    assert_eq!(board.tasks[0].title, "Original");
    assert_eq!(board.tasks[0].description, "B");
    assert_eq!(board.tasks[0].column_id, done);
    assert_eq!(
        board.tasks[0].custom_values.get(&score),
        Some(&CustomFieldValue::Number(5.0))
    );
    source.allowed_update_custom_fields.push(score.clone());
    apply_source_preview(&mut board, &source, &updated).unwrap();
    assert_eq!(
        board.tasks[0].custom_values.get(&score),
        Some(&CustomFieldValue::Number(8.0))
    );

    let empty = preview(SourceFormat::Json, "[]", &mapping, None);
    apply_source_preview(&mut board, &source, &empty).unwrap();
    assert!(!board.tasks[0].absent_from_source);
    apply_source_preview(&mut board, &source, &empty).unwrap();
    assert!(board.tasks[0].absent_from_source);
}

#[test]
fn json_mapping_accepts_rfc_jsonpath_array_and_quoted_key_selectors() {
    let mapping = FieldMapping {
        title: "$.names[1]".into(),
        description: Some("$['long-description']".into()),
        external_key: None,
        column: None,
    };
    let result = preview(
        SourceFormat::Json,
        r#"[{"names":["ignore","Mapped"],"long-description":"Details"}]"#,
        &mapping,
        None,
    );

    assert!(result.errors.is_empty());
    assert_eq!(result.records[0].title, "Mapped");
    assert_eq!(result.records[0].description, "Details");
}

#[test]
fn planned_moves_require_opt_in_keys_existing_tasks_and_real_column_changes() {
    let mut board = Board::starter("Moves");
    let mapping = FieldMapping {
        title: "$.title".into(),
        description: None,
        external_key: Some("$.id".into()),
        column: Some("$.state".into()),
    };
    let mut source = SourceDefinition::new(
        &board.id,
        "Tickets",
        "ignored",
        SourceFormat::Json,
        mapping.clone(),
        &board.columns[0].id,
    );
    let initial = preview(
        SourceFormat::Json,
        r#"[{"id":"1","title":"One"}]"#,
        &mapping,
        None,
    );
    apply_source_preview(&mut board, &source, &initial).unwrap();
    source.fallback_column_id = Some(board.columns[1].id.clone());
    let update = preview(
        SourceFormat::Json,
        r#"[{"id":"1","title":"One","state":"unknown"},{"title":"No key"},{"id":"missing","title":"Missing"}]"#,
        &mapping,
        None,
    );
    assert!(planned_source_moves(&board, &source, &update).is_empty());
    source.move_existing_tasks = true;
    let moves = planned_source_moves(&board, &source, &update);
    assert_eq!(moves.len(), 1);
    assert_eq!(moves[0].target_column_id, board.columns[1].id);
}

#[test]
fn direct_source_move_propagates_hard_wip_errors() {
    let mut board = Board::new("WIP");
    let from = board.add_column("From", WipPolicy::None);
    let to = board.add_column("To", WipPolicy::Hard(1));
    board.add_task("Occupied", &to).unwrap();
    let mapping = FieldMapping {
        title: "$.title".into(),
        description: None,
        external_key: Some("$.id".into()),
        column: Some("$.state".into()),
    };
    let mut source = SourceDefinition::new(
        &board.id,
        "Feed",
        "run",
        SourceFormat::Json,
        mapping.clone(),
        &from,
    );
    source.column_mapping.insert("done".into(), to);
    let initial = preview(
        SourceFormat::Json,
        r#"[{"id":"1","title":"Task","state":"open"}]"#,
        &mapping,
        None,
    );
    apply_source_preview(&mut board, &source, &initial).unwrap();
    source.move_existing_tasks = true;
    let moved = preview(
        SourceFormat::Json,
        r#"[{"id":"1","title":"Task","state":"done"}]"#,
        &mapping,
        None,
    );
    assert!(apply_source_preview(&mut board, &source, &moved).is_err());
}
