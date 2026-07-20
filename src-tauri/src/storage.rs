use crate::{
    automation::{CommandAction, ExecutionRecord, TransitionAutomation},
    domain::{
        Board, CardDisplayPreferences, Column, CustomFieldDefinition, ExecutionStatus, Task,
        TransitionRule, WipPolicy,
    },
    drafts::AutomationDraft,
    scheduler::TriggerDefinition,
    sources::SourceDefinition,
};
use rusqlite::{params, Connection, DatabaseName, OptionalExtension};
use std::path::{Path, PathBuf};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 8;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("Erreur SQLite : {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Données invalides : {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Migration inconnue : version {0}")]
    UnsupportedSchema(i64),
    #[error("Erreur de fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("Date invalide : {0}")]
    Date(#[from] chrono::ParseError),
    #[error("Enregistrement introuvable : {0}")]
    MissingRecord(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupKind {
    Daily,
    Weekly,
    PreImport,
    PreMigration,
}

impl BackupKind {
    fn prefix(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::PreImport => "pre-import",
            Self::PreMigration => "pre-migration",
        }
    }
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let path = path.as_ref();
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let mut store = Self { connection };
        let version: i64 = store
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 0 && version < SCHEMA_VERSION {
            if let Some(parent) = path.parent() {
                store.create_backup(parent.join("backups"), BackupKind::PreMigration)?;
            }
        }
        store.migrate()?;
        Ok(store)
    }

    pub fn in_memory() -> Result<Self, StorageError> {
        let connection = Connection::open_in_memory()?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let mut store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    pub fn save_board(&self, board: &Board) -> Result<(), StorageError> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO boards (id, name, data, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                board.id,
                board.name,
                serde_json::to_string(&board.card_display)?,
                board.created_at.to_rfc3339(),
                board.updated_at.to_rfc3339(),
            ],
        )?;
        transaction.execute("DELETE FROM tasks WHERE board_id = ?1", [&board.id])?;
        transaction.execute("DELETE FROM custom_fields WHERE board_id = ?1", [&board.id])?;
        transaction.execute(
            "DELETE FROM transition_rules WHERE board_id = ?1",
            [&board.id],
        )?;
        transaction.execute("DELETE FROM board_columns WHERE board_id = ?1", [&board.id])?;
        for column in &board.columns {
            transaction.execute(
                "INSERT INTO board_columns
                   (id, board_id, name, color, position, wip_policy)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    column.id,
                    board.id,
                    column.name,
                    column.color,
                    column.position,
                    serde_json::to_string(&column.wip_policy)?,
                ],
            )?;
        }
        for task in &board.tasks {
            transaction.execute(
                "INSERT INTO tasks
                   (id, board_id, title, description, column_id, position, tags, notes,
                    priority, due_date, source_id, source_name, external_key, source_absence_count,
                    absent_from_source, custom_values,
                    execution_status, history, archived, created_at, updated_at)
                 VALUES
                   (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                params![
                    task.id,
                    board.id,
                    task.title,
                    task.description,
                    task.column_id,
                    task.position,
                    serde_json::to_string(&task.tags)?,
                    task.notes,
                    task.priority,
                    task.due_date,
                    task.source_id,
                    task.source_name,
                    task.external_key,
                    task.source_absence_count,
                    task.absent_from_source,
                    serde_json::to_string(&task.custom_values)?,
                    serde_json::to_string(&task.execution_status)?,
                    serde_json::to_string(&task.history)?,
                    task.archived,
                    task.created_at.to_rfc3339(),
                    task.updated_at.to_rfc3339(),
                ],
            )?;
        }
        for field in &board.custom_fields {
            transaction.execute(
                "INSERT INTO custom_fields (id, board_id, data) VALUES (?1, ?2, ?3)",
                params![field.id, board.id, serde_json::to_string(field)?],
            )?;
        }
        for rule in &board.allowed_transitions {
            transaction.execute(
                "INSERT INTO transition_rules (board_id, from_column_id, to_column_id)
                 VALUES (?1, ?2, ?3)",
                params![board.id, rule.from_column_id, rule.to_column_id],
            )?;
        }
        let has_source_ids = transaction
            .prepare("SELECT 1 FROM pragma_table_info('board_settings') WHERE name = 'source_ids'")?
            .exists([])?;
        if has_source_ids {
            transaction.execute(
                "INSERT INTO board_settings (board_id, transitions_restricted, source_ids)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(board_id) DO UPDATE SET
                   transitions_restricted = excluded.transitions_restricted,
                   source_ids = excluded.source_ids",
                params![
                    board.id,
                    board.transitions_restricted,
                    serde_json::to_string(&board.source_ids)?,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO board_settings (board_id, transitions_restricted)
                 VALUES (?1, ?2)
                 ON CONFLICT(board_id) DO UPDATE SET
                   transitions_restricted = excluded.transitions_restricted",
                params![board.id, board.transitions_restricted],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn get_board(&self, id: &str) -> Result<Option<Board>, StorageError> {
        let metadata: Option<(String, String, String, String)> = self
            .connection
            .query_row(
                "SELECT name, data, created_at, updated_at FROM boards WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let Some((name, card_display, created_at, updated_at)) = metadata else {
            return Ok(None);
        };
        let columns = {
            let mut statement = self.connection.prepare(
                "SELECT id, name, color, position, wip_policy
                 FROM board_columns WHERE board_id = ?1 ORDER BY position",
            )?;
            let rows = statement.query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            let mut columns = Vec::new();
            for row in rows {
                let (id, name, color, position, wip_policy) = row?;
                columns.push(Column {
                    id,
                    name,
                    color,
                    position,
                    wip_policy: serde_json::from_str::<WipPolicy>(&wip_policy)?,
                });
            }
            columns
        };
        let tasks = {
            let mut statement = self.connection.prepare(
                "SELECT id, title, description, column_id, position, tags, notes, priority,
                        due_date, source_id, source_name, external_key, source_absence_count,
                        absent_from_source, custom_values, execution_status,
                        history, archived, created_at, updated_at
                 FROM tasks WHERE board_id = ?1 ORDER BY column_id, position",
            )?;
            let rows = statement.query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, u32>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, u32>(12)?,
                    row.get::<_, bool>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, String>(15)?,
                    row.get::<_, String>(16)?,
                    row.get::<_, bool>(17)?,
                    row.get::<_, String>(18)?,
                    row.get::<_, String>(19)?,
                ))
            })?;
            let mut tasks = Vec::new();
            for row in rows {
                let (
                    id,
                    title,
                    description,
                    column_id,
                    position,
                    tags,
                    notes,
                    priority,
                    due_date,
                    source_id,
                    source_name,
                    external_key,
                    source_absence_count,
                    absent_from_source,
                    custom_values,
                    execution_status,
                    history,
                    archived,
                    created_at,
                    updated_at,
                ) = row?;
                tasks.push(Task {
                    id,
                    title,
                    description,
                    column_id,
                    position,
                    tags: serde_json::from_str(&tags)?,
                    notes,
                    priority,
                    due_date,
                    source_id,
                    source_name,
                    external_key,
                    source_absence_count,
                    absent_from_source,
                    custom_values: serde_json::from_str(&custom_values)?,
                    execution_status: serde_json::from_str(&execution_status)?,
                    history: serde_json::from_str(&history)?,
                    archived,
                    created_at: parse_date(&created_at)?,
                    updated_at: parse_date(&updated_at)?,
                });
            }
            tasks
        };
        let custom_fields = {
            let mut statement = self
                .connection
                .prepare("SELECT data FROM custom_fields WHERE board_id = ?1 ORDER BY rowid")?;
            let rows = statement.query_map([id], |row| row.get::<_, String>(0))?;
            deserialize_rows::<CustomFieldDefinition, _>(rows)?
        };
        let allowed_transitions = {
            let mut statement = self.connection.prepare(
                "SELECT from_column_id, to_column_id FROM transition_rules
                 WHERE board_id = ?1 ORDER BY rowid",
            )?;
            let rows = statement.query_map([id], |row| {
                Ok(TransitionRule {
                    from_column_id: row.get(0)?,
                    to_column_id: row.get(1)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let (transitions_restricted, source_ids) = self
            .connection
            .query_row(
                "SELECT transitions_restricted, source_ids FROM board_settings WHERE board_id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .unwrap_or((false, "[]".to_owned()));
        Ok(Some(Board {
            id: id.to_owned(),
            name,
            source_ids: serde_json::from_str(&source_ids)?,
            columns,
            tasks,
            custom_fields,
            transitions_restricted,
            allowed_transitions,
            card_display: serde_json::from_str::<CardDisplayPreferences>(&card_display)
                .unwrap_or_default(),
            created_at: parse_date(&created_at)?,
            updated_at: parse_date(&updated_at)?,
        }))
    }

    pub fn list_boards(&self) -> Result<Vec<Board>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT id FROM boards ORDER BY updated_at DESC")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut boards = Vec::new();
        for row in rows {
            if let Some(board) = self.get_board(&row?)? {
                boards.push(board);
            }
        }
        Ok(boards)
    }

    pub fn delete_board(&self, id: &str) -> Result<bool, StorageError> {
        Ok(self
            .connection
            .execute("DELETE FROM boards WHERE id = ?1", [id])?
            > 0)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        Ok(self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn save_action(&self, action: &CommandAction) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO actions (id, name, enabled, data, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               enabled = excluded.enabled,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                action.id,
                action.name,
                action.enabled,
                serde_json::to_string(action)?,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_actions(&self) -> Result<Vec<CommandAction>, StorageError> {
        self.list_json("SELECT data FROM actions ORDER BY name")
    }

    pub fn save_transition_automation(
        &self,
        automation: &TransitionAutomation,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO transition_automations (id, board_id, enabled, data, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               board_id = excluded.board_id,
               enabled = excluded.enabled,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                automation.id,
                automation.board_id,
                automation.enabled,
                serde_json::to_string(automation)?,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_transition_automations(
        &self,
        board_id: &str,
    ) -> Result<Vec<TransitionAutomation>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT data FROM transition_automations WHERE board_id = ?1 ORDER BY updated_at",
        )?;
        let rows = statement.query_map([board_id], |row| row.get::<_, String>(0))?;
        deserialize_rows(rows)
    }

    pub fn save_automation_draft(&self, draft: &AutomationDraft) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO automation_drafts (automation_id, board_id, data, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(automation_id) DO UPDATE SET
               board_id = excluded.board_id,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                draft.automation_id,
                draft.board_id,
                serde_json::to_string(draft)?,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_automation_draft(
        &self,
        automation_id: &str,
    ) -> Result<Option<AutomationDraft>, StorageError> {
        let data: Option<String> = self
            .connection
            .query_row(
                "SELECT data FROM automation_drafts WHERE automation_id = ?1",
                [automation_id],
                |row| row.get(0),
            )
            .optional()?;
        data.map(|value| serde_json::from_str(&value).map_err(StorageError::from))
            .transpose()
    }

    pub fn list_automation_drafts(
        &self,
        board_id: &str,
    ) -> Result<Vec<AutomationDraft>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT data FROM automation_drafts WHERE board_id = ?1 ORDER BY updated_at",
        )?;
        let rows = statement.query_map([board_id], |row| row.get::<_, String>(0))?;
        deserialize_rows(rows)
    }

    pub fn save_execution(&self, execution: &ExecutionRecord) -> Result<(), StorageError> {
        let (stdout, stderr) = execution.steps.iter().fold(
            (String::new(), String::new()),
            |(mut stdout, mut stderr), step| {
                stdout.push_str(&step.stdout);
                stderr.push_str(&step.stderr);
                (stdout, stderr)
            },
        );
        self.connection.execute(
            "INSERT INTO executions
               (id, task_id, automation_id, status, stdout, stderr, started_at, finished_at, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               status = excluded.status,
               stdout = excluded.stdout,
               stderr = excluded.stderr,
               finished_at = excluded.finished_at,
               data = excluded.data",
            params![
                execution.id,
                execution.task_id,
                execution.automation_ids.first(),
                execution_status_name(&execution.status),
                stdout,
                stderr,
                execution.started_at.to_rfc3339(),
                execution.finished_at.map(|date| date.to_rfc3339()),
                serde_json::to_string(execution)?,
            ],
        )?;
        Ok(())
    }

    pub fn save_source(&self, source: &SourceDefinition) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO sources (id, board_id, name, enabled, data, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               board_id = excluded.board_id,
               name = excluded.name,
               enabled = excluded.enabled,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                source.id,
                source.board_id,
                source.name,
                source.enabled,
                serde_json::to_string(source)?,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_sources(&self, board_id: &str) -> Result<Vec<SourceDefinition>, StorageError> {
        let Some(board) = self.get_board(board_id)? else {
            return Ok(Vec::new());
        };
        let initial_column_id = board
            .columns
            .first()
            .map(|column| column.id.clone())
            .unwrap_or_default();
        Ok(self
            .list_all_sources()?
            .into_iter()
            .filter(|source| board.source_ids.contains(&source.id))
            .map(|mut source| {
                source.board_id = board_id.to_owned();
                if source.initial_column_id.is_empty() {
                    source.initial_column_id = initial_column_id.clone();
                }
                source
            })
            .collect())
    }

    pub fn list_all_sources(&self) -> Result<Vec<SourceDefinition>, StorageError> {
        self.list_json("SELECT data FROM sources ORDER BY name")
    }

    pub fn delete_source(&self, source_id: &str) -> Result<(), StorageError> {
        self.connection
            .execute("DELETE FROM sources WHERE id = ?1", [source_id])?;
        Ok(())
    }

    pub fn get_source(&self, source_id: &str) -> Result<Option<SourceDefinition>, StorageError> {
        let data = self
            .connection
            .query_row(
                "SELECT data FROM sources WHERE id = ?1",
                [source_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        data.map(|value| serde_json::from_str(&value).map_err(StorageError::from))
            .transpose()
    }

    pub fn save_trigger(&self, trigger: &TriggerDefinition) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO triggers (id, source_id, enabled, data, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               source_id = excluded.source_id,
               enabled = excluded.enabled,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                trigger.id,
                trigger.source_id,
                trigger.enabled,
                serde_json::to_string(trigger)?,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_triggers(&self, source_id: &str) -> Result<Vec<TriggerDefinition>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT data FROM triggers WHERE source_id = ?1 ORDER BY updated_at")?;
        let rows = statement.query_map([source_id], |row| row.get::<_, String>(0))?;
        deserialize_rows(rows)
    }

    pub fn list_all_triggers(&self) -> Result<Vec<TriggerDefinition>, StorageError> {
        self.list_json("SELECT data FROM triggers ORDER BY updated_at")
    }

    pub fn list_executions(&self) -> Result<Vec<ExecutionRecord>, StorageError> {
        self.list_json(
            "SELECT data FROM executions WHERE data IS NOT NULL ORDER BY started_at DESC",
        )
    }

    pub fn get_execution(&self, id: &str) -> Result<Option<ExecutionRecord>, StorageError> {
        let data: Option<String> = self
            .connection
            .query_row(
                "SELECT data FROM executions WHERE id = ?1 AND data IS NOT NULL",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        data.map(|value| serde_json::from_str(&value).map_err(StorageError::from))
            .transpose()
    }

    pub fn recover_interrupted_executions(&self) -> Result<usize, StorageError> {
        let running: Vec<ExecutionRecord> = {
            let mut statement = self.connection.prepare(
                "SELECT data FROM executions WHERE status = 'running' AND data IS NOT NULL",
            )?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            deserialize_rows(rows)?
        };
        let recovered = running.len();
        for mut execution in running {
            execution.status = ExecutionStatus::Interrupted;
            execution.failed_step = Some(execution.steps.len());
            execution.finished_at = Some(chrono::Utc::now());
            self.save_execution(&execution)?;
        }
        Ok(recovered)
    }

    pub fn create_backup(
        &self,
        directory: impl AsRef<Path>,
        kind: BackupKind,
    ) -> Result<PathBuf, StorageError> {
        std::fs::create_dir_all(directory.as_ref())?;
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ");
        let path = directory
            .as_ref()
            .join(format!("{}-{timestamp}.sqlite", kind.prefix()));
        self.connection.backup(DatabaseName::Main, &path, None)?;
        Ok(path)
    }

    pub fn prune_backups(
        directory: impl AsRef<Path>,
        daily_to_keep: usize,
        weekly_to_keep: usize,
    ) -> Result<Vec<PathBuf>, StorageError> {
        let mut daily = Vec::new();
        let mut weekly = Vec::new();
        for entry in std::fs::read_dir(directory.as_ref())? {
            let path = entry?.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if name.starts_with("daily-") && name.ends_with(".sqlite") {
                daily.push(path);
            } else if name.starts_with("weekly-") && name.ends_with(".sqlite") {
                weekly.push(path);
            }
        }
        daily.sort();
        weekly.sort();
        let mut removed = Vec::new();
        for path in daily
            .into_iter()
            .rev()
            .skip(daily_to_keep)
            .chain(weekly.into_iter().rev().skip(weekly_to_keep))
        {
            std::fs::remove_file(&path)?;
            removed.push(path);
        }
        Ok(removed)
    }

    pub fn restore_backup(&mut self, path: impl AsRef<Path>) -> Result<(), StorageError> {
        self.connection.restore(
            DatabaseName::Main,
            path,
            None::<fn(rusqlite::backup::Progress)>,
        )?;
        self.migrate()?;
        Ok(())
    }

    fn list_json<T: serde::de::DeserializeOwned>(
        &self,
        query: &str,
    ) -> Result<Vec<T>, StorageError> {
        let mut statement = self.connection.prepare(query)?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        deserialize_rows(rows)
    }

    fn migrate(&mut self) -> Result<(), StorageError> {
        let mut version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema(version));
        }
        if version == 0 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE boards (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   data TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE TABLE settings (
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL
                 );
                 CREATE TABLE automations (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   kind TEXT NOT NULL,
                   enabled INTEGER NOT NULL DEFAULT 0,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );
                 CREATE TABLE executions (
                   id TEXT PRIMARY KEY,
                   task_id TEXT,
                   automation_id TEXT,
                   status TEXT NOT NULL,
                   stdout TEXT NOT NULL DEFAULT '',
                   stderr TEXT NOT NULL DEFAULT '',
                   started_at TEXT NOT NULL,
                   finished_at TEXT
                 );",
            )?;
            transaction.pragma_update(None, "user_version", 1)?;
            transaction.commit()?;
            version = 1;
        }
        if version == 1 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "ALTER TABLE executions ADD COLUMN data TEXT;
                 CREATE TABLE actions (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   enabled INTEGER NOT NULL DEFAULT 0,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE TABLE transition_automations (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   enabled INTEGER NOT NULL DEFAULT 0,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );",
            )?;
            transaction.pragma_update(None, "user_version", 2)?;
            transaction.commit()?;
            version = 2;
        }
        if version == 2 {
            let legacy_boards = {
                let mut statement = self
                    .connection
                    .prepare("SELECT data FROM boards WHERE data <> '{}'")?;
                let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
                deserialize_rows::<Board, _>(rows)?
            };
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE board_columns (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   name TEXT NOT NULL,
                   color TEXT NOT NULL,
                   position INTEGER NOT NULL,
                   wip_policy TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );
                 CREATE TABLE tasks (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   title TEXT NOT NULL,
                   description TEXT NOT NULL,
                   column_id TEXT NOT NULL,
                   position INTEGER NOT NULL,
                   tags TEXT NOT NULL,
                   notes TEXT NOT NULL,
                   priority TEXT,
                   due_date TEXT,
                   source_name TEXT,
                   external_key TEXT,
                   custom_values TEXT NOT NULL,
                   execution_status TEXT NOT NULL,
                   history TEXT NOT NULL,
                   archived INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE,
                   FOREIGN KEY(column_id) REFERENCES board_columns(id)
                 );
                 CREATE INDEX tasks_board_column_position
                   ON tasks(board_id, column_id, position);
                 CREATE INDEX tasks_external_key ON tasks(board_id, external_key);
                 CREATE TABLE custom_fields (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   data TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );
                 CREATE TABLE transition_rules (
                   board_id TEXT NOT NULL,
                   from_column_id TEXT NOT NULL,
                   to_column_id TEXT NOT NULL,
                   PRIMARY KEY(board_id, from_column_id, to_column_id),
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );
                 CREATE TABLE board_settings (
                   board_id TEXT PRIMARY KEY,
                   transitions_restricted INTEGER NOT NULL DEFAULT 0,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );",
            )?;
            transaction.pragma_update(None, "user_version", 3)?;
            transaction.commit()?;
            for board in legacy_boards {
                self.save_board(&board)?;
            }
            version = 3;
        }
        if version == 3 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE sources (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   name TEXT NOT NULL,
                   enabled INTEGER NOT NULL DEFAULT 0,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );
                 CREATE TABLE triggers (
                   id TEXT PRIMARY KEY,
                   source_id TEXT NOT NULL,
                   enabled INTEGER NOT NULL DEFAULT 0,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
                 );",
            )?;
            transaction.pragma_update(None, "user_version", 4)?;
            transaction.commit()?;
            version = 4;
        }
        if version == 4 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "ALTER TABLE tasks ADD COLUMN source_absence_count INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE tasks ADD COLUMN absent_from_source INTEGER NOT NULL DEFAULT 0;",
            )?;
            transaction.pragma_update(None, "user_version", 5)?;
            transaction.commit()?;
            version = 5;
        }
        if version == 5 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE automation_drafts (
                   automation_id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
                 );",
            )?;
            transaction.pragma_update(None, "user_version", 6)?;
            transaction.commit()?;
            version = 6;
        }
        if version == 6 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "ALTER TABLE tasks ADD COLUMN source_id TEXT;
                 UPDATE tasks
                 SET source_id = (
                   SELECT sources.id FROM sources
                   WHERE sources.board_id = tasks.board_id
                     AND sources.name = tasks.source_name
                   LIMIT 1
                 )
                 WHERE source_name IS NOT NULL;",
            )?;
            transaction.pragma_update(None, "user_version", 7)?;
            transaction.commit()?;
            version = 7;
        }
        if version == 7 {
            self.connection.pragma_update(None, "foreign_keys", "OFF")?;
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "ALTER TABLE board_settings ADD COLUMN source_ids TEXT NOT NULL DEFAULT '[]';
                 UPDATE board_settings
                 SET source_ids = COALESCE(
                   (SELECT '[' || group_concat('\"' || sources.id || '\"', ',') || ']'
                    FROM sources WHERE sources.board_id = board_settings.board_id),
                   '[]'
                 );
                 CREATE TABLE sources_new (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL DEFAULT '',
                   name TEXT NOT NULL,
                   enabled INTEGER NOT NULL DEFAULT 0,
                   data TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 INSERT INTO sources_new SELECT * FROM sources;
                 UPDATE sources_new SET board_id = '', data = json_set(data, '$.boardId', '');
                 DROP TABLE sources;
                 ALTER TABLE sources_new RENAME TO sources;",
            )?;
            transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            transaction.commit()?;
            self.connection.pragma_update(None, "foreign_keys", "ON")?;
        }
        Ok(())
    }
}

fn deserialize_rows<T, I>(rows: I) -> Result<Vec<T>, StorageError>
where
    T: serde::de::DeserializeOwned,
    I: Iterator<Item = rusqlite::Result<String>>,
{
    let mut values = Vec::new();
    for row in rows {
        values.push(serde_json::from_str(&row?)?);
    }
    Ok(values)
}

fn execution_status_name(status: &ExecutionStatus) -> &'static str {
    match status {
        ExecutionStatus::Idle => "idle",
        ExecutionStatus::Pending => "pending",
        ExecutionStatus::Running { .. } => "running",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Succeeded => "succeeded",
        ExecutionStatus::Cancelled => "cancelled",
        ExecutionStatus::Interrupted => "interrupted",
    }
}

fn parse_date(value: &str) -> Result<chrono::DateTime<chrono::Utc>, chrono::ParseError> {
    Ok(chrono::DateTime::parse_from_rfc3339(value)?.with_timezone(&chrono::Utc))
}
