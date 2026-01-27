/// Decode MIME encoded-word header (=?charset?encoding?data?=).
pub fn decode_mime_header(text: &str) -> String {
    let mut result = String::new();
    let mut remaining = text;
    let mut last_was_encoded = false;

    while let Some(start) = remaining.find("=?") {
        let between = &remaining[..start];
        // RFC 2047: whitespace between adjacent encoded words is ignored
        if last_was_encoded && between.chars().all(|c| c == ' ' || c == '\t') {
            // skip whitespace between encoded words
        } else {
            result.push_str(between);
        }
        remaining = &remaining[start..];

        // Parse =?charset?encoding?data?= by finding delimiters sequentially
        let inner = &remaining[2..]; // skip "=?"

        // Find end of charset (first '?')
        let charset_end = match inner.find('?') {
            Some(pos) => pos,
            None => {
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
                result.push_str(remaining);
                remaining = "";
                last_was_encoded = false;
                break;
            }
        };
        let data = &data_start[..data_end];

        // Advance past the entire encoded word
        let total_len = 2 + charset_end + 1 + encoding_end + 1 + data_end + 2;
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
            // Could not decode, keep original
            result.push_str(&text[start..start + total_len]);
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
fn base64_decode(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()
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

/// Decode bytes using specified charset.
fn decode_charset(bytes: &[u8], charset: &str) -> String {
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
