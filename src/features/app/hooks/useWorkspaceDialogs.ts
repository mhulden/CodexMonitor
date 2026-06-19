import { useCallback, useEffect, useRef, useState } from "react";
import { ask, message } from "@tauri-apps/plugin-dialog";
import type { WorkspaceInfo } from "../../../types";
import { pickWorkspacePaths } from "../../../services/tauri";
import type { AddWorkspacesFromPathsResult } from "../../workspaces/hooks/useWorkspaceCrud";

const RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY = "remote-workspace-recent-paths";
const LEGACY_RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY =
  "mobile-remote-workspace-recent-paths";
const RECENT_REMOTE_WORKSPACE_PATHS_LIMIT = 5;

function parseWorkspacePathInput(value: string) {
  const stripWrappingQuotes = (entry: string) => {
    const trimmed = entry.trim();
    if (trimmed.length < 2) {
      return trimmed;
    }
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" || first === '"') && first === last) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  return value
    .split(/\r?\n|,|;/)
    .map((entry) => stripWrappingQuotes(entry))
    .filter(Boolean);
}

function appendPathIfMissing(value: string, path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return value;
  }
  const entries = parseWorkspacePathInput(value);
  if (entries.includes(trimmedPath)) {
    return value;
  }
  return [...entries, trimmedPath].join("\n");
}

function loadRecentRemoteWorkspacePaths(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw =
    window.localStorage.getItem(RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, RECENT_REMOTE_WORKSPACE_PATHS_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentRemoteWorkspacePaths(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY,
    JSON.stringify(paths),
  );
  window.localStorage.removeItem(LEGACY_RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY);
}

function mergeRecentRemoteWorkspacePaths(current: string[], nextPaths: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const push = (entry: string) => {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    merged.push(trimmed);
  };
  nextPaths.forEach(push);
  current.forEach(push);
  return merged.slice(0, RECENT_REMOTE_WORKSPACE_PATHS_LIMIT);
}

type RemoteWorkspacePathPromptState = {
  value: string;
  error: string | null;
  recentPaths: string[];
} | null;

export function useWorkspaceDialogs() {
  const [recentRemoteWorkspacePaths, setRecentRemoteWorkspacePaths] = useState<
    string[]
  >(() => loadRecentRemoteWorkspacePaths());
  const [remoteWorkspacePathPrompt, setRemoteWorkspacePathPrompt] =
    useState<RemoteWorkspacePathPromptState>(null);
  const remoteWorkspacePathResolveRef = useRef<((paths: string[]) => void) | null>(
    null,
  );

  const resolveRemoteWorkspacePathRequest = useCallback((paths: string[]) => {
    const resolve = remoteWorkspacePathResolveRef.current;
    remoteWorkspacePathResolveRef.current = null;
    if (resolve) {
      resolve(paths);
    }
  }, []);

  const requestRemoteWorkspacePaths = useCallback(() => {
    if (remoteWorkspacePathResolveRef.current) {
      resolveRemoteWorkspacePathRequest([]);
    }

    setRemoteWorkspacePathPrompt({
      value: "",
      error: null,
      recentPaths: recentRemoteWorkspacePaths,
    });

    return new Promise<string[]>((resolve) => {
      remoteWorkspacePathResolveRef.current = resolve;
    });
  }, [recentRemoteWorkspacePaths, resolveRemoteWorkspacePathRequest]);

  const updateRemoteWorkspacePathInput = useCallback((value: string) => {
    setRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            value,
            error: null,
          }
        : prev,
    );
  }, []);

  const cancelRemoteWorkspacePathPrompt = useCallback(() => {
    setRemoteWorkspacePathPrompt(null);
    resolveRemoteWorkspacePathRequest([]);
  }, [resolveRemoteWorkspacePathRequest]);

  const appendRemoteWorkspacePathFromRecent = useCallback((path: string) => {
    setRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            value: appendPathIfMissing(prev.value, path),
            error: null,
          }
        : prev,
    );
  }, []);

  const rememberRecentRemoteWorkspacePaths = useCallback((paths: string[]) => {
    setRecentRemoteWorkspacePaths((prev) => {
      const next = mergeRecentRemoteWorkspacePaths(prev, paths);
      persistRecentRemoteWorkspacePaths(next);
      return next;
    });
    setRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            recentPaths: mergeRecentRemoteWorkspacePaths(prev.recentPaths, paths),
          }
        : prev,
    );
  }, []);

  const submitRemoteWorkspacePathPrompt = useCallback(() => {
    if (!remoteWorkspacePathPrompt) {
      return;
    }
    const paths = parseWorkspacePathInput(remoteWorkspacePathPrompt.value);
    if (paths.length === 0) {
      setRemoteWorkspacePathPrompt((prev) =>
        prev
          ? {
              ...prev,
              error: "Enter at least one absolute directory path.",
            }
          : prev,
      );
      return;
    }
    setRemoteWorkspacePathPrompt(null);
    resolveRemoteWorkspacePathRequest(paths);
  }, [remoteWorkspacePathPrompt, resolveRemoteWorkspacePathRequest]);

  useEffect(() => {
    return () => {
      resolveRemoteWorkspacePathRequest([]);
    };
  }, [resolveRemoteWorkspacePathRequest]);

  const requestWorkspacePaths = useCallback(async (backendMode?: string) => {
    if (backendMode === "remote") {
      return requestRemoteWorkspacePaths();
    }
    return pickWorkspacePaths();
  }, [requestRemoteWorkspacePaths]);

  const showAddWorkspacesResult = useCallback(
    async (result: AddWorkspacesFromPathsResult) => {
      const hasIssues =
        result.skippedExisting.length > 0 ||
        result.skippedInvalid.length > 0 ||
        result.failures.length > 0;
      if (!hasIssues) {
        return;
      }

      const lines: string[] = [];
      lines.push(
        `Added ${result.added.length} workspace${result.added.length === 1 ? "" : "s"}.`,
      );
      if (result.skippedExisting.length > 0) {
        lines.push(
          `Skipped ${result.skippedExisting.length} already added workspace${
            result.skippedExisting.length === 1 ? "" : "s"
          }.`,
        );
      }
      if (result.skippedInvalid.length > 0) {
        lines.push(
          `Skipped ${result.skippedInvalid.length} invalid path${
            result.skippedInvalid.length === 1 ? "" : "s"
          } (not a folder).`,
        );
      }
      if (result.failures.length > 0) {
        lines.push(
          `Failed to add ${result.failures.length} workspace${
            result.failures.length === 1 ? "" : "s"
          }.`,
        );
        const details = result.failures
          .slice(0, 3)
          .map(({ path, message: failureMessage }) => `- ${path}: ${failureMessage}`);
        if (result.failures.length > 3) {
          details.push(`- …and ${result.failures.length - 3} more`);
        }
        lines.push("");
        lines.push("Failures:");
        lines.push(...details);
      }

      const title =
        result.failures.length > 0
          ? "Some workspaces failed to add"
          : "Some workspaces were skipped";
      await message(lines.join("\n"), {
        title,
        kind: result.failures.length > 0 ? "error" : "warning",
      });
    },
    [],
  );

  const confirmWorkspaceRemoval = useCallback(
    async (workspaces: WorkspaceInfo[], workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const workspaceName = workspace?.name || "this workspace";
      const worktreeCount = workspaces.filter(
        (entry) => entry.parentId === workspaceId,
      ).length;
      const detail =
        worktreeCount > 0
          ? `\n\nThis will also delete ${worktreeCount} worktree${
              worktreeCount === 1 ? "" : "s"
            } on disk.`
          : "";

      return ask(
        `Are you sure you want to delete "${workspaceName}"?\n\nThis will remove the workspace from CodexMonitor.${detail}`,
        {
          title: "Delete Workspace",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
    },
    [],
  );

  const confirmWorktreeRemoval = useCallback(
    async (workspaces: WorkspaceInfo[], workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const workspaceName = workspace?.name || "this worktree";
      return ask(
        `Are you sure you want to delete "${workspaceName}"?\n\nThis will close the agent, remove its worktree, and delete it from CodexMonitor.`,
        {
          title: "Delete Worktree",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
    },
    [],
  );

  const showWorkspaceRemovalError = useCallback(async (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await message(errorMessage, {
      title: "Delete workspace failed",
      kind: "error",
    });
  }, []);

  const showWorktreeRemovalError = useCallback(async (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await message(errorMessage, {
      title: "Delete worktree failed",
      kind: "error",
    });
  }, []);

  return {
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
  };
}
