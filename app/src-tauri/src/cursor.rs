//! Streams the global mouse position to the pet window.
//!
//! The window ignores mouse events most of the time (click-through), so the webview never sees
//! the pointer. We poll it here and send window-relative logical coordinates instead: often when
//! the cursor is near her, rarely when it is far away (her gaze is saturated there anyway).

use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct CursorEvent {
    pub x: f64,
    pub y: f64,
}

/// Poll interval near the window, and far from it.
const NEAR_POLL: Duration = Duration::from_millis(16);
const FAR_POLL: Duration = Duration::from_millis(100);
/// "Near" is within this many logical pixels of the window.
const NEAR_MARGIN: f64 = 360.0;
/// How often to re-read the window frame when no move event says it changed.
const GEOMETRY_REFRESH: Duration = Duration::from_millis(500);

/// Converts a global physical cursor position to window-relative logical pixels.
pub fn to_window(cursor: (f64, f64), window_origin: (i32, i32), scale: f64) -> CursorEvent {
    CursorEvent {
        x: (cursor.0 - window_origin.0 as f64) / scale,
        y: (cursor.1 - window_origin.1 as f64) / scale,
    }
}

/// Whether a window-relative point is within `margin` of a window of `size` (logical pixels).
pub fn is_near(ev: CursorEvent, size: (f64, f64), margin: f64) -> bool {
    ev.x > -margin && ev.y > -margin && ev.x < size.0 + margin && ev.y < size.1 + margin
}

/// Moved enough to be worth telling the webview (half a logical pixel).
fn moved(a: Option<CursorEvent>, b: CursorEvent) -> bool {
    a.is_none_or(|a| (a.x - b.x).abs() >= 0.5 || (a.y - b.y).abs() >= 0.5)
}

#[derive(Clone, Copy)]
struct Geometry {
    origin: (i32, i32),
    size: (f64, f64),
    scale: f64,
    visible: bool,
    read_at: Instant,
}

pub fn spawn(app: AppHandle) {
    let geometry: Arc<Mutex<Option<Geometry>>> = Arc::default();
    if let Some(win) = app.get_webview_window("main") {
        // Moves and resizes invalidate the cached frame right away.
        let g = geometry.clone();
        win.on_window_event(move |e| {
            if matches!(e, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                *g.lock().unwrap() = None;
            }
        });
    }
    std::thread::spawn(move || {
        let mut last: Option<CursorEvent> = None;
        loop {
            let mut poll = FAR_POLL;
            if let Some(win) = app.get_webview_window("main") {
                let cached = *geometry.lock().unwrap();
                let geo = match cached {
                    Some(g) if g.read_at.elapsed() < GEOMETRY_REFRESH => Some(g),
                    _ => read_geometry(&win),
                };
                *geometry.lock().unwrap() = geo;
                if let (Some(g), Ok(c)) = (geo.filter(|g| g.visible), app.cursor_position()) {
                    let ev = to_window((c.x, c.y), g.origin, g.scale);
                    if is_near(ev, g.size, NEAR_MARGIN) {
                        poll = NEAR_POLL;
                    }
                    if moved(last, ev) {
                        last = Some(ev);
                        let _ = win.emit("pet://cursor", ev);
                    }
                }
            }
            std::thread::sleep(poll);
        }
    });
}

fn read_geometry(win: &tauri::WebviewWindow) -> Option<Geometry> {
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    Some(Geometry {
        origin: (pos.x, pos.y),
        size: (size.width as f64 / scale, size.height as f64 / scale),
        scale,
        visible: win.is_visible().unwrap_or(false),
        read_at: Instant::now(),
    })
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

    #[test]
    fn knows_near_from_far_and_skips_tiny_moves() {
        let size = (300.0, 770.0);
        assert!(is_near(CursorEvent { x: 150.0, y: 400.0 }, size, 360.0));
        assert!(is_near(CursorEvent { x: -300.0, y: 900.0 }, size, 360.0));
        assert!(!is_near(CursorEvent { x: -400.0, y: 400.0 }, size, 360.0));
        let a = CursorEvent { x: 10.0, y: 10.0 };
        assert!(!moved(Some(a), CursorEvent { x: 10.2, y: 10.3 }));
        assert!(moved(Some(a), CursorEvent { x: 10.6, y: 10.0 }));
        assert!(moved(None, a));
    }
}
