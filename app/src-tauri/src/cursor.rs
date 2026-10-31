//! Streams the global mouse position to the pet window.
//!
//! The window ignores mouse events most of the time (click-through), so the webview never sees
//! the pointer. We poll it here and send window-relative logical coordinates instead.

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Copy, PartialEq)]
pub struct CursorEvent {
    pub x: f64,
    pub y: f64,
}

/// Converts a global physical cursor position to window-relative logical pixels.
pub fn to_window(cursor: (f64, f64), window_origin: (i32, i32), scale: f64) -> CursorEvent {
    CursorEvent {
        x: (cursor.0 - window_origin.0 as f64) / scale,
        y: (cursor.1 - window_origin.1 as f64) / scale,
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<CursorEvent> = None;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let Some(win) = app.get_webview_window("main") else { continue };
            if !win.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(c), Ok(pos), Ok(scale)) = (app.cursor_position(), win.outer_position(), win.scale_factor()) else {
                continue;
            };
            let ev = to_window((c.x, c.y), (pos.x, pos.y), scale);
            if last != Some(ev) {
                last = Some(ev);
                let _ = win.emit("pet://cursor", ev);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_to_window_logical_pixels() {
        let e = to_window((2100.0, 1300.0), (2000, 1000), 2.0);
        assert_eq!((e.x, e.y), (50.0, 150.0));
        let e = to_window((10.0, 10.0), (100, 100), 1.0);
        assert_eq!((e.x, e.y), (-90.0, -90.0));
    }
}
