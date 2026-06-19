import { useCallback } from "react";
import { useWorkspaces } from "../../workspaces/hooks/useWorkspaces";
import type { AppSettings, WorkspaceInfo } from "../../../types";
import type { DebugEntry } from "../../../types";
import { useWorkspaceDialogs } from "./useWorkspaceDialogs";

type WorkspaceControllerOptions = {
  appSettings: AppSettings;
  addDebugEntry: (entry: DebugEntry) => void;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
};

export function useWorkspaceController({
  appSettings,
  addDebugEntry,
  queueSaveSettings,
}: WorkspaceControllerOptions) {
  const workspaceCore = useWorkspaces({
    onDebug: addDebugEntry,
    appSettings,
    onUpdateAppSettings: queueSaveSettings,
  });

  const {
    workspaces,
    addWorkspacesFromPaths: addWorkspacesFromPathsCore,
    removeWorkspace: removeWorkspaceCore,
    removeWorktree: removeWorktreeCore,
  } = workspaceCore;

  const {
    requestWorkspacePaths,
    remoteWorkspacePathPrompt,
    updateRemoteWorkspacePathInput,
    cancelRemoteWorkspacePathPrompt,
    submitRemoteWorkspacePathPrompt,
    appendRemoteWorkspacePathFromRecent,
    rememberRecentRemoteWorkspacePaths,
    showAddWorkspacesResult,
    confirmWorkspaceRemoval,
    confirmWorktreeRemoval,
    showWorkspaceRemovalError,
    showWorktreeRemovalError,
  } = useWorkspaceDialogs();

  const runAddWorkspacesFromPaths = useCallback(
    async (
      paths: string[],
      options?: { rememberRemoteRecents?: boolean },
    ) => {
      const result = await addWorkspacesFromPathsCore(paths);
      await showAddWorkspacesResult(result);
      if (options?.rememberRemoteRecents && result.added.length > 0) {
        rememberRecentRemoteWorkspacePaths(result.added.map((entry) => entry.path));
      }
      return result;
    },
    [
      addWorkspacesFromPathsCore,
      rememberRecentRemoteWorkspacePaths,
      showAddWorkspacesResult,
    ],
  );

  const addWorkspacesFromPaths = useCallback(
    async (paths: string[]): Promise<WorkspaceInfo | null> => {
      const result = await runAddWorkspacesFromPaths(paths);
      return result.firstAdded;
    },
    [runAddWorkspacesFromPaths],
  );

  const addWorkspace = useCallback(async (): Promise<WorkspaceInfo | null> => {
    const paths = await requestWorkspacePaths(appSettings.backendMode);
    if (paths.length === 0) {
      return null;
    }
    const result = await runAddWorkspacesFromPaths(paths, {
      rememberRemoteRecents: appSettings.backendMode === "remote",
    });
    return result.firstAdded;
  }, [appSettings.backendMode, requestWorkspacePaths, runAddWorkspacesFromPaths]);

  const removeWorkspace = useCallback(
    async (workspaceId: string) => {
      const confirmed = await confirmWorkspaceRemoval(workspaces, workspaceId);
      if (!confirmed) {
        return;
      }
      try {
        await removeWorkspaceCore(workspaceId);
      } catch (error) {
        await showWorkspaceRemovalError(error);
      }
    },
    [confirmWorkspaceRemoval, removeWorkspaceCore, showWorkspaceRemovalError, workspaces],
  );

  const removeWorktree = useCallback(
    async (workspaceId: string) => {
      const confirmed = await confirmWorktreeRemoval(workspaces, workspaceId);
      if (!confirmed) {
        return;
      }
      try {
        await removeWorktreeCore(workspaceId);
      } catch (error) {
        await showWorktreeRemovalError(error);
      }
    },
    [confirmWorktreeRemoval, removeWorktreeCore, showWorktreeRemovalError, workspaces],
  );

  return {
    ...workspaceCore,
    addWorkspace,
    addWorkspacesFromPaths,
    remoteWorkspacePathPrompt,
    updateRemoteWorkspacePathInput,
    cancelRemoteWorkspacePathPrompt,
    submitRemoteWorkspacePathPrompt,
    appendRemoteWorkspacePathFromRecent,
    removeWorkspace,
    removeWorktree,
  };
}
