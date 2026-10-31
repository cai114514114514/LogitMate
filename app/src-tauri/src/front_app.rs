//! The frontmost app, for Focus Partner. Only its name and bundle id are read (never window titles
//! or contents), and they stay on this Mac: the webview uses them locally and never sends them on.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FrontApp {
    pub name: String,
    pub bundle: String,
}

#[cfg(target_os = "macos")]
#[allow(unused_unsafe)]
pub fn frontmost() -> Option<FrontApp> {
    use objc2_app_kit::NSWorkspace;
    let app = unsafe { NSWorkspace::sharedWorkspace().frontmostApplication() }?;
    let name = unsafe { app.localizedName() }.map(|s| s.to_string()).unwrap_or_default();
    let bundle = unsafe { app.bundleIdentifier() }.map(|s| s.to_string()).unwrap_or_default();
    Some(FrontApp { name, bundle })
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost() -> Option<FrontApp> {
    None
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
}

/// Seconds since the last keyboard or mouse input anywhere (no permission needed): whether
/// someone is at the computer, even if they only type.
pub fn idle_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    // kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType
    return unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    #[cfg(not(target_os = "macos"))]
    0.0
}
