use chrono::{Datelike, TimeZone, Utc};
use workonit_lib::scheduler::{
    process_due_triggers, wake_decision, ScheduleError, ScheduleSpec, SchedulerEvent,
    TriggerDefinition, WakeDecision,
};

#[test]
fn daily_schedule_skips_nonexistent_dst_time() {
    let schedule = ScheduleSpec::Daily {
        hour: 2,
        minute: 30,
        timezone: "Europe/Paris".into(),
    };
    let before_gap = Utc.with_ymd_and_hms(2026, 3, 28, 23, 0, 0).unwrap();

    let next = schedule
        .next_after(before_gap)
        .expect("schedule is valid")
        .expect("next occurrence");

    assert_eq!(next, Utc.with_ymd_and_hms(2026, 3, 30, 0, 30, 0).unwrap());
}

#[test]
fn schedules_validate_every_variant_and_recompute_trigger_state() {
    let after = Utc.with_ymd_and_hms(2026, 10, 24, 22, 0, 0).unwrap();
    assert!(matches!(
        ScheduleSpec::Interval { seconds: 0 }.next_after(after),
        Err(ScheduleError::InvalidInterval)
    ));
    assert!(matches!(
        ScheduleSpec::Daily {
            hour: 24,
            minute: 0,
            timezone: "UTC".into(),
        }
        .next_after(after),
        Err(ScheduleError::InvalidTime)
    ));
    assert!(matches!(
        ScheduleSpec::Daily {
            hour: 9,
            minute: 0,
            timezone: "Mars/Olympus".into(),
        }
        .next_after(after),
        Err(ScheduleError::InvalidTimezone(_))
    ));
    assert!(matches!(
        ScheduleSpec::Cron {
            expression: "not cron".into(),
            timezone: "UTC".into(),
        }
        .next_after(after),
        Err(ScheduleError::InvalidCron(_))
    ));
    let cron = ScheduleSpec::Cron {
        expression: "0 0 9 * * *".into(),
        timezone: "Europe/Paris".into(),
    };
    assert!(cron.next_after(after).unwrap().unwrap() > after);
    let weekly = ScheduleSpec::Weekly {
        weekdays: vec![1],
        hour: 9,
        minute: 15,
        timezone: "UTC".into(),
    };
    assert_eq!(
        weekly
            .next_after(after)
            .unwrap()
            .unwrap()
            .weekday()
            .number_from_monday(),
        1
    );
    let never = ScheduleSpec::Weekly {
        weekdays: vec![],
        hour: 9,
        minute: 0,
        timezone: "UTC".into(),
    };
    assert_eq!(never.next_after(after).unwrap(), None);

    let mut manual = TriggerDefinition::manual("manual");
    manual.recompute_next(after).unwrap();
    assert_eq!(manual.next_run_at, None);
    let mut scheduled = TriggerDefinition::scheduled("scheduled", weekly);
    scheduled.recompute_next(after).unwrap();
    assert!(scheduled.next_run_at.is_some());
}

#[test]
fn wake_and_due_processing_cover_wait_initial_future_disabled_and_regular_runs() {
    let now = Utc.with_ymd_and_hms(2026, 4, 1, 10, 0, 0).unwrap();
    assert_eq!(
        wake_decision(now + chrono::Duration::seconds(1), now, true),
        WakeDecision::Wait
    );
    assert_eq!(wake_decision(now, now, true), WakeDecision::RunOnce);
    assert_eq!(wake_decision(now, now, false), WakeDecision::RecordMissed);

    let mut disabled =
        TriggerDefinition::scheduled("disabled", ScheduleSpec::Interval { seconds: 5 });
    disabled.enabled = false;
    disabled.next_run_at = Some(now);
    let manual = TriggerDefinition::manual("manual");
    let initial = TriggerDefinition::scheduled("initial", ScheduleSpec::Interval { seconds: 5 });
    let mut future = TriggerDefinition::scheduled("future", ScheduleSpec::Interval { seconds: 5 });
    future.next_run_at = Some(now + chrono::Duration::seconds(2));
    let mut due = TriggerDefinition::scheduled("due", ScheduleSpec::Interval { seconds: 5 });
    due.next_run_at = Some(now);
    let mut triggers = vec![disabled, manual, initial, future, due];

    let events = process_due_triggers(&mut triggers, now, false).unwrap();

    assert_eq!(
        events,
        vec![SchedulerEvent::RunSource {
            source_id: "due".into()
        }]
    );
    assert_eq!(triggers[0].next_run_at, Some(now));
    assert_eq!(triggers[1].next_run_at, None);
    assert_eq!(
        triggers[2].next_run_at,
        Some(now + chrono::Duration::seconds(5))
    );
    assert_eq!(
        triggers[3].next_run_at,
        Some(now + chrono::Duration::seconds(2))
    );
    assert_eq!(triggers[4].last_run_at, Some(now));
}

#[test]
fn repeated_dst_time_uses_the_first_occurrence() {
    let schedule = ScheduleSpec::Daily {
        hour: 2,
        minute: 30,
        timezone: "Europe/Paris".into(),
    };
    let before = Utc.with_ymd_and_hms(2026, 10, 24, 22, 0, 0).unwrap();
    assert_eq!(
        schedule.next_after(before).unwrap(),
        Some(Utc.with_ymd_and_hms(2026, 10, 25, 0, 30, 0).unwrap())
    );
}

#[test]
fn wake_runs_at_most_one_catch_up_or_records_missed_occurrence() {
    let now = Utc.with_ymd_and_hms(2026, 4, 1, 10, 0, 0).unwrap();
    let mut catch_up =
        TriggerDefinition::scheduled("source-a", ScheduleSpec::Interval { seconds: 60 });
    catch_up.catch_up_last = true;
    catch_up.next_run_at = Some(now - chrono::Duration::hours(2));
    let mut skip = TriggerDefinition::scheduled("source-b", ScheduleSpec::Interval { seconds: 60 });
    skip.next_run_at = Some(now - chrono::Duration::hours(2));

    let events = process_due_triggers(&mut [catch_up, skip], now, true).unwrap();

    assert_eq!(events.len(), 2);
    assert!(
        matches!(events[0], SchedulerEvent::RunSource { ref source_id } if source_id == "source-a")
    );
    assert!(
        matches!(events[1], SchedulerEvent::Missed { ref source_id } if source_id == "source-b")
    );
}

#[test]
fn startup_does_not_catch_up_an_old_occurrence_without_opt_in() {
    let now = Utc.with_ymd_and_hms(2026, 4, 1, 10, 0, 0).unwrap();
    let mut trigger =
        TriggerDefinition::scheduled("source", ScheduleSpec::Interval { seconds: 60 });
    trigger.next_run_at = Some(now - chrono::Duration::seconds(1));

    let events = process_due_triggers(std::slice::from_mut(&mut trigger), now, true).unwrap();

    assert!(
        matches!(events.as_slice(), [SchedulerEvent::Missed { source_id }] if source_id == "source")
    );
}
