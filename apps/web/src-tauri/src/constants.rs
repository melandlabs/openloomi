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
pub const NEXTJS_PORT: u16 = 3415;

/// The base URL for the Next.js server.
pub const NEXTJS_BASE_URL: &str = "http://localhost";

/// Full URL for the Next.js server (convenience constructor).
#[inline]
pub fn nextjs_url() -> String {
    format!("{}:{}", NEXTJS_BASE_URL, NEXTJS_PORT)
}
