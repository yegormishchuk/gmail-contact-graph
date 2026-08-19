/// Decode MIME encoded-word header (=?charset?encoding?data?=).
pub fn decode_mime_header(text: &str) -> String {
    let mut result = String::new();
    let mut remaining = text;
    let mut last_was_encoded = false;

    while let Some(start) = remaining.find("=?") {
        let between = &remaining[..start];
        // RFC 2047: whitespace between two adjacent encoded words is a
        // separator, not text. It only earns that treatment if what follows
        // really is an encoded word, so hold it back until this one is known
        // to decode; every path that gives up on the word emits it first.
        let pending = if last_was_encoded && between.chars().all(|c| c == ' ' || c == '\t') {
            between
        } else {
            result.push_str(between);
            ""
        };
        remaining = &remaining[start..];

        // Parse =?charset?encoding?data?= by finding delimiters sequentially
        let inner = &remaining[2..]; // skip "=?"

        // Find end of charset (first '?')
        let charset_end = match inner.find('?') {
            Some(pos) => pos,
            None => {
                result.push_str(pending);
                result.push_str("=?");
                remaining = &remaining[2..];
                last_was_encoded = false;
                continue;
            }
        };
        let charset = &inner[..charset_end];

        // Find end of encoding (next '?')
        let after_charset = &inner[charset_end + 1..];
        let encoding_end = match after_charset.find('?') {
            Some(pos) => pos,
            None => {
                result.push_str(pending);
                result.push_str("=?");
                remaining = &remaining[2..];
                last_was_encoded = false;
                continue;
            }
        };
        let encoding = &after_charset[..encoding_end];

        // Find end of data ("?=" after the data section)
        let data_start = &after_charset[encoding_end + 1..];
        let data_end = match data_start.find("?=") {
            Some(pos) => pos,
            None => {
                result.push_str(pending);
                result.push_str(remaining);
                remaining = "";
                last_was_encoded = false;
                break;
            }
        };
        let data = &data_start[..data_end];

        // Advance past the entire encoded word. Capture it first: `remaining`
        // already starts at this word's "=?", so the slice below is the word
        // itself — whereas `start` is an offset into `remaining`, and using it
        // to index `text` would read from wherever the previous word ended.
        let total_len = 2 + charset_end + 1 + encoding_end + 1 + data_end + 2;
        let raw_word = &remaining[..total_len];
        remaining = &remaining[total_len..];

        let encoding_upper = encoding.to_uppercase();
        let decoded_bytes = match encoding_upper.as_str() {
            "B" => base64_decode(data),
            "Q" => quoted_printable_decode(data),
            _ => None,
        };

        if let Some(bytes) = decoded_bytes {
            result.push_str(&decode_charset(&bytes, charset));
            last_was_encoded = true;
        } else {
            // Not a decodable encoded word after all — it and the whitespace
            // in front of it are ordinary text.
            result.push_str(pending);
            result.push_str(raw_word);
            last_was_encoded = false;
        }
    }

    if last_was_encoded && remaining.chars().all(|c| c == ' ' || c == '\t') {
        // trailing whitespace after last encoded word — keep it
        result.push_str(remaining);
    } else {
        result.push_str(remaining);
    }
    result
}

/// Decode base64 data.
pub fn base64_decode(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(data).ok()
}

/// Decode quoted-printable data (for MIME headers, _ = space).
fn quoted_printable_decode(data: &str) -> Option<Vec<u8>> {
    let mut result = Vec::new();
    let mut chars = data.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '_' => result.push(b' '), // In headers, underscore means space
            '=' => {
                let hex: String = chars.by_ref().take(2).collect();
                if hex.len() == 2 {
                    if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                        result.push(byte);
                    }
                }
            }
            _ => result.push(c as u8),
        }
    }

    Some(result)
}

/// Decode quoted-printable body content (RFC 2045).
///
/// Unlike header QP, underscores remain literal and `=\n` is a soft line break.
pub fn body_quoted_printable_decode(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        if data[i] == b'=' {
            // Soft line break: =\r\n or =\n
            if i + 1 < data.len() && data[i + 1] == b'\n' {
                i += 2;
                continue;
            }
            if i + 2 < data.len() && data[i + 1] == b'\r' && data[i + 2] == b'\n' {
                i += 3;
                continue;
            }
            // Hex escape: =XX
            if i + 2 < data.len() {
                let hex = &data[i + 1..i + 3];
                if let Ok(s) = std::str::from_utf8(hex) {
                    if let Ok(byte) = u8::from_str_radix(s, 16) {
                        result.push(byte);
                        i += 3;
                        continue;
                    }
                }
            }
            // Malformed, keep as-is
            result.push(b'=');
            i += 1;
        } else {
            result.push(data[i]);
            i += 1;
        }
    }

    result
}

/// Decode bytes using specified charset.
pub fn decode_charset(bytes: &[u8], charset: &str) -> String {
    let charset_lower = charset.to_lowercase();
    let encoding = match charset_lower.as_str() {
        "utf-8" | "utf8" => encoding_rs::UTF_8,
        "iso-8859-1" | "latin1" | "latin-1" => encoding_rs::WINDOWS_1252,
        "iso-8859-2" | "latin2" | "latin-2" => encoding_rs::ISO_8859_2,
        "windows-1251" | "cp1251" => encoding_rs::WINDOWS_1251,
        "windows-1252" | "cp1252" => encoding_rs::WINDOWS_1252,
        "koi8-r" => encoding_rs::KOI8_R,
        "koi8-u" => encoding_rs::KOI8_U,
        "gb2312" | "gbk" | "gb18030" => encoding_rs::GB18030,
        "big5" => encoding_rs::BIG5,
        "shift_jis" | "shift-jis" | "sjis" => encoding_rs::SHIFT_JIS,
        "euc-jp" => encoding_rs::EUC_JP,
        "euc-kr" => encoding_rs::EUC_KR,
        "iso-2022-jp" => encoding_rs::ISO_2022_JP,
        _ => encoding_rs::UTF_8,
    };

    let (decoded, _, _) = encoding.decode(bytes);
    decoded.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // "Привет" and "Тест" pre-encoded in the charsets used below, so the test
    // source itself stays ASCII-safe regardless of how it is checked out.
    const PRIVET_UTF8_B64: &str = "0J/RgNC40LLQtdGC";
    const TEST_UTF8_B64: &str = "0KLQtdGB0YI=";
    const PRIVET_CP1251: &[u8] = &[207, 240, 232, 226, 229, 242];
    const PRIVET_KOI8R: &[u8] = &[240, 210, 201, 215, 197, 212];

    // -----------------------------------------------------------------------
    // decode_mime_header
    // -----------------------------------------------------------------------

    #[test]
    fn decodes_a_base64_encoded_word() {
        let header = format!("=?UTF-8?B?{}?=", PRIVET_UTF8_B64);
        assert_eq!(decode_mime_header(&header), "Привет");
    }

    #[test]
    fn decodes_a_quoted_printable_encoded_word_with_underscores_as_spaces() {
        assert_eq!(decode_mime_header("=?UTF-8?Q?Hello_World?="), "Hello World");
    }

    #[test]
    fn decodes_quoted_printable_hex_escapes() {
        assert_eq!(decode_mime_header("=?UTF-8?Q?caf=C3=A9?="), "café");
    }

    #[test]
    fn lowercase_encoding_letters_are_accepted() {
        // RFC 2047 says the encoding token is case-insensitive.
        let header = format!("=?utf-8?b?{}?=", PRIVET_UTF8_B64);
        assert_eq!(decode_mime_header(&header), "Привет");
    }

    #[test]
    fn plain_text_passes_through_untouched() {
        assert_eq!(decode_mime_header("Just a subject"), "Just a subject");
    }

    #[test]
    fn text_around_an_encoded_word_is_preserved() {
        let header = format!("Re: =?UTF-8?B?{}?= (fwd)", PRIVET_UTF8_B64);
        assert_eq!(decode_mime_header(&header), "Re: Привет (fwd)");
    }

    #[test]
    fn whitespace_between_adjacent_encoded_words_is_dropped() {
        // RFC 2047: the separator between two encoded words is not part of the
        // text, so the halves join directly.
        let header = format!(
            "=?UTF-8?B?{}?= =?UTF-8?B?{}?=",
            PRIVET_UTF8_B64, TEST_UTF8_B64
        );
        assert_eq!(decode_mime_header(&header), "ПриветТест");
    }

    #[test]
    fn a_truncated_encoded_word_is_returned_verbatim() {
        // No closing "?=" — must not panic, and must not swallow the text.
        let truncated = "=?UTF-8?B?0J/RgNC4";
        assert_eq!(decode_mime_header(truncated), truncated);
    }

    #[test]
    fn a_lone_question_mark_prefix_is_returned_verbatim() {
        assert_eq!(decode_mime_header("=?UTF-8"), "=?UTF-8");
    }

    #[test]
    fn invalid_base64_payload_keeps_the_original_word() {
        // Only correct because this is the *first* encoded word — see the two
        // ignored tests below for what happens once `remaining` has advanced.
        assert_eq!(decode_mime_header("=?UTF-8?B?!!!?="), "=?UTF-8?B?!!!?=");
    }

    #[test]
    fn an_undecodable_word_after_a_decodable_one_is_kept_verbatim() {
        assert_eq!(
            decode_mime_header("=?UTF-8?B?SGVsbG8=?= =?UTF-8?X?abc?="),
            "Hello =?UTF-8?X?abc?="
        );
    }

    #[test]
    fn a_multibyte_separator_before_an_undecodable_word_does_not_panic() {
        // Regression: the keep-original branch used to index `text` with an
        // offset into `remaining`, which panicked once the stale offset landed
        // inside a multi-byte character.
        let input = "=?UTF-8?Q?a?=€€€€€=?UTF-8?X?b?=";
        assert_eq!(decode_mime_header(input), "a€€€€€=?UTF-8?X?b?=");
    }

    #[test]
    fn the_separator_survives_a_malformed_word_too() {
        // The "=?" here never completes into an encoded word, so the space
        // before it is text and must not be eaten as a separator.
        assert_eq!(
            decode_mime_header("=?UTF-8?B?SGVsbG8=?= =?nonsense"),
            "Hello =?nonsense"
        );
    }

    #[test]
    fn several_undecodable_words_in_a_row_are_each_kept() {
        assert_eq!(
            decode_mime_header("=?UTF-8?X?one?= mid =?UTF-8?Y?two?="),
            "=?UTF-8?X?one?= mid =?UTF-8?Y?two?="
        );
    }

    // -----------------------------------------------------------------------
    // decode_charset
    // -----------------------------------------------------------------------

    #[test]
    fn decodes_windows_1251_cyrillic() {
        assert_eq!(decode_charset(PRIVET_CP1251, "windows-1251"), "Привет");
    }

    #[test]
    fn decodes_koi8_r_cyrillic() {
        assert_eq!(decode_charset(PRIVET_KOI8R, "koi8-r"), "Привет");
    }

    #[test]
    fn charset_names_are_case_insensitive() {
        assert_eq!(decode_charset(PRIVET_CP1251, "Windows-1251"), "Привет");
    }

    #[test]
    fn an_unknown_charset_falls_back_to_utf8() {
        assert_eq!(decode_charset("Привет".as_bytes(), "x-made-up"), "Привет");
    }

    // -----------------------------------------------------------------------
    // body_quoted_printable_decode
    // -----------------------------------------------------------------------

    #[test]
    fn body_qp_removes_soft_line_breaks() {
        assert_eq!(body_quoted_printable_decode(b"one=\ntwo"), b"onetwo");
        assert_eq!(body_quoted_printable_decode(b"one=\r\ntwo"), b"onetwo");
    }

    #[test]
    fn body_qp_decodes_hex_escapes() {
        assert_eq!(body_quoted_printable_decode(b"=41=42"), b"AB");
    }

    #[test]
    fn body_qp_keeps_underscores_literal() {
        // This is the difference from header QP, where '_' means space.
        assert_eq!(body_quoted_printable_decode(b"a_b"), b"a_b");
    }

    #[test]
    fn body_qp_keeps_malformed_escapes_as_is() {
        assert_eq!(body_quoted_printable_decode(b"=ZZ"), b"=ZZ");
        assert_eq!(body_quoted_printable_decode(b"trailing="), b"trailing=");
    }

    // -----------------------------------------------------------------------
    // base64_decode
    // -----------------------------------------------------------------------

    #[test]
    fn base64_rejects_invalid_input() {
        assert_eq!(base64_decode("SGVsbG8="), Some(b"Hello".to_vec()));
        assert_eq!(base64_decode("!!!not base64!!!"), None);
    }
}
