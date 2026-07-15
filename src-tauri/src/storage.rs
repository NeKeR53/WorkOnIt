use crate::domain::Board;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use thiserror::Error;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("Erreur SQLite : {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Données invalides : {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Migration inconnue : version {0}")]
    UnsupportedSchema(i64),
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let mut store = Self { connection };
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
        let data = serde_json::to_string(board)?;
        self.connection.execute(
            "INSERT INTO boards (id, name, data, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               data = excluded.data,
               updated_at = excluded.updated_at",
            params![
                board.id,
                board.name,
                data,
                board.created_at.to_rfc3339(),
                board.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_board(&self, id: &str) -> Result<Option<Board>, StorageError> {
        let data: Option<String> = self
            .connection
            .query_row("SELECT data FROM boards WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        data.map(|value| serde_json::from_str(&value).map_err(StorageError::from))
            .transpose()
    }

    pub fn list_boards(&self) -> Result<Vec<Board>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT data FROM boards ORDER BY updated_at DESC")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut boards = Vec::new();
        for row in rows {
            boards.push(serde_json::from_str(&row?)?);
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

    fn migrate(&mut self) -> Result<(), StorageError> {
        let version: i64 = self
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
            transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            transaction.commit()?;
        }
        Ok(())
    }
}
