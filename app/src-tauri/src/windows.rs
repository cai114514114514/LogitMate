//! Other apps' windows, for desktop presence: where their frames are (so she can stand on one and
//! follow it) and whether a meeting or a full-screen app is up (so she can step aside). Only
//! frames, owners and layers are read; window titles and contents are not.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub owner: String,
    pub pid: i32,
    /// Frame in points, top-left origin of the main display.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// On-screen app windows (layer 0), front to back, without our own.
#[cfg(target_os = "macos")]
pub fn list(own_pid: i32) -> Vec<WindowInfo> {
    use std::ffi::{CStr, c_char, c_void};
    type Ref = *const c_void;
    #[repr(C)]
    #[derive(Default)]
    struct CGRect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> Ref;
        fn CGRectMakeWithDictionaryRepresentation(dict: Ref, rect: *mut CGRect) -> bool;
        static kCGWindowNumber: Ref;
        static kCGWindowOwnerName: Ref;
        static kCGWindowOwnerPID: Ref;
        static kCGWindowLayer: Ref;
        static kCGWindowBounds: Ref;
        static kCGWindowAlpha: Ref;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFArrayGetCount(array: Ref) -> isize;
        fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
        fn CFDictionaryGetValue(dict: Ref, key: Ref) -> Ref;
        fn CFNumberGetValue(number: Ref, kind: isize, out: *mut c_void) -> bool;
        fn CFStringGetCString(string: Ref, buf: *mut c_char, size: isize, encoding: u32) -> bool;
        fn CFRelease(r: Ref);
    }
    const ON_SCREEN_ONLY: u32 = 1;
    const EXCLUDE_DESKTOP: u32 = 1 << 4;
    const SINT64: isize = 4;
    const DOUBLE: isize = 13;
    const UTF8: u32 = 0x0800_0100;

    let mut out = Vec::new();
    unsafe {
        let array = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0);
        if array.is_null() {
            return out;
        }
        let int = |d: Ref, key: Ref| -> Option<i64> {
            let n = CFDictionaryGetValue(d, key);
            let mut v: i64 = 0;
            (!n.is_null() && CFNumberGetValue(n, SINT64, &mut v as *mut i64 as *mut c_void)).then_some(v)
        };
        for i in 0..CFArrayGetCount(array) {
            let d = CFArrayGetValueAtIndex(array, i);
            let (Some(id), Some(pid), Some(layer)) = (int(d, kCGWindowNumber), int(d, kCGWindowOwnerPID), int(d, kCGWindowLayer)) else {
                continue;
            };
            if layer != 0 || pid as i32 == own_pid {
                continue;
            }
            let alpha_ref = CFDictionaryGetValue(d, kCGWindowAlpha);
            let mut alpha = 1.0f64;
            if !alpha_ref.is_null() {
                CFNumberGetValue(alpha_ref, DOUBLE, &mut alpha as *mut f64 as *mut c_void);
            }
            let mut rect = CGRect::default();
            let bounds = CFDictionaryGetValue(d, kCGWindowBounds);
            if alpha <= 0.0 || bounds.is_null() || !CGRectMakeWithDictionaryRepresentation(bounds, &mut rect) {
                continue;
            }
            // Tiny windows are status items and helpers, not something to stand on.
            if rect.w < 120.0 || rect.h < 60.0 {
                continue;
            }
            let mut buf = [0 as c_char; 256];
            let owner_ref = CFDictionaryGetValue(d, kCGWindowOwnerName);
            let owner = if !owner_ref.is_null() && CFStringGetCString(owner_ref, buf.as_mut_ptr(), 256, UTF8) {
                CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
            } else {
                String::new()
            };
            out.push(WindowInfo { id: id as u32, owner, pid: pid as i32, x: rect.x, y: rect.y, width: rect.w, height: rect.h });
        }
        CFRelease(array);
    }
    out
}

#[cfg(not(target_os = "macos"))]
pub fn list(_own_pid: i32) -> Vec<WindowInfo> {
    Vec::new()
}

/// Whether some app is using the default microphone (a call, most likely). Reads the device's
/// "running somewhere" flag; nothing is recorded and no permission is needed.
#[cfg(target_os = "macos")]
pub fn mic_in_use() -> bool {
    use std::ffi::c_void;
    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }
    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioObjectGetPropertyData(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }
    const SYSTEM_OBJECT: u32 = 1;
    const GLOBAL: u32 = u32::from_be_bytes(*b"glob");
    let get = |object: u32, selector: &[u8; 4]| -> Option<u32> {
        let address = Address { selector: u32::from_be_bytes(*selector), scope: GLOBAL, element: 0 };
        let (mut value, mut size) = (0u32, 4u32);
        let status = unsafe {
            AudioObjectGetPropertyData(object, &address, 0, std::ptr::null(), &mut size, &mut value as *mut u32 as *mut c_void)
        };
        (status == 0).then_some(value)
    };
    match get(SYSTEM_OBJECT, b"dIn ") {
        Some(device) if device != 0 => get(device, b"gone").is_some_and(|running| running != 0),
        _ => false,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn mic_in_use() -> bool {
    false
}

/// Keeps her window out of screenshots, screen recordings and screen sharing where macOS honors
/// it (NSWindowSharingNone), so she never shows up in what the user shares or in her own glances.
#[cfg(target_os = "macos")]
pub fn exclude_from_capture(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    if let Ok(ns) = window.ns_window() {
        let ns = ns as *mut AnyObject;
        if !ns.is_null() {
            unsafe {
                let _: () = msg_send![&*ns, setSharingType: 0usize];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn exclude_from_capture(_window: &tauri::WebviewWindow) {}

/// Lets her window extend above the top of the screen. Her window includes room for the speech
/// bubble above her head, so standing on a window lower down can put that room off screen, which
/// macOS would otherwise prevent by pushing the whole window down.
#[cfg(target_os = "macos")]
pub fn allow_offscreen(window: &tauri::WebviewWindow) {
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::sel;
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }
    extern "C-unwind" fn unconstrained(_this: *mut AnyObject, _sel: Sel, rect: Rect, _screen: *mut AnyObject) -> Rect {
        rect
    }
    let Ok(ns) = window.ns_window() else { return };
    if ns.is_null() {
        return;
    }
    unsafe {
        let class = objc2::ffi::object_getClass(ns as *const AnyObject) as *mut AnyClass;
        let imp: Imp = std::mem::transmute(unconstrained as extern "C-unwind" fn(*mut AnyObject, Sel, Rect, *mut AnyObject) -> Rect);
        let types = c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@";
        objc2::ffi::class_replaceMethod(class, sel!(constrainFrameRect:toScreen:), imp, types.as_ptr());
    }
}

#[cfg(not(target_os = "macos"))]
pub fn allow_offscreen(_window: &tauri::WebviewWindow) {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn lists_real_window_frames() {
        // Runs against the real window server; there may be no windows, but frames must be sane.
        for w in super::list(-1) {
            assert!(w.width >= 120.0 && w.height >= 60.0, "{w:?}");
        }
        let _ = super::mic_in_use();
    }
}
