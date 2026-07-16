use std::cell::Cell;

use workonit_lib::automation::CancellationToken;
use workonit_lib::{
    domain::Board,
    sources::{
        inspect_source_controlled, run_source, run_source_controlled, FieldMapping,
        SourceCommandOutput, SourceCoordinator, SourceDefinition, SourceEncoding, SourceError,
        SourceExecutor, SourceFormat, SourceRunRequest, SystemSourceExecutor,
    },
};

struct FakeSourceExecutor {
    calls: Cell<usize>,
    output: SourceCommandOutput,
}

#[test]
fn controlled_source_gates_board_identity_cancellation_truncation_and_failed_outputs() {
    let mut board = Board::starter("Collecte");
    let mut source = SourceDefinition::new(
        &board.id,
        "Tickets",
        "ignored",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: Some("$.id".into()),
            column: None,
        },
        &board.columns[0].id,
    );
    let output = |exit_code, truncated, cancelled, encoding_errors| FakeSourceExecutor {
        calls: Cell::new(0),
        output: SourceCommandOutput {
            exit_code,
            stdout: r#"[{"id":"1","title":"Imported"}]"#.into(),
            stderr: String::new(),
            truncated,
            cancelled,
            encoding_errors,
        },
    };
    let mut wrong_board = Board::starter("Wrong");
    assert!(matches!(
        run_source(
            &mut wrong_board,
            &source,
            &output(Some(0), false, false, false),
            SourceRunRequest::automatic()
        ),
        Err(SourceError::Domain(_))
    ));
    assert!(matches!(
        inspect_source_controlled(
            &source,
            &output(Some(0), false, true, false),
            &CancellationToken::default()
        ),
        Err(SourceError::Cancelled)
    ));
    let inspected = inspect_source_controlled(
        &source,
        &output(Some(0), false, false, true),
        &CancellationToken::default(),
    )
    .unwrap();
    assert!(!inspected.preview.warnings.is_empty());
    assert!(matches!(
        run_source(
            &mut board,
            &source,
            &output(Some(0), true, false, false),
            SourceRunRequest::automatic()
        ),
        Err(SourceError::TruncatedOutput)
    ));
    let allowed = run_source_controlled(
        &mut board,
        &source,
        &output(Some(2), true, false, false),
        SourceRunRequest {
            force_import: true,
            allow_truncated: true,
        },
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(allowed.import.unwrap().created, 1);
    source.accept_partial = true;
    let partial = run_source(
        &mut board,
        &source,
        &output(None, false, false, false),
        SourceRunRequest::automatic(),
    )
    .unwrap();
    assert_eq!(partial.import.unwrap().updated, 1);
}

#[cfg(not(target_os = "windows"))]
#[test]
fn source_decodes_explicit_windows_1252_output_without_silent_repair() {
    let board = Board::starter("Collecte");
    let mut source = SourceDefinition::new(
        &board.id,
        "Legacy",
        "printf '\\351'",
        SourceFormat::Text,
        FieldMapping {
            title: "title".into(),
            description: None,
            external_key: None,
            column: None,
        },
        &board.columns[0].id,
    );
    source.encoding = SourceEncoding::Windows1252;

    let output = SystemSourceExecutor.execute(&source);

    assert_eq!(output.stdout, "é");
    assert!(!output.encoding_errors);
}

#[test]
fn system_source_truncates_on_utf8_byte_boundaries_and_can_be_cancelled() {
    let mut board = Board::starter("Collecte");
    let mut source = SourceDefinition::new(
        &board.id,
        "Unicode",
        if cfg!(target_os = "windows") {
            "Write-Output -NoNewline 'éé'"
        } else {
            "printf 'éé'"
        },
        SourceFormat::Text,
        FieldMapping {
            title: "title".into(),
            description: None,
            external_key: None,
            column: None,
        },
        &board.columns[0].id,
    );
    source.output_limit_bytes = 2;
    let output = SystemSourceExecutor.execute(&source);
    assert_eq!(output.stdout, "é");
    assert!(output.truncated);

    let coordinator = SourceCoordinator::default();
    let active = coordinator.start(&source.id).unwrap();
    assert!(coordinator.cancel(&source.id));
    assert!(active.cancellation().is_cancelled());
    drop(active);
    assert!(!coordinator.cancel(&source.id));
    board.tasks.clear();
}

impl SourceExecutor for FakeSourceExecutor {
    fn execute(&self, _source: &SourceDefinition) -> SourceCommandOutput {
        self.calls.set(self.calls.get() + 1);
        self.output.clone()
    }
}

#[test]
fn source_run_imports_success_and_rejects_failed_or_truncated_output() {
    let mut board = Board::starter("Collecte");
    let source = SourceDefinition::new(
        &board.id,
        "Tickets",
        "printf data",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: Some("$.id".into()),
            column: None,
        },
        &board.columns[0].id,
    );
    let executor = FakeSourceExecutor {
        calls: Cell::new(0),
        output: SourceCommandOutput {
            exit_code: Some(0),
            stdout: r#"[{"id":"1","title":"Imported"}]"#.into(),
            stderr: String::new(),
            truncated: false,
            cancelled: false,
            encoding_errors: false,
        },
    };

    let result = run_source(
        &mut board,
        &source,
        &executor,
        SourceRunRequest::automatic(),
    )
    .unwrap();
    assert_eq!(result.import.unwrap().created, 1);
    assert_eq!(board.tasks[0].title, "Imported");

    let failed = FakeSourceExecutor {
        calls: Cell::new(0),
        output: SourceCommandOutput {
            exit_code: Some(2),
            stdout: r#"[{"id":"2","title":"Must not import"}]"#.into(),
            stderr: "failed".into(),
            truncated: false,
            cancelled: false,
            encoding_errors: false,
        },
    };
    assert!(run_source(&mut board, &source, &failed, SourceRunRequest::automatic(),).is_err());
    assert_eq!(board.tasks.len(), 1);

    let coordinator = SourceCoordinator::default();
    let guard = coordinator.start(&source.id).unwrap();
    assert!(coordinator.start(&source.id).is_err());
    drop(guard);
    assert!(coordinator.start(&source.id).is_ok());
}
