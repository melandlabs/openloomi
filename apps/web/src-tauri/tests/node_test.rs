// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Unit tests for the node module.

#[cfg(test)]
mod base64_decode_tests {
    use openloomi_lib::node::base64_decode;

    #[test]
    fn test_base64_decode_simple() {
        // "Hello" in base64
        let result = base64_decode("SGVsbG8");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"Hello");
    }

    #[test]
    fn test_base64_decode_with_padding() {
        // "Hello!" in base64
        let result = base64_decode("SGVsbG8h");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"Hello!");
    }

    #[test]
    fn test_base64_decode_empty() {
        let result = base64_decode("");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"");
    }

    #[test]
    fn test_base64_decode_single_char() {
        // "a" in base64
        let result = base64_decode("YQ");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"a");
    }

    #[test]
    fn test_base64_decode_with_newlines() {
        // "Test" in base64
        let result = base64_decode("VGVzdA");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"Test");
    }

    #[test]
    fn test_base64_decode_invalid_character() {
        let result = base64_decode("VGVzd@!");
        assert!(result.is_err());
    }

    #[test]
    fn test_base64_decode_all_letters() {
        // "ABC" in base64
        let result = base64_decode("QUJD");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"ABC");
    }

    #[test]
    fn test_base64_decode_all_numbers() {
        // "123" in base64
        let result = base64_decode("MTIz");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"123");
    }

    #[test]
    fn test_base64_decode_mixed() {
        // "Hello World 123!" in base64
        let result = base64_decode("SGVsbG8gV29ybGQgMTIzIQ");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"Hello World 123!");
    }

    #[test]
    fn test_base64_decode_preserves_padding() {
        // Test that padding characters are trimmed correctly
        // "ab" -> "YWI=" (with padding)
        let result = base64_decode("YWI=");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"ab");

        // "a" -> "YQ==" (with padding)
        let result = base64_decode("YQ==");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"a");
    }
}
