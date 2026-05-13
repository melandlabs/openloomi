// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Unit tests for the update module.

use openloomi_lib::update::{get_platform_download_filename, is_newer_version, parse_semver};

#[cfg(test)]
mod parse_semver_tests {
    use super::*;

    #[test]
    fn test_parse_semver_basic() {
        assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn test_parse_semver_with_v_prefix() {
        assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn test_parse_semver_large_numbers() {
        assert_eq!(parse_semver("10.20.30"), Some((10, 20, 30)));
    }

    #[test]
    fn test_parse_semver_invalid_too_few_parts() {
        assert_eq!(parse_semver("1.2"), None);
        assert_eq!(parse_semver("1"), None);
        assert_eq!(parse_semver(""), None);
    }

    #[test]
    fn test_parse_semver_invalid_non_numeric() {
        assert_eq!(parse_semver("a.b.c"), None);
        assert_eq!(parse_semver("1.2.x"), None);
        assert_eq!(parse_semver("1.2.3.4"), Some((1, 2, 3)));
    }
}

#[cfg(test)]
mod is_newer_version_tests {
    use super::*;

    #[test]
    fn test_is_newer_version_newer_minor() {
        assert!(is_newer_version("1.2.0", "1.1.0"));
    }

    #[test]
    fn test_is_newer_version_newer_patch() {
        assert!(is_newer_version("1.1.1", "1.1.0"));
    }

    #[test]
    fn test_is_newer_version_newer_major() {
        assert!(is_newer_version("2.0.0", "1.9.9"));
    }

    #[test]
    fn test_is_newer_version_equal() {
        assert!(!is_newer_version("1.2.3", "1.2.3"));
    }

    #[test]
    fn test_is_newer_version_older() {
        assert!(!is_newer_version("1.1.0", "1.2.0"));
    }

    #[test]
    fn test_is_newer_version_with_v_prefix() {
        assert!(is_newer_version("v1.3.0", "v1.2.0"));
    }

    #[test]
    fn test_is_newer_version_mixed_prefix() {
        assert!(is_newer_version("v2.0.0", "1.9.9"));
        assert!(!is_newer_version("2.0.0", "v1.9.9"));
    }

    #[test]
    fn test_is_newer_version_invalid_versions() {
        assert!(!is_newer_version("invalid", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "invalid"));
        assert!(!is_newer_version("invalid", "invalid"));
    }
}

#[cfg(test)]
mod get_platform_download_filename_tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_platform_download_filename_macos_x64() {
        let result = get_platform_download_filename("v1.0.0");
        assert!(result.is_some());
        let name = result.unwrap();
        assert!(
            name.contains("openloomi_1.0.0_macOS_x64.dmg"),
            "got: {}",
            name
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_platform_download_filename_macos_aarch64() {
        #[cfg(target_arch = "aarch64")]
        {
            let result = get_platform_download_filename("v2.0.0");
            assert!(result.is_some());
            let name = result.unwrap();
            assert!(name.contains("_macOS_aarch64.dmg"), "got: {}", name);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_get_platform_download_filename_linux() {
        let result = get_platform_download_filename("v1.0.0");
        assert!(result.is_some());
        let name = result.unwrap();
        assert!(name.contains("openloomi_1.0.0_linux"), "got: {}", name);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_get_platform_download_filename_windows() {
        let result = get_platform_download_filename("v1.0.0");
        assert!(result.is_some());
        let name = result.unwrap();
        assert!(
            name.contains("openloomi_1.0.0_windows_x64-setup.exe"),
            "got: {}",
            name
        );
    }

    #[test]
    fn test_get_platform_download_filename_without_v_prefix() {
        let result = get_platform_download_filename("1.0.0");
        assert!(result.is_some());
    }
}
