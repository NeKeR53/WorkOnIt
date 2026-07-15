use workonit_lib::domain::{Board, TransitionOrigin, WipPolicy};

#[test]
fn board_blocks_forbidden_transitions_and_hard_wip_limits() {
    let mut board = Board::new("Livraison");
    let todo = board.add_column("À faire", WipPolicy::None);
    let done = board.add_column("Terminé", WipPolicy::Hard(1));
    let task = board.add_task("Publier", &todo).expect("task created");
    board.allow_transition(&todo, &done);

    board
        .move_task(&task, &done, TransitionOrigin::User)
        .expect("allowed transition");
    let other = board.add_task("Documenter", &todo).expect("task created");
    let error = board
        .move_task(&other, &done, TransitionOrigin::User)
        .expect_err("hard limit must block");

    assert_eq!(
        error.to_string(),
        "La limite de 1 tâche de « Terminé » est atteinte"
    );
}
