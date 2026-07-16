use crate::{
    automation::{
        ActionChain, ActionExecutor, ChainExecution, ChainStatus, CommandAction, OperatingSystem,
        TransitionAutomation,
    },
    domain::Task,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDraft {
    pub automation_id: String,
    pub board_id: String,
    pub draft: TransitionAutomation,
    pub active: Option<TransitionAutomation>,
    pub revision: u32,
    pub tested_at: Option<DateTime<Utc>>,
    pub last_test_succeeded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreview {
    pub action_id: String,
    pub action_name: String,
    pub runner: String,
    pub script: String,
    pub working_directory: Option<String>,
    pub environment_variables: Vec<String>,
    pub secret_names: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DraftError {
    #[error("Action introuvable : {0}")]
    ActionMissing(String),
    #[error("Une confirmation explicite est obligatoire pour exécuter le test")]
    ConfirmationRequired,
    #[error("Le brouillon doit réussir un test avant activation")]
    SuccessfulTestRequired,
    #[error("Aucune variante compatible pour l’action : {0}")]
    IncompatibleAction(String),
}

impl AutomationDraft {
    pub fn new(mut automation: TransitionAutomation) -> Self {
        automation.enabled = false;
        Self {
            automation_id: automation.id.clone(),
            board_id: automation.board_id.clone(),
            draft: automation,
            active: None,
            revision: 1,
            tested_at: None,
            last_test_succeeded: false,
        }
    }

    pub fn edit(&mut self, mut automation: TransitionAutomation) {
        automation.enabled = false;
        self.draft = automation;
        self.revision = self.revision.saturating_add(1);
        self.tested_at = None;
        self.last_test_succeeded = false;
    }

    pub fn preview(&self, actions: &[CommandAction]) -> Result<Vec<CommandPreview>, DraftError> {
        let actions: HashMap<&str, &CommandAction> = actions
            .iter()
            .map(|action| (action.id.as_str(), action))
            .collect();
        self.draft
            .steps
            .iter()
            .map(|step| {
                let action = actions
                    .get(step.action_id.as_str())
                    .ok_or_else(|| DraftError::ActionMissing(step.action_id.clone()))?;
                let (runner, script) = action
                    .command_for(OperatingSystem::current())
                    .ok_or_else(|| DraftError::IncompatibleAction(action.name.clone()))?;
                Ok(CommandPreview {
                    action_id: action.id.clone(),
                    action_name: action.name.clone(),
                    runner: runner.into(),
                    script: script.into(),
                    working_directory: action.working_directory.clone(),
                    environment_variables: vec![
                        "WORKONIT_TASK_ID".into(),
                        "WORKONIT_TITLE".into(),
                        "WORKONIT_DESCRIPTION".into(),
                        "WORKONIT_COLUMN_ID".into(),
                    ],
                    secret_names: action.secret_names.clone(),
                })
            })
            .collect()
    }

    pub fn execute_test(
        &mut self,
        actions: &[CommandAction],
        task: &Task,
        confirmed: bool,
        executor: &impl ActionExecutor,
    ) -> Result<ChainExecution, DraftError> {
        if !confirmed {
            return Err(DraftError::ConfirmationRequired);
        }
        let library: HashMap<&str, &CommandAction> = actions
            .iter()
            .map(|action| (action.id.as_str(), action))
            .collect();
        let chain: Vec<CommandAction> = self
            .draft
            .steps
            .iter()
            .map(|step| {
                library
                    .get(step.action_id.as_str())
                    .map(|action| (*action).clone())
                    .ok_or_else(|| DraftError::ActionMissing(step.action_id.clone()))
            })
            .collect::<Result<_, _>>()?;
        let execution = ActionChain::new(chain).run_with_executor(task, 0, executor);
        self.tested_at = Some(Utc::now());
        self.last_test_succeeded = execution.status == ChainStatus::Succeeded;
        Ok(execution)
    }

    pub fn activate(&mut self) -> Result<TransitionAutomation, DraftError> {
        if self.tested_at.is_none() || !self.last_test_succeeded {
            return Err(DraftError::SuccessfulTestRequired);
        }
        let mut active = self.draft.clone();
        active.enabled = true;
        self.active = Some(active.clone());
        Ok(active)
    }
}
