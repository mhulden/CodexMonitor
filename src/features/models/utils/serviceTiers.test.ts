import { describe, expect, it } from "vitest";
import type { ModelOption } from "../../../types";
import { modelSupportsFastServiceTier } from "./serviceTiers";

function model(input: Partial<ModelOption> & Pick<ModelOption, "model">): ModelOption {
  return {
    id: input.id ?? input.model,
    displayName: input.displayName ?? input.model,
    description: input.description ?? "",
    supportedReasoningEfforts: input.supportedReasoningEfforts ?? [],
    defaultReasoningEffort: input.defaultReasoningEffort ?? null,
    isDefault: input.isDefault ?? false,
    ...input,
    model: input.model,
  };
}

describe("modelSupportsFastServiceTier", () => {
  it("uses explicit service tier metadata when present", () => {
    expect(
      modelSupportsFastServiceTier(
        model({
          model: "custom-model",
          serviceTiers: [
            { id: "fast", name: "Fast", description: "1.5x speed" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("falls back to official fast-capable GPT models when metadata is absent", () => {
    expect(modelSupportsFastServiceTier(model({ model: "gpt-5.5" }))).toBe(true);
    expect(modelSupportsFastServiceTier(model({ model: "gpt-5.4" }))).toBe(true);
  });

  it("does not enable fast mode for mini or config models by fallback", () => {
    expect(modelSupportsFastServiceTier(model({ model: "gpt-5.4-mini" }))).toBe(false);
    expect(
      modelSupportsFastServiceTier(
        model({ model: "gpt-5.3-codex", displayName: "gpt-5.3-codex (config)" }),
      ),
    ).toBe(false);
  });
});
