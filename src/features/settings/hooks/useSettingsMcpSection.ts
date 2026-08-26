import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppServerEvent, WorkspaceInfo } from "@/types";
import { listMcpServerStatus, reloadMcpServerConfig } from "@services/tauri";
import { subscribeAppServerEvents } from "@services/events";
import {
  getAppServerParams,
  getAppServerRawMethod,
  isMcpDiagnosticEvent,
  isMcpOauthLoginCompletedEvent,
  isMcpStartupStatusUpdatedEvent,
  isMcpToolCallProgressEvent,
} from "@utils/appServerEvents";

export type McpServerDisplay = {
  id: string;
  name: string;
  enabled: boolean | null;
  authStatus: string | null;
  startupStatus: string | null;
  toolNames: string[];
  detail: string | null;
};

export type McpDiagnostic = {
  id: string;
  timestamp: number;
  method: string;
  serverName: string | null;
  title: string;
  detail: string | null;
  tone: "info" | "success" | "warning" | "error";
};

export type SettingsMcpSectionProps = {
  connectedWorkspaces: WorkspaceInfo[];
  selectedWorkspaceId: string | null;
  selectedWorkspace: WorkspaceInfo | null;
  servers: McpServerDisplay[];
  diagnostics: McpDiagnostic[];
  isLoading: boolean;
  isReloading: boolean;
  error: string | null;
  copyStatus: "idle" | "copied" | "failed";
  lastUpdatedAt: number | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onRefresh: () => void;
  onReload: () => void;
  onCopyDiagnosticReport: () => void;
  onClearDiagnostics: () => void;
};

const MAX_DIAGNOSTICS = 12;

function normalizeText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeStatus(value: unknown): string | null {
  const direct = normalizeText(value);
  if (direct) {
    return direct;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return (
      normalizeText(record.status) ??
      normalizeText(record.state) ??
      normalizeText(record.type) ??
      normalizeText(record.message)
    );
  }
  return null;
}

function extractResponseData(response: unknown): Array<Record<string, unknown>> {
  const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const result = root.result && typeof root.result === "object"
    ? root.result as Record<string, unknown>
    : root;
  const data = Array.isArray(result.data) ? result.data : [];
  return data.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function normalizeToolNames(server: Record<string, unknown>, serverName: string): string[] {
  const tools = server.tools;
  const rawNames = Array.isArray(tools)
    ? tools.map((tool) => {
        if (typeof tool === "string") {
          return tool;
        }
        if (tool && typeof tool === "object" && !Array.isArray(tool)) {
          const record = tool as Record<string, unknown>;
          return normalizeText(record.name ?? record.id ?? record.toolName ?? record.tool_name);
        }
        return null;
      })
    : tools && typeof tools === "object"
      ? Object.keys(tools as Record<string, unknown>)
      : [];

  const prefix = `mcp__${serverName}__`;
  return rawNames
    .map((name) => normalizeText(name))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.startsWith(prefix) ? name.slice(prefix.length) : name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeServer(server: Record<string, unknown>, index: number): McpServerDisplay {
  const name =
    normalizeText(
      server.name ??
        server.serverName ??
        server.server_name ??
        server.id ??
        server.serverId ??
        server.server_id,
    ) ?? `server-${index + 1}`;
  const enabledRaw = server.enabled ?? server.isEnabled ?? server.is_enabled ?? null;
  const enabled = typeof enabledRaw === "boolean" ? enabledRaw : null;
  const authStatus = normalizeStatus(server.authStatus ?? server.auth_status ?? server.auth);
  const startupStatus = normalizeStatus(
    server.startupStatus ?? server.startup_status ?? server.status ?? server.state,
  );
  const detail =
    normalizeText(server.message) ??
    normalizeText(server.error) ??
    normalizeText(server.description) ??
    normalizeText(server.command) ??
    normalizeText(server.url);

  return {
    id: name,
    name,
    enabled,
    authStatus,
    startupStatus,
    toolNames: normalizeToolNames(server, name),
    detail,
  };
}

function extractServerName(params: Record<string, unknown>): string | null {
  const server = params.server;
  return (
    normalizeText(params.serverName) ??
    normalizeText(params.server_name) ??
    normalizeText(params.name) ??
    normalizeText(params.serverId) ??
    normalizeText(params.server_id) ??
    (server && typeof server === "object" && !Array.isArray(server)
      ? normalizeText((server as Record<string, unknown>).name)
      : null)
  );
}

function extractEventDetail(params: Record<string, unknown>): string | null {
  const detail =
    normalizeText(params.message) ??
    normalizeText(params.error) ??
    normalizeText(params.status) ??
    normalizeText(params.state) ??
    normalizeText(params.progress) ??
    normalizeText(params.detail);
  if (detail) {
    return detail;
  }
  const toolName = normalizeText(params.toolName ?? params.tool_name ?? params.name);
  if (toolName) {
    return `Tool: ${toolName}`;
  }
  return null;
}

function statusTone(value: string | null): McpDiagnostic["tone"] {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("fail") || lower.includes("error") || lower.includes("denied")) {
    return "error";
  }
  if (lower.includes("require") || lower.includes("auth") || lower.includes("pending")) {
    return "warning";
  }
  if (lower.includes("success") || lower.includes("complete") || lower.includes("ready")) {
    return "success";
  }
  return "info";
}

function diagnosticFromEvent(event: AppServerEvent): McpDiagnostic | null {
  if (!isMcpDiagnosticEvent(event)) {
    return null;
  }
  const method = getAppServerRawMethod(event);
  if (!method) {
    return null;
  }
  const params = getAppServerParams(event);
  const serverName = extractServerName(params);
  const detail = extractEventDetail(params);
  let title = "MCP event";
  if (isMcpStartupStatusUpdatedEvent(event)) {
    title = "Startup status changed";
  } else if (isMcpOauthLoginCompletedEvent(event)) {
    title = "OAuth login completed";
  } else if (isMcpToolCallProgressEvent(event)) {
    title = "Tool call progress";
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    method,
    serverName,
    title,
    detail,
    tone: statusTone(detail),
  };
}

function formatReportTime(timestamp: number | null): string {
  return timestamp ? new Date(timestamp).toISOString() : "never";
}

export function buildMcpDiagnosticReport({
  workspace,
  servers,
  diagnostics,
  lastUpdatedAt,
}: {
  workspace: WorkspaceInfo | null;
  servers: McpServerDisplay[];
  diagnostics: McpDiagnostic[];
  lastUpdatedAt: number | null;
}): string {
  const lines = [
    "CodexMonitor MCP diagnostics",
    `Workspace: ${workspace ? `${workspace.name} (${workspace.id})` : "none"}`,
    `Workspace path: ${workspace?.path ?? "none"}`,
    `Last status refresh: ${formatReportTime(lastUpdatedAt)}`,
    "",
    "Configured servers:",
  ];

  if (servers.length === 0) {
    lines.push("- none");
  } else {
    for (const server of servers) {
      lines.push(`- ${server.name}`);
      lines.push(`  enabled: ${server.enabled === null ? "unknown" : server.enabled ? "true" : "false"}`);
      lines.push(`  startup: ${server.startupStatus ?? "unknown"}`);
      lines.push(`  auth: ${server.authStatus ?? "unknown"}`);
      lines.push(`  tools: ${server.toolNames.length ? server.toolNames.join(", ") : "none"}`);
      if (server.detail) {
        lines.push(`  detail: ${server.detail}`);
      }
    }
  }

  lines.push("", "Recent diagnostics:");
  if (diagnostics.length === 0) {
    lines.push("- none");
  } else {
    for (const diagnostic of diagnostics) {
      lines.push(
        `- ${formatReportTime(diagnostic.timestamp)} ${diagnostic.title} (${diagnostic.method})`,
      );
      if (diagnostic.serverName) {
        lines.push(`  server: ${diagnostic.serverName}`);
      }
      if (diagnostic.detail) {
        lines.push(`  detail: ${diagnostic.detail}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard copy failed.");
    }
  } finally {
    textarea.remove();
  }
}

export function useSettingsMcpSection(
  projects: WorkspaceInfo[],
  enabled = true,
): SettingsMcpSectionProps {
  const connectedWorkspaces = useMemo(
    () => projects.filter((workspace) => workspace.connected),
    [projects],
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    connectedWorkspaces[0]?.id ?? null,
  );
  const [servers, setServers] = useState<McpServerDisplay[]>([]);
  const [diagnostics, setDiagnostics] = useState<McpDiagnostic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const inFlightWorkspaceId = useRef<string | null>(null);

  const selectedWorkspace = useMemo(
    () => connectedWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [connectedWorkspaces, selectedWorkspaceId],
  );

  useEffect(() => {
    if (selectedWorkspaceId && connectedWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return;
    }
    setSelectedWorkspaceId(connectedWorkspaces[0]?.id ?? null);
  }, [connectedWorkspaces, selectedWorkspaceId]);

  const refresh = useCallback(async () => {
    if (!enabled || !selectedWorkspaceId) {
      setServers([]);
      setError(null);
      setLastUpdatedAt(null);
      return;
    }
    inFlightWorkspaceId.current = selectedWorkspaceId;
    setIsLoading(true);
    setError(null);
    try {
      const response = await listMcpServerStatus(selectedWorkspaceId, null, 100);
      const nextServers = extractResponseData(response)
        .map(normalizeServer)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (inFlightWorkspaceId.current === selectedWorkspaceId) {
        setServers(nextServers);
        setLastUpdatedAt(Date.now());
      }
    } catch (caught) {
      if (inFlightWorkspaceId.current === selectedWorkspaceId) {
        setServers([]);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (inFlightWorkspaceId.current === selectedWorkspaceId) {
        setIsLoading(false);
        inFlightWorkspaceId.current = null;
      }
    }
  }, [enabled, selectedWorkspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reload = useCallback(async () => {
    if (!enabled || !selectedWorkspaceId) {
      return;
    }
    setIsReloading(true);
    setError(null);
    try {
      await reloadMcpServerConfig(selectedWorkspaceId);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsReloading(false);
    }
  }, [enabled, refresh, selectedWorkspaceId]);

  const copyDiagnosticReport = useCallback(async () => {
    const report = buildMcpDiagnosticReport({
      workspace: selectedWorkspace,
      servers,
      diagnostics,
      lastUpdatedAt,
    });
    try {
      await copyTextToClipboard(report);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, [diagnostics, lastUpdatedAt, selectedWorkspace, servers]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    if (!enabled || !selectedWorkspaceId) {
      return;
    }
    return subscribeAppServerEvents((event) => {
      if (event.workspace_id !== selectedWorkspaceId) {
        return;
      }
      const diagnostic = diagnosticFromEvent(event);
      if (!diagnostic) {
        return;
      }
      setDiagnostics((current) => [diagnostic, ...current].slice(0, MAX_DIAGNOSTICS));
      if (
        isMcpStartupStatusUpdatedEvent(event) ||
        isMcpOauthLoginCompletedEvent(event)
      ) {
        void refresh();
      }
    });
  }, [enabled, refresh, selectedWorkspaceId]);

  useEffect(() => {
    setDiagnostics([]);
    setServers([]);
    setError(null);
    setLastUpdatedAt(null);
  }, [selectedWorkspaceId]);

  return {
    connectedWorkspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    servers,
    diagnostics,
    isLoading,
    isReloading,
    error,
    copyStatus,
    lastUpdatedAt,
    onSelectWorkspace: setSelectedWorkspaceId,
    onRefresh: () => {
      void refresh();
    },
    onReload: () => {
      void reload();
    },
    onCopyDiagnosticReport: () => {
      void copyDiagnosticReport();
    },
    onClearDiagnostics: () => setDiagnostics([]),
  };
}
