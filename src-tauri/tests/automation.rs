use workonit_lib::{
    automation::{ActionChain, ChainStatus, CommandAction},
    domain::{Board, WipPolicy},
};

#[test]
fn action_chain_receives_task_data_and_stops_on_failure() {
    let mut board = Board::new("Livraison");
    let column = board.add_column("Prêt", WipPolicy::None);
    let task_id = board
        .add_task("Version 1.0", &column)
        .expect("task created");
    let task = board.tasks.iter().find(|task| task.id == task_id).unwrap();
    let actions = vec![
        CommandAction::shell("Lire le titre", "printf '%s' \"$WORKONIT_TITLE\""),
        CommandAction::shell("Échouer", "printf 'incident' >&2; exit 7"),
        CommandAction::shell("Ne doit pas tourner", "printf 'unexpected'"),
    ];

    let execution = ActionChain::new(actions).run(task, 0);

    assert_eq!(execution.status, ChainStatus::Failed);
    assert_eq!(execution.failed_step, Some(1));
    assert_eq!(execution.steps.len(), 2);
    assert_eq!(execution.steps[0].stdout, "Version 1.0");
    assert_eq!(execution.steps[1].exit_code, Some(7));
    assert_eq!(execution.steps[1].stderr, "incident");
}
