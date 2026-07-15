use workonit_lib::{
    domain::{Board, WipPolicy},
    sources::{apply_preview, preview, FieldMapping, SourceFormat},
};

#[test]
fn jsonl_preview_keeps_valid_rows_and_deduplicates_imports() {
    let mapping = FieldMapping {
        title: "title".into(),
        description: Some("body".into()),
        external_key: Some("id".into()),
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
