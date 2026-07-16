use std::cell::Cell;

use chrono::{Duration, Utc};
use workonit_lib::{
    domain::Board,
    scheduler::{ScheduleSpec, TriggerDefinition},
    service::{list_scheduler_journal, run_scheduler_tick},
    sources::{
        FieldMapping, SourceCommandOutput, SourceCoordinator, SourceDefinition, SourceExecutor,
        SourceFormat,
    },
    storage::Store,
};

struct FixedExecutor {
    calls: Cell<u32>,
}

impl SourceExecutor for FixedExecutor {
    fn execute(&self, _source: &SourceDefinition) -> SourceCommandOutput {
        self.calls.set(self.calls.get() + 1);
        SourceCommandOutput {
            exit_code: Some(0),
            stdout: r#"[{"id":"scheduled","title":"From scheduler"}]"#.into(),
            stderr: String::new(),
            truncated: false,
            cancelled: false,
            encoding_errors: false,
        }
    }
}

#[test]
fn scheduler_tick_runs_due_source_and_persists_import_and_next_due_time() {
    let store = Store::in_memory().unwrap();
    let board = Board::starter("Scheduled");
    store.save_board(&board).unwrap();
    let mut source = SourceDefinition::new(
        &board.id,
        "Feed",
        "feed",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: Some("$.id".into()),
            column: None,
        },
        &board.columns[0].id,
    );
    source.enabled = true;
    store.save_source(&source).unwrap();
    let now = Utc::now();
    let mut trigger =
        TriggerDefinition::scheduled(&source.id, ScheduleSpec::Interval { seconds: 60 });
    trigger.next_run_at = Some(now - Duration::seconds(1));
    store.save_trigger(&trigger).unwrap();
    let executor = FixedExecutor {
        calls: Cell::new(0),
    };

    let result =
        run_scheduler_tick(&store, &SourceCoordinator::default(), &executor, now, false).unwrap();

    assert_eq!(result.ran_source_ids, vec![source.id.clone()]);
    assert_eq!(executor.calls.get(), 1);
    assert_eq!(store.get_board(&board.id).unwrap().unwrap().tasks.len(), 1);
    assert!(store.list_triggers(&source.id).unwrap()[0].next_run_at > Some(now));
}

#[test]
fn scheduler_records_missed_disabled_and_already_active_sources_without_running_them() {
    let store = Store::in_memory().unwrap();
    let board = Board::starter("Scheduled");
    store.save_board(&board).unwrap();
    let now = Utc::now();
    let make_source = |name: &str, enabled: bool| {
        let mut source = SourceDefinition::new(
            &board.id,
            name,
            "feed",
            SourceFormat::Json,
            FieldMapping {
                title: "$.title".into(),
                description: None,
                external_key: None,
                column: None,
            },
            &board.columns[0].id,
        );
        source.enabled = enabled;
        store.save_source(&source).unwrap();
        source
    };
    let missed = make_source("Missed", true);
    let disabled = make_source("Disabled", false);
    let active = make_source("Active", true);
    for source in [&missed, &disabled, &active] {
        let mut trigger =
            TriggerDefinition::scheduled(&source.id, ScheduleSpec::Interval { seconds: 60 });
        trigger.next_run_at = Some(now - Duration::seconds(1));
        trigger.catch_up_last = source.id != missed.id;
        store.save_trigger(&trigger).unwrap();
    }
    let coordinator = SourceCoordinator::default();
    let guard = coordinator.start(&active.id).unwrap();
    let executor = FixedExecutor {
        calls: Cell::new(0),
    };

    let result = run_scheduler_tick(&store, &coordinator, &executor, now, true).unwrap();

    assert_eq!(result.missed_source_ids, vec![missed.id]);
    assert_eq!(result.skipped_active_source_ids, vec![active.id]);
    assert!(result.ran_source_ids.is_empty());
    assert_eq!(executor.calls.get(), 0);
    let journal = list_scheduler_journal(&store).unwrap();
    assert_eq!(journal.len(), 2);
    assert_eq!(journal[0].kind, "missed");
    assert_eq!(journal[1].kind, "alreadyActive");
    drop(guard);
}
