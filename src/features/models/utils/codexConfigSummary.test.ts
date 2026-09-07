import { describe, expect, it } from "vitest";
import type { CodexConfigSummary, ModelOption } from "@/types";
import {
  buildConfiguredModelOptions,
  isProfileBackedModel,
} from "./codexConfigSummary";

function catalogModel(model: string): ModelOption {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: false,
  };
}

function summary(input: Partial<CodexConfigSummary>): CodexConfigSummary {
  return {
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
    ...input,
  };
}

describe("buildConfiguredModelOptions", () => {
  it("adds config and profile-backed model options with safe profile args", () => {
    const options = buildConfiguredModelOptions(
      summary({
        model: "gpt-from-config",
        modelProvider: "openai",
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
      }),
      [catalogModel("gpt-5.5")],
    );

    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      id: "gpt-from-config",
      source: "config",
      displayName: "gpt-from-config (config)",
    });
    expect(options[1]).toMatchObject({
      id: "codex-profile:qwen:qwen3.8-flash-next",
      source: "codex-profile",
      model: "qwen3.8-flash-next",
      displayName: "qwen3.8-flash-next (profile: qwen)",
      codexArgsOverride: "--profile qwen",
      modelProvider: "qwen-local",
      modelProviderName: "Qwen 3.8 Flash (local vLLM)",
    });
    expect(isProfileBackedModel(options[1])).toBe(true);
  });

  it("does not duplicate a config model already present in the app-server catalog", () => {
    const options = buildConfiguredModelOptions(
      summary({ model: "gpt-5.5" }),
      [catalogModel("gpt-5.5")],
    );

    expect(options).toEqual([]);
  });
});
