use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "limit", rename_all = "camelCase")]
pub enum WipPolicy {
    None,
    Warning(u32),
    Hard(u32),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransitionOrigin {
    User,
    Source,
    Plugin,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    Idle,
    Pending,
    Running { step: u32, total: u32 },
    Failed,
    Succeeded,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    Text,
    Number,
    Boolean,
    Date,
    List { options: Vec<String> },
    Secret,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldDefinition {
    pub id: String,
    pub name: String,
    pub kind: FieldKind,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: u32,
    pub wip_policy: WipPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionRule {
    pub from_column_id: String,
    pub to_column_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionRecord {
    pub from_column_id: String,
    pub to_column_id: String,
    pub origin: TransitionOrigin,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub column_id: String,
    pub position: u32,
    pub tags: Vec<String>,
    pub notes: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub source_name: Option<String>,
    pub external_key: Option<String>,
    pub custom_values: BTreeMap<String, Value>,
    pub execution_status: ExecutionStatus,
    pub history: Vec<TransitionRecord>,
    pub archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub columns: Vec<Column>,
    pub tasks: Vec<Task>,
    pub custom_fields: Vec<CustomFieldDefinition>,
    pub transitions_restricted: bool,
    pub allowed_transitions: Vec<TransitionRule>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    #[error("Kanban introuvable")]
    BoardNotFound,
    #[error("Colonne introuvable")]
    ColumnNotFound,
    #[error("Tâche introuvable")]
    TaskNotFound,
    #[error("La transition vers « {0} » n’est pas autorisée")]
    ForbiddenTransition(String),
    #[error("La limite de {limit} tâche{plural} de « {column} » est atteinte")]
    HardWipLimit {
        limit: u32,
        plural: &'static str,
        column: String,
    },
    #[error("Le titre est obligatoire")]
    EmptyTitle,
    #[error("Une colonne contenant des tâches ne peut pas être supprimée")]
    ColumnNotEmpty,
}

impl Board {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            columns: Vec::new(),
            tasks: Vec::new(),
            custom_fields: Vec::new(),
            transitions_restricted: false,
            allowed_transitions: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn starter(name: impl Into<String>) -> Self {
        let mut board = Self::new(name);
        board.add_column("À faire", WipPolicy::None);
        board.add_column("En cours", WipPolicy::Warning(5));
        board.add_column("Terminé", WipPolicy::None);
        board
    }

    pub fn add_column(&mut self, name: impl Into<String>, wip_policy: WipPolicy) -> String {
        let id = Uuid::new_v4().to_string();
        let colors = ["#65558f", "#006a6a", "#8c4a60", "#4f6354"];
        self.columns.push(Column {
            id: id.clone(),
            name: name.into(),
            color: colors[self.columns.len() % colors.len()].to_owned(),
            position: self.columns.len() as u32,
            wip_policy,
        });
        self.touch();
        id
    }

    pub fn add_task(
        &mut self,
        title: impl Into<String>,
        column_id: &str,
    ) -> Result<String, DomainError> {
        let title = title.into();
        if title.trim().is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        self.column(column_id)?;
        self.enforce_wip(column_id)?;
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let position = self
            .tasks
            .iter()
            .filter(|task| task.column_id == column_id && !task.archived)
            .count() as u32;
        self.tasks.push(Task {
            id: id.clone(),
            title: title.trim().to_owned(),
            description: String::new(),
            column_id: column_id.to_owned(),
            position,
            tags: Vec::new(),
            notes: String::new(),
            priority: None,
            due_date: None,
            source_name: None,
            external_key: None,
            custom_values: BTreeMap::new(),
            execution_status: ExecutionStatus::Idle,
            history: Vec::new(),
            archived: false,
            created_at: now,
            updated_at: now,
        });
        self.touch();
        Ok(id)
    }

    pub fn allow_transition(&mut self, from_column_id: &str, to_column_id: &str) {
        self.transitions_restricted = true;
        if !self
            .allowed_transitions
            .iter()
            .any(|rule| rule.from_column_id == from_column_id && rule.to_column_id == to_column_id)
        {
            self.allowed_transitions.push(TransitionRule {
                from_column_id: from_column_id.to_owned(),
                to_column_id: to_column_id.to_owned(),
            });
        }
        self.touch();
    }

    pub fn move_task(
        &mut self,
        task_id: &str,
        to_column_id: &str,
        origin: TransitionOrigin,
    ) -> Result<(), DomainError> {
        let to_column = self.column(to_column_id)?.clone();
        let from_column_id = self
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .ok_or(DomainError::TaskNotFound)?
            .column_id
            .clone();
        if from_column_id == to_column_id {
            return Ok(());
        }
        if self.transitions_restricted
            && !self.allowed_transitions.iter().any(|rule| {
                rule.from_column_id == from_column_id && rule.to_column_id == to_column_id
            })
        {
            return Err(DomainError::ForbiddenTransition(to_column.name));
        }
        self.enforce_wip(to_column_id)?;
        let position = self
            .tasks
            .iter()
            .filter(|task| task.column_id == to_column_id && !task.archived)
            .count() as u32;
        let now = Utc::now();
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or(DomainError::TaskNotFound)?;
        task.column_id = to_column_id.to_owned();
        task.position = position;
        task.updated_at = now;
        task.history.push(TransitionRecord {
            from_column_id,
            to_column_id: to_column_id.to_owned(),
            origin,
            occurred_at: now,
        });
        self.touch();
        Ok(())
    }

    pub fn update_task(&mut self, updated: Task) -> Result<(), DomainError> {
        if updated.title.trim().is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == updated.id)
            .ok_or(DomainError::TaskNotFound)?;
        let mut updated = updated;
        updated.updated_at = Utc::now();
        *task = updated;
        self.touch();
        Ok(())
    }

    pub fn archive_task(&mut self, task_id: &str) -> Result<(), DomainError> {
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or(DomainError::TaskNotFound)?;
        task.archived = true;
        task.updated_at = Utc::now();
        self.touch();
        Ok(())
    }

    pub fn remove_column(&mut self, column_id: &str) -> Result<(), DomainError> {
        if self
            .tasks
            .iter()
            .any(|task| task.column_id == column_id && !task.archived)
        {
            return Err(DomainError::ColumnNotEmpty);
        }
        let before = self.columns.len();
        self.columns.retain(|column| column.id != column_id);
        if before == self.columns.len() {
            return Err(DomainError::ColumnNotFound);
        }
        self.allowed_transitions
            .retain(|rule| rule.from_column_id != column_id && rule.to_column_id != column_id);
        self.touch();
        Ok(())
    }

    pub fn wip_warning(&self, column_id: &str) -> Option<String> {
        let column = self.column(column_id).ok()?;
        let count = self.active_count(column_id);
        match column.wip_policy {
            WipPolicy::Warning(limit) if count >= limit => Some(format!(
                "La limite conseillée de {limit} tâche{} est atteinte",
                if limit > 1 { "s" } else { "" }
            )),
            _ => None,
        }
    }

    fn column(&self, id: &str) -> Result<&Column, DomainError> {
        self.columns
            .iter()
            .find(|column| column.id == id)
            .ok_or(DomainError::ColumnNotFound)
    }

    fn active_count(&self, column_id: &str) -> u32 {
        self.tasks
            .iter()
            .filter(|task| task.column_id == column_id && !task.archived)
            .count() as u32
    }

    fn enforce_wip(&self, column_id: &str) -> Result<(), DomainError> {
        let column = self.column(column_id)?;
        if let WipPolicy::Hard(limit) = column.wip_policy {
            if self.active_count(column_id) >= limit {
                return Err(DomainError::HardWipLimit {
                    limit,
                    plural: if limit > 1 { "s" } else { "" },
                    column: column.name.clone(),
                });
            }
        }
        Ok(())
    }

    fn touch(&mut self) {
        self.updated_at = Utc::now();
    }
}
