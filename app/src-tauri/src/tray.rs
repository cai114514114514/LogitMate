use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// Menu ids the webview handles itself (sizing, model choice, about).
const FORWARDED: &[&str] = &["size-s", "size-m", "size-l", "pick-model", "about"];

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on-top", "总在最前", true, true, None::<&str>)?;
    let size = Submenu::with_items(
        app,
        "大小",
        true,
        &[
            &MenuItem::with_id(app, "size-s", "小", true, None::<&str>)?,
            &MenuItem::with_id(app, "size-m", "中", true, None::<&str>)?,
            &MenuItem::with_id(app, "size-l", "大", true, None::<&str>)?,
        ],
    )?;
    let pick = MenuItem::with_id(app, "pick-model", "选择模型…", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "关于模型", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 LogitMate", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &on_top, &size, &pick, &about, &PredefinedMenuItem::separator(app)?, &quit],
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
