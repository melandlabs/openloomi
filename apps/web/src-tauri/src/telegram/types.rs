// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

use serde::{Deserialize, Serialize};

/// Telegram Desktop account information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramAccount {
    pub user_id: i64,
    pub phone: String,
    pub first_name: String,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub is_premium: bool,
}

/// Telegram Desktop detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramDesktopInfo {
    pub installed: bool,
    pub has_session: bool,
    pub accounts: Vec<TelegramAccount>,
    pub data_path: Option<String>,
    pub is_app_store_version: Option<bool>,
}
