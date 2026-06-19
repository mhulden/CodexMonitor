use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::shared::process_core::kill_child_process_tree;
use crate::types::{AppSettings, WorkspaceEntry};

use super::helpers::resolve_entry_and_parent;

static CONNECT_WORKSPACE_SPAWN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(super) fn workspace_session_spawn_lock() -> &'static Mutex<()> {
    CONNECT_WORKSPACE_SPAWN_LOCK.get_or_init(|| Mutex::new(()))
}

async fn session_process_is_alive(session: &Arc<WorkspaceSession>) -> bool {
    let mut child = session.child.lock().await;
    matches!(child.try_wait(), Ok(None))
}

async fn remove_session_references(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    session: &Arc<WorkspaceSession>,
) {
    let mut sessions = sessions.lock().await;
    sessions.retain(|_, candidate| !Arc::ptr_eq(candidate, session));
}

pub(super) async fn take_live_shared_session(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
) -> Option<Arc<WorkspaceSession>> {
    loop {
        let existing_session = {
            let sessions = sessions.lock().await;
            sessions.values().next().cloned()
        };
        let Some(existing_session) = existing_session else {
            return None;
        };
        if session_process_is_alive(&existing_session).await {
            return Some(existing_session);
        }
        remove_session_references(sessions, &existing_session).await;
    }
}

pub(crate) async fn connect_workspace_core<F, Fut>(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    let _spawn_guard = workspace_session_spawn_lock().lock().await;
    if let Some(existing_for_entry) = {
        let sessions = sessions.lock().await;
        sessions.get(&entry.id).cloned()
    } {
        if session_process_is_alive(&existing_for_entry).await {
            return Ok(());
        }
        remove_session_references(sessions, &existing_for_entry).await;
    }
    if let Some(existing_session) = take_live_shared_session(sessions).await {
        existing_session
            .register_workspace_with_path(&entry.id, Some(&entry.path))
            .await;
        sessions
            .lock()
            .await
            .insert(entry.id.clone(), existing_session);
        return Ok(());
    }
    let (default_bin, codex_args) = {
        let settings = app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings)),
        )
    };
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    let session = spawn_session(entry.clone(), default_bin, codex_args, codex_home).await?;
    session
        .register_workspace_with_path(&entry.id, Some(&entry.path))
        .await;
    sessions.lock().await.insert(entry.id, session);
    Ok(())
}

pub(crate) async fn restart_workspace_session_core<F, Fut>(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<Vec<String>, String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let _ = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    let _spawn_guard = workspace_session_spawn_lock().lock().await;

    let current_session = {
        let sessions = sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };

    let (spawn_entry_id, affected_ids, old_session) = if let Some(current_session) = current_session
    {
        let owner_workspace_id = current_session.owner_workspace_id.clone();
        let affected_ids = {
            let sessions = sessions.lock().await;
            sessions
                .iter()
                .filter_map(|(id, session)| {
                    if Arc::ptr_eq(session, &current_session) {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        };
        let spawn_entry_id = if affected_ids.iter().any(|id| id == &owner_workspace_id) {
            owner_workspace_id
        } else {
            workspace_id.clone()
        };
        (spawn_entry_id, affected_ids, Some(current_session))
    } else {
        (workspace_id.clone(), vec![workspace_id.clone()], None)
    };

    let (spawn_entry, parent_entry, affected_entries) = {
        let workspaces = workspaces.lock().await;
        let spawn_entry = workspaces
            .get(&spawn_entry_id)
            .cloned()
            .or_else(|| workspaces.get(&workspace_id).cloned())
            .ok_or_else(|| "workspace not found".to_string())?;
        let parent_entry = spawn_entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id))
            .cloned();
        let affected_entries = affected_ids
            .iter()
            .filter_map(|id| workspaces.get(id).cloned())
            .collect::<Vec<_>>();
        (spawn_entry, parent_entry, affected_entries)
    };

    let (default_bin, codex_args) = {
        let settings = app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&spawn_entry, parent_entry.as_ref(), Some(&settings)),
        )
    };
    let codex_home = resolve_workspace_codex_home(&spawn_entry, parent_entry.as_ref());
    let new_session = spawn_session(spawn_entry, default_bin, codex_args, codex_home).await?;

    for entry in &affected_entries {
        new_session
            .register_workspace_with_path(&entry.id, Some(&entry.path))
            .await;
    }

    {
        let mut sessions = sessions.lock().await;
        if let Some(old_session) = old_session.as_ref() {
            sessions.retain(|_, session| !Arc::ptr_eq(session, old_session));
        }
        for entry in &affected_entries {
            sessions.insert(entry.id.clone(), Arc::clone(&new_session));
        }
    }

    if let Some(old_session) = old_session {
        let mut child = old_session.child.lock().await;
        kill_child_process_tree(&mut child).await;
    }

    Ok(affected_entries.into_iter().map(|entry| entry.id).collect())
}

pub(super) async fn kill_session_by_id(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    id: &str,
) {
    let (removed, still_referenced) = {
        let mut sessions = sessions.lock().await;
        let removed = sessions.remove(id);
        let still_referenced = removed.as_ref().is_some_and(|session| {
            sessions
                .values()
                .any(|candidate| Arc::ptr_eq(candidate, session))
        });
        (removed, still_referenced)
    };
    if let Some(session) = removed {
        session.unregister_workspace(id).await;
        if still_referenced {
            return;
        }
        let mut child = session.child.lock().await;
        kill_child_process_tree(&mut child).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::{HashMap, HashSet};
    use std::process::Stdio;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;

    use tokio::process::Command;
    use tokio::sync::Mutex;

    use crate::types::{WorkspaceKind, WorkspaceSettings};

    fn make_workspace_entry(id: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: "/tmp".to_string(),
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn make_session(entry: WorkspaceEntry) -> Arc<WorkspaceSession> {
        make_session_with_owner(entry.clone(), &entry.id)
    }

    fn make_session_with_owner(
        _entry: WorkspaceEntry,
        owner_workspace_id: &str,
    ) -> Arc<WorkspaceSession> {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "more"]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", "cat"]);
            cmd
        };

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd.spawn().expect("spawn dummy child");
        let stdin = child.stdin.take().expect("dummy child stdin");

        Arc::new(WorkspaceSession {
            codex_args: None,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            request_context: Mutex::new(HashMap::new()),
            thread_workspace: Mutex::new(HashMap::new()),
            hidden_thread_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(0),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            owner_workspace_id: owner_workspace_id.to_string(),
            workspace_ids: Mutex::new(HashSet::from([owner_workspace_id.to_string()])),
            workspace_roots: Mutex::new(HashMap::new()),
        })
    }

    #[test]
    fn connect_workspace_is_noop_when_already_connected() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-1");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::from([(
                entry.id.clone(),
                make_session(entry.clone()),
            )]));
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            connect_workspace_core(
                entry.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Err("should not spawn".to_string())
                    }
                },
            )
            .await
            .expect("connect should be noop");

            assert_eq!(spawn_calls.load(Ordering::SeqCst), 0);
            kill_session_by_id(&sessions, &entry.id).await;
        });
    }

    #[test]
    fn connect_workspace_spawns_when_not_connected() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-2");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();
            let entry_for_spawn = entry.clone();

            connect_workspace_core(
                entry.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    let entry_for_spawn = entry_for_spawn.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(entry_for_spawn))
                    }
                },
            )
            .await
            .expect("connect should spawn");

            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);
            assert!(sessions.lock().await.contains_key(&entry.id));
            kill_session_by_id(&sessions, &entry.id).await;
        });
    }

    #[test]
    fn restart_workspace_session_spawns_when_not_connected() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-restart");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();
            let entry_for_spawn = entry.clone();

            let restarted = restart_workspace_session_core(
                entry.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    let entry_for_spawn = entry_for_spawn.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session(entry_for_spawn))
                    }
                },
            )
            .await
            .expect("restart should spawn");

            assert_eq!(restarted, vec![entry.id.clone()]);
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);
            assert!(sessions.lock().await.contains_key(&entry.id));
            kill_session_by_id(&sessions, &entry.id).await;
        });
    }

    #[test]
    fn restart_workspace_session_replaces_only_shared_session_group() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry_a = make_workspace_entry("ws-a");
            let entry_b = make_workspace_entry("ws-b");
            let entry_c = make_workspace_entry("ws-c");
            let workspaces = Mutex::new(HashMap::from([
                (entry_a.id.clone(), entry_a.clone()),
                (entry_b.id.clone(), entry_b.clone()),
                (entry_c.id.clone(), entry_c.clone()),
            ]));
            let shared_session = make_session_with_owner(entry_a.clone(), &entry_a.id);
            shared_session
                .register_workspace_with_path(&entry_b.id, Some(&entry_b.path))
                .await;
            let unrelated_session = make_session_with_owner(entry_c.clone(), &entry_c.id);
            let sessions = Mutex::new(HashMap::from([
                (entry_a.id.clone(), Arc::clone(&shared_session)),
                (entry_b.id.clone(), Arc::clone(&shared_session)),
                (entry_c.id.clone(), Arc::clone(&unrelated_session)),
            ]));
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();
            let entry_for_spawn = entry_a.clone();

            let restarted = restart_workspace_session_core(
                entry_b.id.clone(),
                &workspaces,
                &sessions,
                &app_settings,
                move |_entry, _default_bin, _codex_args, _codex_home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    let entry_for_spawn = entry_for_spawn.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(make_session_with_owner(entry_for_spawn, "ws-a"))
                    }
                },
            )
            .await
            .expect("restart should replace shared session");

            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);
            assert_eq!(restarted.len(), 2);
            assert!(restarted.contains(&entry_a.id));
            assert!(restarted.contains(&entry_b.id));

            let sessions = sessions.lock().await;
            let next_a = sessions.get(&entry_a.id).expect("ws-a session");
            let next_b = sessions.get(&entry_b.id).expect("ws-b session");
            let next_c = sessions.get(&entry_c.id).expect("ws-c session");
            assert!(Arc::ptr_eq(next_a, next_b));
            assert!(!Arc::ptr_eq(next_a, &shared_session));
            assert!(Arc::ptr_eq(next_c, &unrelated_session));
        });
    }
}
