pub mod automation;
pub mod domain;
pub mod exchange;
pub mod scheduler;
pub mod sources;
pub mod storage;

use automation::{ActionChain, ChainExecution, CommandAction};
use domain::{Board, TransitionOrigin};
use exchange::{
    export_bundle as create_export, import_bundle as read_import, ExportBundle, ImportResult,
};
use sources::{preview, FieldMapping, SourceFormat, SourcePreview};
use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};
use storage::Store;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State, WindowEvent,
};

struct AppState {
    store: Mutex<Store>,
}

fn locked_store<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Store>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Base de données indisponible".to_owned())
}

#[tauri::command]
fn list_boards(state: State<'_, AppState>) -> Result<Vec<Board>, String> {
    locked_store(&state)?
        .list_boards()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_board(board: Board, state: State<'_, AppState>) -> Result<(), String> {
    locked_store(&state)?
        .save_board(&board)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_board(name: String, state: State<'_, AppState>) -> Result<Board, String> {
    if name.trim().is_empty() {
        return Err("Le nom du kanban est obligatoire".into());
    }
    let board = Board::starter(name.trim());
    locked_store(&state)?
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn add_task(
    board_id: String,
    column_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .add_task(title, &column_id)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn move_task(
    board_id: String,
    task_id: String,
    column_id: String,
    origin: TransitionOrigin,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let store = locked_store(&state)?;
    let mut board = store
        .get_board(&board_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Kanban introuvable".to_owned())?;
    board
        .move_task(&task_id, &column_id, origin)
        .map_err(|error| error.to_string())?;
    store
        .save_board(&board)
        .map_err(|error| error.to_string())?;
    Ok(board)
}

#[tauri::command]
fn preview_source(
    format: SourceFormat,
    input: String,
    mapping: FieldMapping,
    text_pattern: Option<String>,
) -> SourcePreview {
    preview(format, &input, &mapping, text_pattern.as_deref())
}

#[tauri::command]
fn run_action_chain(
    task: domain::Task,
    actions: Vec<CommandAction>,
    start_at: Option<usize>,
) -> ChainExecution {
    ActionChain::new(actions).run(&task, start_at.unwrap_or(0))
}

#[tauri::command]
fn export_bundle(bundle: ExportBundle) -> Result<Vec<u8>, String> {
    create_export(&bundle).map_err(|error| error.to_string())
}

#[tauri::command]
fn import_bundle(bytes: Vec<u8>) -> Result<ImportResult, String> {
    read_import(&bytes).map_err(|error| error.to_string())
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    Ok(directory.join("workonit.db"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let store = Store::open(database_path(app.handle())?)?;
            app.manage(AppState {
                store: Mutex::new(store),
            });
            let show = MenuItem::with_id(app, "show", "Afficher WorkOnIt", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter WorkOnIt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_boards,
            save_board,
            create_board,
            add_task,
            move_task,
            preview_source,
            run_action_chain,
            export_bundle,
            import_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WorkOnIt");
}
