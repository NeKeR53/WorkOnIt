use chrono::{DateTime, Datelike, Duration, LocalResult, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ScheduleSpec {
    Interval {
        seconds: u64,
    },
    Daily {
        hour: u32,
        minute: u32,
        timezone: String,
    },
    Weekly {
        weekdays: Vec<u32>,
        hour: u32,
        minute: u32,
        timezone: String,
    },
    Cron {
        expression: String,
        timezone: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerDefinition {
    pub id: String,
    pub source_id: String,
    pub schedule: Option<ScheduleSpec>,
    pub enabled: bool,
    pub catch_up_last: bool,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
}

impl TriggerDefinition {
    pub fn manual(source_id: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            source_id: source_id.into(),
            schedule: None,
            enabled: true,
            catch_up_last: false,
            last_run_at: None,
            next_run_at: None,
        }
    }

    pub fn scheduled(source_id: impl Into<String>, schedule: ScheduleSpec) -> Self {
        Self {
            schedule: Some(schedule),
            ..Self::manual(source_id)
        }
    }

    pub fn recompute_next(&mut self, after: DateTime<Utc>) -> Result<(), ScheduleError> {
        self.next_run_at = self
            .schedule
            .as_ref()
            .map(|schedule| schedule.next_after(after))
            .transpose()?
            .flatten();
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum ScheduleError {
    #[error("Fuseau horaire inconnu : {0}")]
    InvalidTimezone(String),
    #[error("Expression cron invalide : {0}")]
    InvalidCron(String),
    #[error("Intervalle invalide")]
    InvalidInterval,
    #[error("Heure invalide")]
    InvalidTime,
}

impl ScheduleSpec {
    pub fn next_after(&self, after: DateTime<Utc>) -> Result<Option<DateTime<Utc>>, ScheduleError> {
        match self {
            Self::Interval { seconds } => {
                if *seconds == 0 || *seconds > i64::MAX as u64 {
                    return Err(ScheduleError::InvalidInterval);
                }
                Ok(Some(after + Duration::seconds(*seconds as i64)))
            }
            Self::Daily {
                hour,
                minute,
                timezone,
            } => next_guided(after, *hour, *minute, timezone, |_| true),
            Self::Weekly {
                weekdays,
                hour,
                minute,
                timezone,
            } => next_guided(after, *hour, *minute, timezone, |day| {
                weekdays.contains(&day)
            }),
            Self::Cron {
                expression,
                timezone,
            } => {
                let timezone = parse_timezone(timezone)?;
                let schedule = cron::Schedule::from_str(expression)
                    .map_err(|error| ScheduleError::InvalidCron(error.to_string()))?;
                Ok(schedule
                    .after(&after.with_timezone(&timezone))
                    .next()
                    .map(|date| date.with_timezone(&Utc)))
            }
        }
    }
}

pub fn wake_decision(
    scheduled_for: DateTime<Utc>,
    woke_at: DateTime<Utc>,
    catch_up_last: bool,
) -> WakeDecision {
    if scheduled_for > woke_at {
        WakeDecision::Wait
    } else if catch_up_last {
        WakeDecision::RunOnce
    } else {
        WakeDecision::RecordMissed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeDecision {
    Wait,
    RunOnce,
    RecordMissed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchedulerEvent {
    RunSource { source_id: String },
    Missed { source_id: String },
}

pub fn process_due_triggers(
    triggers: &mut [TriggerDefinition],
    now: DateTime<Utc>,
    resumed_or_started: bool,
) -> Result<Vec<SchedulerEvent>, ScheduleError> {
    let mut events = Vec::new();
    for trigger in triggers.iter_mut().filter(|trigger| trigger.enabled) {
        let Some(schedule) = trigger.schedule.as_ref() else {
            continue;
        };
        let Some(scheduled_for) = trigger.next_run_at else {
            trigger.next_run_at = schedule.next_after(now)?;
            continue;
        };
        if scheduled_for > now {
            continue;
        }
        if resumed_or_started && !trigger.catch_up_last {
            events.push(SchedulerEvent::Missed {
                source_id: trigger.source_id.clone(),
            });
        } else {
            events.push(SchedulerEvent::RunSource {
                source_id: trigger.source_id.clone(),
            });
            trigger.last_run_at = Some(now);
        }
        trigger.next_run_at = schedule.next_after(now)?;
    }
    Ok(events)
}

fn next_guided(
    after: DateTime<Utc>,
    hour: u32,
    minute: u32,
    timezone: &str,
    day_matches: impl Fn(u32) -> bool,
) -> Result<Option<DateTime<Utc>>, ScheduleError> {
    if hour > 23 || minute > 59 {
        return Err(ScheduleError::InvalidTime);
    }
    let timezone = parse_timezone(timezone)?;
    let start = after.with_timezone(&timezone).date_naive();
    for offset in 0..=370 {
        let date = start + Duration::days(offset);
        if !day_matches(date.weekday().number_from_monday()) {
            continue;
        }
        let candidate =
            timezone.with_ymd_and_hms(date.year(), date.month(), date.day(), hour, minute, 0);
        let candidate = match candidate {
            LocalResult::Single(value) => Some(value),
            LocalResult::Ambiguous(first, _) => Some(first),
            LocalResult::None => None,
        };
        if let Some(candidate) = candidate {
            let candidate = candidate.with_timezone(&Utc);
            if candidate > after {
                return Ok(Some(candidate));
            }
        }
    }
    Ok(None)
}

fn parse_timezone(value: &str) -> Result<Tz, ScheduleError> {
    value
        .parse()
        .map_err(|_| ScheduleError::InvalidTimezone(value.to_owned()))
}
