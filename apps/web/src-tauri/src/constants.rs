// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Shared constants for the openloomi Tauri application.

/// The port where the Next.js development server runs.
#[cfg(debug_assertions)]
pub const NEXTJS_PORT: u16 = 3515;

/// The port where the Next.js production server runs.
#[cfg(not(debug_assertions))]
pub const NEXTJS_PORT: u16 = 3414;

/// The base URL for the Next.js server.
pub const NEXTJS_BASE_URL: &str = "http://localhost";

/// Full URL for the Next.js server (convenience constructor).
#[inline]
pub fn nextjs_url() -> String {
    format!("{}:{}", NEXTJS_BASE_URL, NEXTJS_PORT)
}

/// JS snippet injected into a webview before any user script runs.
/// Sets `window.__OPENLOOMI_API__` to the Next.js server URL so the
/// pet/bubble/card HTML files (served from the Tauri asset protocol,
/// origin `tauri://localhost`) can build absolute fetch URLs against
/// the Next.js HTTP server. Relative paths would resolve to
/// `tauri://localhost/api/...` and 404 inside the Tauri asset
/// resolver. Compile-time selected: dev → 3515, prod → 3414.
#[inline]
pub fn api_init_script() -> String {
    format!("window.__OPENLOOMI_API__ = '{}';", nextjs_url())
}
