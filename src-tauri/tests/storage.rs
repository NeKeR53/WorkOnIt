use tempfile::tempdir;
use workonit_lib::{
    domain::{Board, WipPolicy},
    storage::Store,
};

#[test]
fn saved_board_survives_store_reopen() {
    let directory = tempdir().expect("temporary directory");
    let database = directory.path().join("workonit.db");
    let board_id;

    {
        let store = Store::open(&database).expect("store opens");
        let mut board = Board::new("Produit");
        let inbox = board.add_column("Entrée", WipPolicy::None);
        board.add_task("Qualifier", &inbox).expect("task created");
        board_id = board.id.clone();
        store.save_board(&board).expect("board saved");
    }

    let reopened = Store::open(&database).expect("store reopens");
    let loaded = reopened
        .get_board(&board_id)
        .expect("board query succeeds")
        .expect("board exists");

    assert_eq!(loaded.name, "Produit");
    assert_eq!(loaded.tasks[0].title, "Qualifier");
}
