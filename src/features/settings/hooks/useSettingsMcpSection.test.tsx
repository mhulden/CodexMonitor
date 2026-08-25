// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent, WorkspaceInfo } from "@/types";
import { listMcpServerStatus } from "@services/tauri";
import { subscribeAppServerEvents } from "@services/events";
import { useSettingsMcpSection } from "./useSettingsMcpSection";

vi.mock("@services/tauri", () => ({
  listMcpServerStatus: vi.fn(),
}));

vi.mock("@services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

const connectedWorkspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace One",
  path: "/tmp/workspace-one",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const otherWorkspace: WorkspaceInfo = {
  id: "workspace-2",
  name: "Workspace Two",
  path: "/tmp/workspace-two",
  connected: true,
  settings: { sidebarCollapsed: false },
};

let listener: ((event: AppServerEvent) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  listener = null;
  unlisten.mockReset();
  vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSettingsMcpSection", () => {
  it("loads and normalizes MCP server status for the selected workspace", async () => {
    vi.mocked(listMcpServerStatus).mockResolvedValueOnce({
      result: {
        data: [
          {
            name: "browser",
            enabled: true,
            startupStatus: { status: "ready" },
            auth_status: "authenticated",
            tools: {
              mcp__browser__browser_navigate: {},
              mcp__browser__browser_tabs: {},
            },
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useSettingsMcpSection([connectedWorkspace]),
    );

    await waitFor(() => {
      expect(listMcpServerStatus).toHaveBeenCalledWith("workspace-1", null, 100);
      expect(result.current.servers).toHaveLength(1);
    });

    expect(result.current.servers[0]).toMatchObject({
      name: "browser",
      enabled: true,
      startupStatus: "ready",
      authStatus: "authenticated",
      toolNames: ["browser_navigate", "browser_tabs"],
    });
  });

  it("records MCP diagnostics and refreshes after startup or OAuth changes", async () => {
    vi.mocked(listMcpServerStatus)
      .mockResolvedValueOnce({ result: { data: [] } })
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "linear",
              startup_status: "ready",
              tools: ["mcp__linear__list_issues"],
            },
          ],
        },
      });

    const { result } = renderHook(() =>
      useSettingsMcpSection([connectedWorkspace, otherWorkspace]),
    );

    await waitFor(() => {
      expect(listMcpServerStatus).toHaveBeenCalledTimes(1);
    });

    act(() => {
      listener?.({
        workspace_id: "workspace-1",
        message: {
          method: "mcpServer/startupStatus/updated",
          params: {
            serverName: "linear",
            status: "ready",
          },
        },
      });
    });

    await waitFor(() => {
      expect(listMcpServerStatus).toHaveBeenCalledTimes(2);
      expect(result.current.diagnostics[0]).toMatchObject({
        title: "Startup status changed",
        serverName: "linear",
        detail: "ready",
        tone: "success",
      });
      expect(result.current.servers[0].toolNames).toEqual(["list_issues"]);
    });
  });

  it("ignores diagnostics from non-selected workspaces", async () => {
    vi.mocked(listMcpServerStatus).mockResolvedValue({ result: { data: [] } });

    const { result } = renderHook(() =>
      useSettingsMcpSection([connectedWorkspace, otherWorkspace]),
    );

    await waitFor(() => {
      expect(listMcpServerStatus).toHaveBeenCalledTimes(1);
    });

    act(() => {
      listener?.({
        workspace_id: "workspace-2",
        message: {
          method: "item/mcpToolCall/progress",
          params: { serverName: "browser", message: "navigating" },
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.diagnostics).toEqual([]);
  });
});
