use crate::shared::privacy_alias_core::{
    anonymize_text, contains_privacy_aliases, contains_privacy_markers, reveal_text,
    PrivacyTransform,
};

#[tauri::command]
pub(crate) fn privacy_alias_anonymize_text(
    text: String,
    passphrase: String,
) -> Result<PrivacyTransform, String> {
    anonymize_text(&text, &passphrase)
}

#[tauri::command]
pub(crate) fn privacy_alias_reveal_text(text: String, passphrase: String) -> PrivacyTransform {
    reveal_text(&text, &passphrase)
}

#[tauri::command]
pub(crate) fn privacy_alias_contains_markers(text: String) -> bool {
    contains_privacy_markers(&text)
}

#[tauri::command]
pub(crate) fn privacy_alias_contains_aliases(text: String) -> bool {
    contains_privacy_aliases(&text)
}
