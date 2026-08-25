import Activity from "lucide-react/dist/esm/icons/activity";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Server from "lucide-react/dist/esm/icons/server";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import {
  SettingsSection,
  SettingsSubsection,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsMcpSectionProps } from "@settings/hooks/useSettingsMcpSection";

function formatTime(timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusClass(status: string | null): string {
  const lower = status?.toLowerCase() ?? "";
  if (lower.includes("fail") || lower.includes("error") || lower.includes("denied")) {
    return "is-error";
  }
  if (lower.includes("require") || lower.includes("auth") || lower.includes("pending")) {
    return "is-warning";
  }
  if (lower.includes("ready") || lower.includes("success") || lower.includes("complete")) {
    return "is-success";
  }
  return "is-neutral";
}

export function SettingsMcpSection({
  connectedWorkspaces,
  selectedWorkspaceId,
  selectedWorkspace,
  servers,
  diagnostics,
  isLoading,
  error,
  lastUpdatedAt,
  onSelectWorkspace,
  onRefresh,
  onClearDiagnostics,
}: SettingsMcpSectionProps) {
  const hasConnectedWorkspaces = connectedWorkspaces.length > 0;

  return (
    <SettingsSection
      title="MCP"
      subtitle="Inspect configured Model Context Protocol servers, tools, authentication, and live diagnostics for the selected workspace."
    >
      <div className="settings-mcp-toolbar">
        <label className="settings-field settings-mcp-workspace-field">
          <span className="settings-field-label">Workspace</span>
          <select
            className="settings-select"
            value={selectedWorkspaceId ?? ""}
            onChange={(event) => onSelectWorkspace(event.target.value)}
            disabled={!hasConnectedWorkspaces}
          >
            {hasConnectedWorkspaces ? null : (
              <option value="">No connected workspaces</option>
            )}
            {connectedWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary settings-mcp-refresh"
          onClick={onRefresh}
          disabled={!selectedWorkspace || isLoading}
        >
          <RefreshCw aria-hidden />
          {isLoading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      <div className="settings-help settings-mcp-help">
        CodexMonitor reads the MCP status from the active Codex app-server. In remote mode,
        this reflects the daemon host, not the GUI machine.
      </div>

      {error ? <div className="settings-help-error settings-mcp-error">{error}</div> : null}

      <SettingsSubsection
        title="Configured servers"
        subtitle={`Last updated: ${formatTime(lastUpdatedAt)}`}
      />
      <div className="settings-mcp-server-list">
        {!hasConnectedWorkspaces ? (
          <div className="settings-mcp-empty">Connect a workspace to inspect MCP servers.</div>
        ) : servers.length === 0 && !isLoading ? (
          <div className="settings-mcp-empty">No MCP servers are configured for this workspace.</div>
        ) : null}
        {servers.map((server) => (
          <div key={server.id} className="settings-mcp-server-card">
            <div className="settings-mcp-server-header">
              <div className="settings-mcp-server-title">
                <Server aria-hidden />
                <span>{server.name}</span>
              </div>
              {server.enabled !== null ? (
                <span className={`settings-mcp-pill ${server.enabled ? "is-success" : "is-neutral"}`}>
                  {server.enabled ? "Enabled" : "Disabled"}
                </span>
              ) : null}
            </div>
            <div className="settings-mcp-status-row">
              <div className="settings-mcp-status">
                <Activity aria-hidden />
                <span className="settings-mcp-status-label">Startup</span>
                <span className={`settings-mcp-pill ${statusClass(server.startupStatus)}`}>
                  {server.startupStatus ?? "Unknown"}
                </span>
              </div>
              <div className="settings-mcp-status">
                <ShieldCheck aria-hidden />
                <span className="settings-mcp-status-label">Auth</span>
                <span className={`settings-mcp-pill ${statusClass(server.authStatus)}`}>
                  {server.authStatus ?? "Unknown"}
                </span>
              </div>
            </div>
            {server.detail ? <div className="settings-mcp-detail">{server.detail}</div> : null}
            <div className="settings-mcp-tools">
              <div className="settings-mcp-tools-title">
                <Wrench aria-hidden />
                Tools
              </div>
              {server.toolNames.length > 0 ? (
                <div className="settings-mcp-tool-list">
                  {server.toolNames.map((tool) => (
                    <span key={tool} className="settings-mcp-tool">
                      {tool}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="settings-help">No tools reported.</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="settings-mcp-diagnostics-header">
        <SettingsSubsection
          title="Live diagnostics"
          subtitle="Startup, OAuth, and tool-call progress events observed while this panel is open."
        />
        <button
          type="button"
          className="ghost settings-button-compact"
          onClick={onClearDiagnostics}
          disabled={diagnostics.length === 0}
        >
          Clear
        </button>
      </div>
      <div className="settings-mcp-diagnostics">
        {diagnostics.length === 0 ? (
          <div className="settings-mcp-empty">No MCP diagnostics observed yet.</div>
        ) : (
          diagnostics.map((diagnostic) => (
            <div
              key={diagnostic.id}
              className={`settings-mcp-diagnostic is-${diagnostic.tone}`}
            >
              <div className="settings-mcp-diagnostic-main">
                <span className="settings-mcp-diagnostic-title">{diagnostic.title}</span>
                {diagnostic.serverName ? (
                  <span className="settings-mcp-diagnostic-server">
                    {diagnostic.serverName}
                  </span>
                ) : null}
              </div>
              <div className="settings-mcp-diagnostic-meta">
                <code>{diagnostic.method}</code>
                <span>{formatTime(diagnostic.timestamp)}</span>
              </div>
              {diagnostic.detail ? (
                <div className="settings-mcp-diagnostic-detail">{diagnostic.detail}</div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </SettingsSection>
  );
}
