use aes_siv::aead::{Aead, KeyInit, Payload};
use aes_siv::{Aes256SivAead, Nonce};
use argon2::Argon2;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use zeroize::Zeroize;

// Shared privacy alias core used by the desktop app, remote-safe IPC, and the
// standalone codexmonitor_privacy helper. Keep this deterministic so repeated
// plaintext labels map to the same alias for a given passphrase.
const ALIAS_PREFIX: &str = "P1_";
const AAD: &[u8] = b"CodexMonitorPrivacyAlias:v1";
const ARGON2_SALT: &[u8] = b"CodexMonitorPrivacyAlias:v1:argon2id";
const AES_SIV_NONCE: &[u8; 16] = b"privacy-alias-v1";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivacyTransform {
    pub(crate) text: String,
    pub(crate) changed: bool,
    pub(crate) replacements: usize,
}

pub(crate) fn contains_privacy_markers(input: &str) -> bool {
    let bytes = input.as_bytes();
    let mut i = 0usize;
    let mut inline_code_ticks = 0usize;

    while i < bytes.len() {
        if inline_code_ticks > 0 {
            let run = backtick_run(bytes, i);
            if run == inline_code_ticks {
                inline_code_ticks = 0;
                i += run;
            } else {
                i += 1;
            }
            continue;
        }

        if let Some(end) = fenced_code_end(input, i) {
            i = end;
            continue;
        }

        let run = backtick_run(bytes, i);
        if run > 0 {
            inline_code_ticks = run;
            i += run;
            continue;
        }

        if parse_marker(input, i).is_some() {
            return true;
        }
        i += 1;
    }
    false
}

pub(crate) fn contains_privacy_aliases(input: &str) -> bool {
    input.contains(ALIAS_PREFIX)
}

pub(crate) fn anonymize_text(input: &str, passphrase: &str) -> Result<PrivacyTransform, String> {
    if passphrase.is_empty() {
        return Err("Passphrase is required".to_string());
    }
    let mut key = derive_key(passphrase)?;
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0usize;
    let mut replacements = 0usize;
    let bytes = input.as_bytes();
    let mut i = 0usize;
    let mut inline_code_ticks = 0usize;

    while i < bytes.len() {
        if inline_code_ticks > 0 {
            let run = backtick_run(bytes, i);
            if run == inline_code_ticks {
                inline_code_ticks = 0;
                i += run;
            } else {
                i += 1;
            }
            continue;
        }

        if let Some(end) = fenced_code_end(input, i) {
            i = end;
            continue;
        }

        let run = backtick_run(bytes, i);
        if run > 0 {
            inline_code_ticks = run;
            i += run;
            continue;
        }

        if let Some(marker) = parse_marker(input, i) {
            output.push_str(&input[cursor..marker.start]);
            output.push_str(&encrypt_alias(&key, marker.content)?);
            cursor = marker.end;
            i = marker.end;
            replacements += 1;
            continue;
        }

        i += 1;
    }

    key.zeroize();
    if replacements == 0 {
        return Ok(PrivacyTransform {
            text: input.to_string(),
            changed: false,
            replacements: 0,
        });
    }
    output.push_str(&input[cursor..]);
    Ok(PrivacyTransform {
        text: output,
        changed: true,
        replacements,
    })
}

pub(crate) fn reveal_text(input: &str, passphrase: &str) -> PrivacyTransform {
    if passphrase.is_empty() || !contains_privacy_aliases(input) {
        return PrivacyTransform {
            text: input.to_string(),
            changed: false,
            replacements: 0,
        };
    }
    let Ok(mut key) = derive_key(passphrase) else {
        return PrivacyTransform {
            text: input.to_string(),
            changed: false,
            replacements: 0,
        };
    };

    let mut output = String::with_capacity(input.len());
    let mut cursor = 0usize;
    let mut replacements = 0usize;
    let bytes = input.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if !bytes[i..].starts_with(ALIAS_PREFIX.as_bytes()) {
            i += 1;
            continue;
        }
        let token_start = i + ALIAS_PREFIX.len();
        let token_end = read_alias_token_end(bytes, token_start);
        if token_end == token_start {
            i += ALIAS_PREFIX.len();
            continue;
        }
        let alias = &input[i..token_end];
        if let Some(plaintext) = decrypt_alias(&key, alias) {
            output.push_str(&input[cursor..i]);
            output.push_str(&plaintext);
            cursor = token_end;
            replacements += 1;
        }
        i = token_end;
    }

    key.zeroize();
    if replacements == 0 {
        return PrivacyTransform {
            text: input.to_string(),
            changed: false,
            replacements: 0,
        };
    }
    output.push_str(&input[cursor..]);
    PrivacyTransform {
        text: output,
        changed: true,
        replacements,
    }
}

fn derive_key(passphrase: &str) -> Result<[u8; 64], String> {
    let mut key = [0u8; 64];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), ARGON2_SALT, &mut key)
        .map_err(|err| format!("Failed to derive privacy alias key: {err}"))?;
    Ok(key)
}

fn encrypt_alias(key: &[u8; 64], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256SivAead::new_from_slice(key)
        .map_err(|_| "Failed to initialize privacy alias cipher".to_string())?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(AES_SIV_NONCE),
            Payload {
                msg: plaintext.as_bytes(),
                aad: AAD,
            },
        )
        .map_err(|_| "Failed to encrypt privacy alias".to_string())?;
    Ok(format!(
        "{ALIAS_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(ciphertext)
    ))
}

fn decrypt_alias(key: &[u8; 64], alias: &str) -> Option<String> {
    let token = alias.strip_prefix(ALIAS_PREFIX)?;
    let ciphertext = URL_SAFE_NO_PAD.decode(token).ok()?;
    let cipher = Aes256SivAead::new_from_slice(key).ok()?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(AES_SIV_NONCE),
            Payload {
                msg: ciphertext.as_ref(),
                aad: AAD,
            },
        )
        .ok()?;
    String::from_utf8(plaintext).ok()
}

#[derive(Debug, Clone)]
struct Marker<'a> {
    start: usize,
    end: usize,
    content: &'a str,
}

fn parse_marker(input: &str, start: usize) -> Option<Marker<'_>> {
    let bytes = input.as_bytes();
    let open_len = if bytes[start..].starts_with(b"@p{") {
        3
    } else if bytes[start..].starts_with(b"@private{") {
        9
    } else {
        return None;
    };
    if is_escaped(bytes, start) {
        return None;
    }

    let content_start = start + open_len;
    let mut i = content_start;
    while i < bytes.len() {
        if bytes[i] == b'}' && !is_escaped(bytes, i) {
            if i == content_start {
                return None;
            }
            let content = &input[content_start..i];
            if content.contains("@p{") || content.contains("@private{") {
                return None;
            }
            return Some(Marker {
                start,
                end: i + 1,
                content,
            });
        }
        i += 1;
    }
    None
}

fn is_escaped(bytes: &[u8], pos: usize) -> bool {
    let mut count = 0usize;
    let mut i = pos;
    while i > 0 {
        i -= 1;
        if bytes[i] != b'\\' {
            break;
        }
        count += 1;
    }
    count % 2 == 1
}

fn backtick_run(bytes: &[u8], start: usize) -> usize {
    if bytes.get(start) != Some(&b'`') {
        return 0;
    }
    let mut len = 0usize;
    while start + len < bytes.len() && bytes[start + len] == b'`' {
        len += 1;
    }
    len
}

fn fenced_code_end(input: &str, start: usize) -> Option<usize> {
    // Markdown code contexts are intentionally skipped so source examples are
    // not rewritten. Users can run the CLI helper directly for file/data use.
    let bytes = input.as_bytes();
    if !is_line_start(bytes, start) {
        return None;
    }
    let mut fence_start = start;
    let line_end = find_line_end(bytes, start);
    let mut spaces = 0usize;
    while fence_start < line_end && bytes[fence_start] == b' ' && spaces < 4 {
        fence_start += 1;
        spaces += 1;
    }
    let fence_char = *bytes.get(fence_start)?;
    if fence_char != b'`' && fence_char != b'~' {
        return None;
    }
    let mut fence_len = 0usize;
    while fence_start + fence_len < line_end && bytes[fence_start + fence_len] == fence_char {
        fence_len += 1;
    }
    if fence_len < 3 {
        return None;
    }

    let mut i = line_end;
    while i < bytes.len() {
        let current_line_end = find_line_end(bytes, i);
        let mut j = i;
        let mut leading_spaces = 0usize;
        while j < current_line_end && bytes[j] == b' ' && leading_spaces < 4 {
            j += 1;
            leading_spaces += 1;
        }
        let mut closing_len = 0usize;
        while j + closing_len < current_line_end && bytes[j + closing_len] == fence_char {
            closing_len += 1;
        }
        if closing_len >= fence_len
            && bytes[j + closing_len..current_line_end]
                .iter()
                .all(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n'))
        {
            return Some(current_line_end);
        }
        i = current_line_end;
    }
    Some(bytes.len())
}

fn is_line_start(bytes: &[u8], pos: usize) -> bool {
    pos == 0 || matches!(bytes.get(pos.wrapping_sub(1)), Some(b'\n' | b'\r'))
}

fn find_line_end(bytes: &[u8], start: usize) -> usize {
    let mut i = start;
    while i < bytes.len() && bytes[i] != b'\n' {
        i += 1;
    }
    if i < bytes.len() {
        i + 1
    } else {
        i
    }
}

fn read_alias_token_end(bytes: &[u8], start: usize) -> usize {
    let mut i = start;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-' {
            i += 1;
        } else {
            break;
        }
    }
    i
}

#[cfg(test)]
mod tests {
    use super::{
        anonymize_text, contains_privacy_aliases, contains_privacy_markers, reveal_text,
        ALIAS_PREFIX,
    };

    const PASSPHRASE: &str = "correct horse battery staple";

    #[test]
    fn anonymizes_short_private_marker() {
        let result = anonymize_text("@p{John} got 9.0", PASSPHRASE).unwrap();
        assert!(result.changed);
        assert_eq!(result.replacements, 1);
        assert!(result.text.starts_with(ALIAS_PREFIX));
        assert!(!result.text.contains("John"));
        assert_eq!(reveal_text(&result.text, PASSPHRASE).text, "John got 9.0");
    }

    #[test]
    fn anonymizes_long_private_marker() {
        let result = anonymize_text("@private{John Smith} got 9.0", PASSPHRASE).unwrap();
        assert_eq!(result.replacements, 1);
        assert!(!result.text.contains("John Smith"));
        assert_eq!(
            reveal_text(&result.text, PASSPHRASE).text,
            "John Smith got 9.0"
        );
    }

    #[test]
    fn aliases_are_deterministic_for_same_passphrase() {
        let first = anonymize_text("@p{John Smith}", PASSPHRASE).unwrap();
        let second = anonymize_text("@p{John Smith}", PASSPHRASE).unwrap();
        assert_eq!(first.text, second.text);
    }

    #[test]
    fn aliases_change_with_passphrase() {
        let first = anonymize_text("@p{John Smith}", PASSPHRASE).unwrap();
        let second = anonymize_text("@p{John Smith}", "different passphrase").unwrap();
        assert_ne!(first.text, second.text);
    }

    #[test]
    fn wrong_passphrase_leaves_alias_unchanged() {
        let anonymized = anonymize_text("Hi @p{John}", PASSPHRASE).unwrap();
        let revealed = reveal_text(&anonymized.text, "wrong passphrase");
        assert!(!revealed.changed);
        assert_eq!(revealed.text, anonymized.text);
    }

    #[test]
    fn escaped_marker_stays_literal() {
        let result = anonymize_text(r"\@p{John} and @p{Mary}", PASSPHRASE).unwrap();
        assert_eq!(result.replacements, 1);
        assert!(result.text.contains(r"\@p{John}"));
        assert!(!result.text.contains("Mary"));
    }

    #[test]
    fn inline_code_is_ignored() {
        let result = anonymize_text("Use `@p{John}` but @p{Mary}", PASSPHRASE).unwrap();
        assert_eq!(result.replacements, 1);
        assert!(result.text.contains("`@p{John}`"));
        assert!(!result.text.contains("Mary"));
    }

    #[test]
    fn arbitrary_backtick_inline_code_is_ignored() {
        let result = anonymize_text("Use ``@p{John}`` but @p{Mary}", PASSPHRASE).unwrap();
        assert_eq!(result.replacements, 1);
        assert!(result.text.contains("``@p{John}``"));
        assert!(!result.text.contains("Mary"));
    }

    #[test]
    fn fenced_code_is_ignored() {
        let input = "Before @p{Mary}\n```\n@p{John}\n```\nAfter";
        let result = anonymize_text(input, PASSPHRASE).unwrap();
        assert_eq!(result.replacements, 1);
        assert!(result.text.contains("@p{John}"));
        assert!(!result.text.contains("Mary"));
    }

    #[test]
    fn tilde_fenced_code_is_ignored() {
        let input = "~~~text\n@p{John}\n~~~\n@p{Mary}";
        let result = anonymize_text(input, PASSPHRASE).unwrap();
        assert_eq!(result.replacements, 1);
        assert!(result.text.contains("@p{John}"));
        assert!(!result.text.contains("Mary"));
    }

    #[test]
    fn malformed_markers_are_unchanged() {
        let input = "@p{} @p{missing @private{}";
        let result = anonymize_text(input, PASSPHRASE).unwrap();
        assert!(!result.changed);
        assert_eq!(result.text, input);
    }

    #[test]
    fn reveal_handles_multiple_aliases() {
        let anonymized = anonymize_text("@p{John}, @private{Mary Smith}", PASSPHRASE).unwrap();
        let revealed = reveal_text(&anonymized.text, PASSPHRASE);
        assert_eq!(revealed.replacements, 2);
        assert_eq!(revealed.text, "John, Mary Smith");
    }

    #[test]
    fn reveal_handles_unicode_text_before_aliases() {
        let alias = anonymize_text("@p{John Smith}", PASSPHRASE).unwrap().text;
        let input = format!("You’re right — déjà vu. {alias} got 9.0.");
        let revealed = reveal_text(&input, PASSPHRASE);
        assert_eq!(revealed.replacements, 1);
        assert_eq!(revealed.text, "You’re right — déjà vu. John Smith got 9.0.");
    }

    #[test]
    fn reveal_leaves_non_aliases_unchanged() {
        let input = "P1_not-valid@@ and plain text";
        let revealed = reveal_text(input, PASSPHRASE);
        assert_eq!(revealed.text, input);
    }

    #[test]
    fn detects_markers_and_aliases() {
        assert!(contains_privacy_markers("Hi @p{John}"));
        assert!(!contains_privacy_markers(r"Hi \@p{John}"));
        let anonymized = anonymize_text("@p{John}", PASSPHRASE).unwrap();
        assert!(contains_privacy_aliases(&anonymized.text));
    }
}
