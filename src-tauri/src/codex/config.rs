use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::shared::config_toml_core;
use crate::types::AppSettings;

pub(crate) fn read_steer_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("steer")
}

pub(crate) fn read_collaboration_modes_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("collaboration_modes")
}

pub(crate) fn read_unified_exec_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("unified_exec")
}

pub(crate) fn read_apps_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("apps")
}

pub(crate) fn read_personality() -> Result<Option<String>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(read_personality_from_document(&document))
}

pub(crate) fn write_steer_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("steer", enabled)
}

pub(crate) fn write_collaboration_modes_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("collaboration_modes", enabled)
}

pub(crate) fn write_unified_exec_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("unified_exec", enabled)
}

pub(crate) fn write_apps_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("apps", enabled)
}

pub(crate) fn write_feature_enabled(feature_key: &str, enabled: bool) -> Result<(), String> {
    let key = feature_key.trim();
    if key.is_empty() {
        return Err("feature key is empty".to_string());
    }
    if key.eq_ignore_ascii_case("collab") {
        return Err("feature key `collab` is no longer supported; use `multi_agent`".to_string());
    }
    write_feature_flag(key, enabled)
}

pub(crate) fn write_personality(personality: &str) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    let normalized = normalize_personality_value(personality);
    config_toml_core::set_top_level_string(&mut document, "personality", normalized);
    config_toml_core::persist_global_config_document(&root, &document)
}

fn read_feature_flag(key: &str) -> Result<Option<bool>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_feature_flag(&document, key))
}

fn write_feature_flag(key: &str, enabled: bool) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    config_toml_core::set_feature_flag(&mut document, key, enabled)?;
    config_toml_core::persist_global_config_document(&root, &document)
}

pub(crate) fn config_toml_path() -> Option<PathBuf> {
    resolve_default_codex_home().map(|home| home.join("config.toml"))
}

pub(crate) fn read_config_model(codex_home: Option<PathBuf>) -> Result<Option<String>, String> {
    let root = codex_home.or_else(resolve_default_codex_home);
    let Some(root) = root else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_top_level_string(&document, "model"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexProviderSummary {
    pub(crate) id: String,
    pub(crate) name: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) wire_api: Option<String>,
    pub(crate) auth: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexProfileSummary {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) model: Option<String>,
    pub(crate) model_provider: Option<String>,
    pub(crate) provider_name: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) codex_args: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexConfigSummary {
    pub(crate) codex_home: String,
    pub(crate) codex_bin: Option<String>,
    pub(crate) codex_args: Option<String>,
    pub(crate) active_profile: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) model_provider: Option<String>,
    pub(crate) provider_name: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) profiles: Vec<CodexProfileSummary>,
    pub(crate) providers: Vec<CodexProviderSummary>,
    pub(crate) errors: Vec<String>,
}

pub(crate) fn read_config_summary(
    codex_home: PathBuf,
    app_settings: &AppSettings,
) -> Result<CodexConfigSummary, String> {
    let (_, base_document) = config_toml_core::load_global_config_document(&codex_home)?;
    let model = config_toml_core::read_top_level_string(&base_document, "model");
    let model_provider = config_toml_core::read_top_level_string(&base_document, "model_provider");
    let active_profile = active_profile_from_args(app_settings.codex_args.as_deref());
    let provider = model_provider
        .as_deref()
        .and_then(|provider_id| provider_summary_from_documents(provider_id, None, &base_document));
    let mut providers = provider_summaries_from_document(&base_document);
    let mut errors = Vec::new();
    let profiles = read_profile_summaries(&codex_home, &base_document, &mut providers, &mut errors);
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    providers.dedup_by(|left, right| left.id == right.id);

    Ok(CodexConfigSummary {
        codex_home: codex_home.to_string_lossy().to_string(),
        codex_bin: app_settings.codex_bin.clone(),
        codex_args: app_settings.codex_args.clone(),
        active_profile,
        model,
        model_provider,
        provider_name: provider.as_ref().and_then(|entry| entry.name.clone()),
        base_url: provider.as_ref().and_then(|entry| entry.base_url.clone()),
        profiles,
        providers,
        errors,
    })
}

fn read_profile_summaries(
    codex_home: &Path,
    base_document: &toml_edit::Document,
    providers: &mut Vec<CodexProviderSummary>,
    errors: &mut Vec<String>,
) -> Vec<CodexProfileSummary> {
    let entries = match fs::read_dir(codex_home) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(err) => {
            errors.push(format!(
                "Failed to read CODEX_HOME at {}: {err}",
                codex_home.display()
            ));
            return Vec::new();
        }
    };

    let mut profiles = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(profile_name) = file_name.strip_suffix(".config.toml") else {
            continue;
        };
        if profile_name == "config" || !is_valid_profile_name(profile_name) {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(err) => {
                errors.push(format!("Failed to read profile {file_name}: {err}"));
                continue;
            }
        };
        let document = match config_toml_core::parse_document(&content) {
            Ok(document) => document,
            Err(err) => {
                errors.push(format!("Failed to parse profile {file_name}: {err}"));
                continue;
            }
        };
        let model = config_toml_core::read_top_level_string(&document, "model")
            .or_else(|| config_toml_core::read_top_level_string(base_document, "model"));
        let model_provider = config_toml_core::read_top_level_string(&document, "model_provider")
            .or_else(|| config_toml_core::read_top_level_string(base_document, "model_provider"));
        let provider = model_provider.as_deref().and_then(|provider_id| {
            provider_summary_from_documents(provider_id, Some(&document), base_document)
        });
        if let Some(provider) = provider.as_ref() {
            providers.push(provider.clone());
        }
        profiles.push(CodexProfileSummary {
            name: profile_name.to_string(),
            path: path.to_string_lossy().to_string(),
            model,
            model_provider,
            provider_name: provider.as_ref().and_then(|entry| entry.name.clone()),
            base_url: provider.as_ref().and_then(|entry| entry.base_url.clone()),
            codex_args: shell_words::join(&["--profile", profile_name]),
        });
    }
    profiles.sort_by(|left, right| left.name.cmp(&right.name));
    profiles
}

fn active_profile_from_args(args: Option<&str>) -> Option<String> {
    let args = args?;
    let tokens = shell_words::split(args).ok()?;
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        if token == "--profile" || token == "-p" {
            return tokens.get(index + 1).cloned();
        }
        if let Some(value) = token.strip_prefix("--profile=") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        index += 1;
    }
    None
}

fn is_valid_profile_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
}

fn provider_summaries_from_document(document: &toml_edit::Document) -> Vec<CodexProviderSummary> {
    let Some(table) = document
        .get("model_providers")
        .and_then(toml_edit::Item::as_table_like)
    else {
        return Vec::new();
    };

    table
        .iter()
        .filter_map(|(id, item)| provider_summary_from_item(id, item))
        .collect()
}

fn provider_summary_from_documents(
    id: &str,
    profile_document: Option<&toml_edit::Document>,
    base_document: &toml_edit::Document,
) -> Option<CodexProviderSummary> {
    profile_document
        .and_then(|document| provider_item(document, id))
        .and_then(|item| provider_summary_from_item(id, item))
        .or_else(|| {
            provider_item(base_document, id).and_then(|item| provider_summary_from_item(id, item))
        })
}

fn provider_item<'a>(document: &'a toml_edit::Document, id: &str) -> Option<&'a toml_edit::Item> {
    document
        .get("model_providers")
        .and_then(toml_edit::Item::as_table_like)
        .and_then(|table| table.get(id))
}

fn provider_summary_from_item(id: &str, item: &toml_edit::Item) -> Option<CodexProviderSummary> {
    let table = item.as_table_like()?;
    let name = read_table_string(table, "name");
    let base_url = read_table_string(table, "base_url").map(|value| sanitize_base_url(&value));
    let wire_api = read_table_string(table, "wire_api");
    let auth = if table
        .get("requires_openai_auth")
        .and_then(toml_edit::Item::as_bool)
        .unwrap_or(false)
    {
        "openai".to_string()
    } else if read_table_string(table, "env_key").is_some() {
        "environment".to_string()
    } else if table
        .get("auth")
        .and_then(toml_edit::Item::as_table_like)
        .is_some()
    {
        "command".to_string()
    } else {
        "none".to_string()
    };
    Some(CodexProviderSummary {
        id: id.to_string(),
        name,
        base_url,
        wire_api,
        auth,
    })
}

fn read_table_string(table: &dyn toml_edit::TableLike, key: &str) -> Option<String> {
    let value = table.get(key).and_then(toml_edit::Item::as_str)?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn sanitize_base_url(value: &str) -> String {
    let without_fragment = value.split('#').next().unwrap_or(value);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);
    let Some((scheme, rest)) = without_query.split_once("://") else {
        return without_query.to_string();
    };
    let slash_index = rest.find('/').unwrap_or(rest.len());
    let (authority, path) = rest.split_at(slash_index);
    let authority = if authority.contains('@') {
        match authority.rsplit_once('@') {
            Some((_, host)) => format!("[redacted]@{host}"),
            None => authority.to_string(),
        }
    } else {
        authority.to_string()
    };
    format!("{scheme}://{authority}{path}")
}

fn resolve_default_codex_home() -> Option<PathBuf> {
    crate::codex::home::resolve_default_codex_home()
}

fn read_personality_from_document(document: &toml_edit::Document) -> Option<String> {
    config_toml_core::read_top_level_string(document, "personality")
        .as_deref()
        .and_then(normalize_personality_value)
        .map(|value| value.to_string())
}

fn normalize_personality_value(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "friendly" => Some("friendly"),
        "pragmatic" => Some("pragmatic"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_personality_value, read_config_summary, read_personality_from_document};
    use crate::shared::config_toml_core;
    use crate::types::AppSettings;
    use std::fs;
    use uuid::Uuid;

    fn temp_codex_home() -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("codex-monitor-profile-summary-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp CODEX_HOME");
        dir
    }

    #[test]
    fn parse_personality_reads_supported_values() {
        let friendly =
            config_toml_core::parse_document("personality = \"friendly\"\n").expect("parse");
        let pragmatic =
            config_toml_core::parse_document("personality = \"pragmatic\"\n").expect("parse");
        let unknown =
            config_toml_core::parse_document("personality = \"unknown\"\n").expect("parse");

        assert_eq!(
            read_personality_from_document(&friendly),
            Some("friendly".to_string())
        );
        assert_eq!(
            read_personality_from_document(&pragmatic),
            Some("pragmatic".to_string())
        );
        assert_eq!(read_personality_from_document(&unknown), None);
    }

    #[test]
    fn normalize_personality_is_case_insensitive() {
        assert_eq!(normalize_personality_value("Friendly"), Some("friendly"));
        assert_eq!(normalize_personality_value("PRAGMATIC"), Some("pragmatic"));
        assert_eq!(normalize_personality_value("unknown"), None);
    }

    #[test]
    fn config_summary_reads_custom_profile_models_and_safe_provider_fields() {
        let codex_home = temp_codex_home();
        fs::write(
            codex_home.join("config.toml"),
            r#"
model = "gpt-5.5"
model_provider = "openai"

[model_providers.qwen-local]
name = "Qwen 3.8 Flash (local vLLM)"
base_url = "http://127.0.0.1:18300/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "SHOULD_NOT_LEAK_AS_VALUE"
"#,
        )
        .expect("write config");
        fs::write(
            codex_home.join("qwen.config.toml"),
            r#"
model = "qwen3.8-flash-next"
model_provider = "qwen-local"
"#,
        )
        .expect("write profile");

        let mut settings = AppSettings::default();
        settings.codex_args = Some("--profile qwen".to_string());
        let summary = read_config_summary(codex_home.clone(), &settings).expect("summary");

        assert_eq!(summary.codex_home, codex_home.to_string_lossy());
        assert_eq!(summary.active_profile.as_deref(), Some("qwen"));
        assert_eq!(summary.model.as_deref(), Some("gpt-5.5"));
        assert_eq!(summary.profiles.len(), 1);
        let profile = &summary.profiles[0];
        assert_eq!(profile.name, "qwen");
        assert_eq!(profile.model.as_deref(), Some("qwen3.8-flash-next"));
        assert_eq!(profile.model_provider.as_deref(), Some("qwen-local"));
        assert_eq!(
            profile.provider_name.as_deref(),
            Some("Qwen 3.8 Flash (local vLLM)")
        );
        assert_eq!(
            profile.base_url.as_deref(),
            Some("http://127.0.0.1:18300/v1")
        );
        assert_eq!(profile.codex_args, "--profile qwen");
        assert_eq!(summary.providers[0].auth, "environment");
        assert!(!serde_json::to_string(&summary)
            .expect("serialize")
            .contains("SHOULD_NOT_LEAK_AS_VALUE"));

        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn config_summary_accepts_dotted_profile_names() {
        let codex_home = temp_codex_home();
        fs::write(
            codex_home.join("gpt-5.5.config.toml"),
            "model = \"gpt-5.5-local\"\n",
        )
        .expect("write profile");

        let summary =
            read_config_summary(codex_home.clone(), &AppSettings::default()).expect("summary");

        assert_eq!(summary.profiles.len(), 1);
        assert_eq!(summary.profiles[0].name, "gpt-5.5");
        assert_eq!(summary.profiles[0].codex_args, "--profile gpt-5.5");

        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn config_summary_reports_profile_parse_errors_without_failing_all_profiles() {
        let codex_home = temp_codex_home();
        fs::write(codex_home.join("config.toml"), "model = \"gpt-5.5\"\n").expect("write config");
        fs::write(codex_home.join("bad.config.toml"), "model = [").expect("write bad profile");
        fs::write(
            codex_home.join("good.config.toml"),
            "model = \"local-model\"\n",
        )
        .expect("write good profile");

        let summary =
            read_config_summary(codex_home.clone(), &AppSettings::default()).expect("summary");

        assert_eq!(summary.profiles.len(), 1);
        assert_eq!(summary.profiles[0].name, "good");
        assert_eq!(summary.errors.len(), 1);
        assert!(summary.errors[0].contains("bad.config.toml"));

        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn config_summary_redacts_provider_url_credentials_and_query() {
        let codex_home = temp_codex_home();
        fs::write(
            codex_home.join("config.toml"),
            r#"
[model_providers.remote]
name = "Remote"
base_url = "https://user:secret@example.test/v1?api_key=hidden#frag"
"#,
        )
        .expect("write config");
        fs::write(
            codex_home.join("remote.config.toml"),
            r#"
model = "remote-model"
model_provider = "remote"
"#,
        )
        .expect("write profile");

        let summary =
            read_config_summary(codex_home.clone(), &AppSettings::default()).expect("summary");
        let profile = &summary.profiles[0];
        assert_eq!(
            profile.base_url.as_deref(),
            Some("https://[redacted]@example.test/v1")
        );
        let serialized = serde_json::to_string(&summary).expect("serialize");
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("api_key"));

        let _ = fs::remove_dir_all(codex_home);
    }
}
