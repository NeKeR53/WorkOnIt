use chrono::Utc;
use workonit_lib::{
    automation::{
        ActionExecutor, ActionStep, CommandAction, CommandVariant, OperatingSystem, StepExecution,
        StepStatus, TransitionAutomation,
    },
    domain::{Board, WipPolicy},
    drafts::{AutomationDraft, DraftError},
};

struct SuccessExecutor;
impl ActionExecutor for SuccessExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: StepStatus::Succeeded,
            exit_code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
            started_at: Utc::now(),
            finished_at: Utc::now(),
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_bytes: Vec::new(),
            stderr_bytes: Vec::new(),
        }
    }
}

struct FailureExecutor;
impl ActionExecutor for FailureExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        let mut step = SuccessExecutor.execute(action, _task);
        step.status = StepStatus::Failed;
        step
    }
}

#[test]
fn draft_preview_test_and_activation_preserve_previous_active_version() {
    let mut board = Board::new("Projet");
    let from = board.add_column("A", WipPolicy::None);
    let to = board.add_column("B", WipPolicy::None);
    let task_id = board.add_task("Tester", &from).unwrap();
    let action = CommandAction::shell("Publier", "printf ok");
    let automation =
        TransitionAutomation::new(&board.id, Some(from), to, vec![ActionStep::new(&action.id)]);
    let mut draft = AutomationDraft::new(automation);

    assert_eq!(
        draft.preview(std::slice::from_ref(&action)).unwrap()[0].script,
        "printf ok"
    );
    assert!(matches!(
        draft.execute_test(
            std::slice::from_ref(&action),
            &board.tasks[0],
            false,
            &SuccessExecutor,
        ),
        Err(DraftError::ConfirmationRequired)
    ));
    assert!(matches!(
        draft.activate(),
        Err(DraftError::SuccessfulTestRequired)
    ));
    draft
        .execute_test(
            std::slice::from_ref(&action),
            &board.tasks[0],
            true,
            &SuccessExecutor,
        )
        .unwrap();
    let first_active = draft.activate().unwrap();
    let mut changed = draft.draft.clone();
    changed.name = "Nouvelle version".into();
    draft.edit(changed);

    assert_eq!(draft.active.as_ref().unwrap().id, first_active.id);
    assert_eq!(draft.active.as_ref().unwrap().name, first_active.name);
    assert_eq!(draft.automation_id, first_active.id);
    assert_eq!(task_id, board.tasks[0].id);
}

#[test]
fn draft_reports_missing_and_incompatible_actions_and_requires_success_after_edits() {
    let mut board = Board::starter("Draft errors");
    board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    let missing_id = "missing".to_owned();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[1].id,
        vec![ActionStep::new(&missing_id)],
    );
    let mut draft = AutomationDraft::new(automation);
    assert_eq!(
        draft.preview(&[]),
        Err(DraftError::ActionMissing(missing_id.clone()))
    );
    assert!(matches!(
        draft.execute_test(&[], &board.tasks[0], true, &SuccessExecutor),
        Err(DraftError::ActionMissing(_))
    ));

    let current = OperatingSystem::current();
    let other = if current == OperatingSystem::Windows {
        OperatingSystem::MacOs
    } else {
        OperatingSystem::Windows
    };
    let mut incompatible = CommandAction::shell("Other", "ignored");
    incompatible.variants = vec![CommandVariant {
        operating_system: other,
        runner: "none".into(),
        script: "none".into(),
    }];
    draft.draft.steps = vec![ActionStep::new(&incompatible.id)];
    assert_eq!(
        draft.preview(&[incompatible.clone()]),
        Err(DraftError::IncompatibleAction("Other".into()))
    );

    let action = CommandAction::shell("Fail", "fail");
    draft.draft.steps = vec![ActionStep::new(&action.id)];
    let execution = draft
        .execute_test(&[action], &board.tasks[0], true, &FailureExecutor)
        .unwrap();
    assert_eq!(
        execution.status,
        workonit_lib::automation::ChainStatus::Failed
    );
    assert!(matches!(
        draft.activate(),
        Err(DraftError::SuccessfulTestRequired)
    ));
}
