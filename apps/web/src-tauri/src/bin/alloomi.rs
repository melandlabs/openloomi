// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

#[tokio::main]
async fn main() -> std::process::ExitCode {
    openloomi_lib::cli::run_from_env().await
}
