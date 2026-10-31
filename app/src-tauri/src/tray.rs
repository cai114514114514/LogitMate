use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// Menu ids the webview handles itself (sizing, model choice, about).
const FORWARDED: &[&str] = &["chat", "look", "focus", "agents", "size-s", "size-m", "size-l", "pick-model", "relearn", "forget", "about"];

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let chat = MenuItem::with_id(app, "chat", "Talk to Her…", true, None::<&str>)?;
    let look = MenuItem::with_id(app, "look", "Look at My Screen", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "focus", "Focus With Me…", true, None::<&str>)?;
    let forget = MenuItem::with_id(app, "forget", "Forget Everything…", true, None::<&str>)?;
    let agents = MenuItem::with_id(app, "agents", "Coding Agents…", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on-top", "Always on Top", true, true, None::<&str>)?;
    let size = Submenu::with_items(
        app,
        "Size",
        true,
        &[
            &MenuItem::with_id(app, "size-s", "Small", true, None::<&str>)?,
            &MenuItem::with_id(app, "size-m", "Medium", true, None::<&str>)?,
            &MenuItem::with_id(app, "size-l", "Large", true, None::<&str>)?,
        ],
    )?;
    let pick = MenuItem::with_id(app, "pick-model", "Choose Model…", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About This Model", true, None::<&str>)?;
    let relearn = MenuItem::with_id(app, "relearn", "Relearn Expressions", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LogitMate", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &chat,
            &look,
            &focus,
            &agents,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &on_top,
            &size,
            &pick,
            &about,
            &relearn,
            &forget,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("LogitMate")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            let Some(win) = app.get_webview_window("main") else { return };
            match id {
                "quit" => app.exit(0),
                "toggle" => {
                    let _ = if win.is_visible().unwrap_or(false) { win.hide() } else { win.show() };
                }
                "on-top" => {
                    let _ = win.set_always_on_top(on_top.is_checked().unwrap_or(true));
                }
                _ if FORWARDED.contains(&id) => {
                    let _ = win.emit("pet://menu", id);
                }
                _ => {}
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).icon_as_template(false);
    }
    builder.build(app)?;
    Ok(())
}
