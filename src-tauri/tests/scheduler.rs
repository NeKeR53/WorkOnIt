use chrono::{TimeZone, Utc};
use workonit_lib::scheduler::ScheduleSpec;

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
