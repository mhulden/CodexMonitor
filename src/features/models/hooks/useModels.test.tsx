// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import {
  getCodexConfigSummary,
  getConfigModel,
  getModelList,
} from "../../../services/tauri";
import { useModels } from "./useModels";

vi.mock("../../../services/tauri", () => ({
  getCodexConfigSummary: vi.fn(),
  getModelList: vi.fn(),
  getConfigModel: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "CodexMonitor",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useModels", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(getCodexConfigSummary).mockResolvedValue({
      codexHome: "/home/meh/.codex",
      codexBin: null,
      codexArgs: null,
      activeProfile: null,
      model: null,
      modelProvider: null,
      providerName: null,
      baseUrl: null,
      profiles: [],
      providers: [],
      errors: [],
    });
  });

  it("adds the config model when it is missing from model/list", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(0));

    expect(getConfigModel).toHaveBeenCalledWith("workspace-1");
    expect(result.current.models[0]).toMatchObject({
      id: "custom-model",
      model: "custom-model",
    });
    expect(result.current.selectedModel?.model).toBe("custom-model");
    expect(result.current.reasoningSupported).toBe(false);
  });

  it("adds profile-backed custom models with their Codex profile args", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce(null);
    vi.mocked(getCodexConfigSummary).mockResolvedValueOnce({
      codexHome: "/home/meh/.codex",
      codexBin: null,
      codexArgs: null,
      activeProfile: null,
      model: null,
      modelProvider: null,
      providerName: null,
      baseUrl: null,
      profiles: [
        {
          name: "qwen",
          path: "/home/meh/.codex/qwen.config.toml",
          model: "qwen3.8-flash-next",
          modelProvider: "qwen-local",
          providerName: "Qwen 3.8 Flash (local vLLM)",
          baseUrl: "http://127.0.0.1:18300/v1",
          codexArgs: "--profile qwen",
        },
      ],
      providers: [],
      errors: [],
    });

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => {
      expect(result.current.models.some((model) => model.source === "codex-profile")).toBe(true);
    });

    const profileModel = result.current.models.find(
      (model) => model.source === "codex-profile",
    );
    expect(profileModel).toMatchObject({
      id: "codex-profile:qwen:qwen3.8-flash-next",
      model: "qwen3.8-flash-next",
      displayName: "qwen3.8-flash-next (profile: qwen)",
      codexArgsOverride: "--profile qwen",
      modelProvider: "qwen-local",
      modelProviderName: "Qwen 3.8 Flash (local vLLM)",
    });
  });

  it("uses config summary model when the legacy config model read fails", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockRejectedValueOnce(new Error("old daemon fallback failed"));
    vi.mocked(getCodexConfigSummary).mockResolvedValueOnce({
      codexHome: "/home/meh/.codex",
      codexBin: null,
      codexArgs: null,
      activeProfile: null,
      model: "local-config-model",
      modelProvider: "local-provider",
      providerName: "Local Provider",
      baseUrl: "http://127.0.0.1:18300/v1",
      profiles: [],
      providers: [],
      errors: [],
    });

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModel?.model).toBe("local-config-model"));

    expect(result.current.models[0]).toMatchObject({
      id: "local-config-model",
      source: "config",
    });
  });

  it("prefers the provider entry when the config model matches by slug", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "provider-id",
            model: "custom-model",
            displayName: "Provider Custom",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("provider-id"));

    expect(result.current.models).toHaveLength(1);
    expect(result.current.selectedModel?.id).toBe("provider-id");
    expect(result.current.reasoningSupported).toBe(true);
  });

  it("keeps the selected reasoning effort when switching models", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(1));

    act(() => {
      result.current.setSelectedEffort("high");
      result.current.setSelectedModelId("custom-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("custom-model");
      expect(result.current.selectedEffort).toBe("high");
    });
  });
});
