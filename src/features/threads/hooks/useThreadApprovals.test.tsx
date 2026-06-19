// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@/types";
import {
  respondToMcpElicitationRequest,
  respondToServerRequest,
} from "@services/tauri";
import { useThreadApprovals } from "./useThreadApprovals";

vi.mock("@services/tauri", () => ({
  rememberApprovalRule: vi.fn(),
  respondToMcpElicitationRequest: vi.fn(),
  respondToServerRequest: vi.fn(),
}));

describe("useThreadApprovals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responds to normal approvals with a decision result", async () => {
    const dispatch = vi.fn();
    const request: ApprovalRequest = {
      workspace_id: "ws-1",
      request_id: 7,
      method: "item/permissions/requestApproval",
      params: { mode: "full" },
    };

    const { result } = renderHook(() => useThreadApprovals({ dispatch }));

    await result.current.handleApprovalDecision(request, "accept");

    expect(respondToServerRequest).toHaveBeenCalledWith("ws-1", 7, "accept");
    expect(respondToMcpElicitationRequest).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "removeApproval",
      requestId: 7,
      workspaceId: "ws-1",
    });
  });

  it("responds to MCP elicitations with an action result", async () => {
    const dispatch = vi.fn();
    const request: ApprovalRequest = {
      workspace_id: "ws-1",
      request_id: "mcp-1",
      method: "mcpServer/elicitation/request",
      params: { server: "playwright", tool: "browser_navigate" },
    };

    const { result } = renderHook(() => useThreadApprovals({ dispatch }));

    await result.current.handleApprovalDecision(request, "decline");

    expect(respondToMcpElicitationRequest).toHaveBeenCalledWith(
      "ws-1",
      "mcp-1",
      "decline",
    );
    expect(respondToServerRequest).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "removeApproval",
      requestId: "mcp-1",
      workspaceId: "ws-1",
    });
  });
});
