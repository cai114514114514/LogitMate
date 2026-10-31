//! "Look at my screen": a screenshot taken only when the user asks. It goes through a temporary
//! file that is deleted right away and reaches the webview as a JPEG, nothing is kept.

use std::process::Command;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Whether macOS lets this app record the screen (Privacy & Security → Screen Recording).
pub fn has_access() -> bool {
    #[cfg(target_os = "macos")]
    return unsafe { CGPreflightScreenCaptureAccess() };
    #[cfg(not(target_os = "macos"))]
    false
}

/// Asks macOS for access; the first time it shows the system prompt. Takes effect after a relaunch.
pub fn request_access() -> bool {
    #[cfg(target_os = "macos")]
    return unsafe { CGRequestScreenCaptureAccess() };
    #[cfg(not(target_os = "macos"))]
    false
}

/// JPEG of a screen rectangle (in points), scaled so its long side is at most `max_px`.
pub fn capture(x: f64, y: f64, w: f64, h: f64, max_px: u32) -> Result<Vec<u8>, String> {
    let path = std::env::temp_dir().join(format!("logitmate-look-{}.jpg", std::process::id()));
    let rect = format!("{},{},{},{}", x.round(), y.round(), w.round(), h.round());
    let status = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-t", "jpg", "-R", &rect])
        .arg(&path)
        .status()
        .map_err(|e| e.to_string())?;
    let result = (|| {
        if !status.success() {
            return Err(format!("screencapture failed: {status}"));
        }
        Command::new("/usr/bin/sips")
            .args(["-Z", &max_px.to_string()])
            .arg(&path)
            .output()
            .map_err(|e| e.to_string())?;
        std::fs::read(&path).map_err(|e| e.to_string())
    })();
    let _ = std::fs::remove_file(&path);
    result
}
