// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! JavaScript Scheduler management — handles stopping the JS-side local scheduler
//! before the Node.js process is terminated.

use crate::constants;
use std::time::Duration;

/// Stop the JS-side local scheduler via HTTP POST to the scheduler stop endpoint.
/// This is called before cleaning up the Node.js process to ensure no pending
/// timer callbacks execute after the app closes.
pub fn stop_js_scheduler() {
    let stop_url = format!(
        "{}/api/scheduled-jobs/internal/scheduler",
        constants::nextjs_url()
    );
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            println!("⚠️ Failed to build HTTP client for scheduler stop: {}", e);
            return;
        }
    };

    match client.post(&stop_url).send() {
        Ok(response) => {
            if response.status().is_success() {
                println!("✅ Local scheduler stopped via API");
            } else {
                println!("⚠️ Scheduler stop returned status: {}", response.status());
            }
        }
        Err(e) => {
            println!("⚠️ Failed to stop scheduler via API: {}", e);
        }
    }
}
