use workonit_lib::{
    automation::CommandAction,
    domain::{Board, WipPolicy},
    exchange::{export_bundle, import_bundle, ExportBundle},
};

#[test]
fn imported_shell_actions_require_fresh_trust() {
    let mut board = Board::new("Release");
    board.add_column("À faire", WipPolicy::None);
    let mut action = CommandAction::shell("Publier", "deploy");
    action.enabled = true;
    let bytes = export_bundle(&ExportBundle {
        boards: vec![board],
        actions: vec![action],
    })
    .expect("export succeeds");

    let imported = import_bundle(&bytes).expect("import succeeds");

    assert_eq!(imported.manifest.format_version, 1);
    assert_eq!(imported.bundle.boards[0].name, "Release");
    assert!(!imported.bundle.actions[0].enabled);
    assert_eq!(imported.trust_required_actions.len(), 1);
}
