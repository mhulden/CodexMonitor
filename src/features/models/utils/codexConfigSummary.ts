import type { CodexConfigSummary, CodexConfigProfileSummary, ModelOption } from "@/types";

const CONFIG_MODEL_DESCRIPTION = "Configured in CODEX_HOME/config.toml";

function providerLabel(profile: CodexConfigProfileSummary): string | null {
  return profile.providerName ?? profile.modelProvider ?? null;
}

function describeProfile(profile: CodexConfigProfileSummary): string {
  const parts = [`Codex profile: ${profile.name}`];
  const provider = providerLabel(profile);
  if (provider) {
    parts.push(`provider: ${provider}`);
  }
  if (profile.baseUrl) {
    parts.push(`base URL: ${profile.baseUrl}`);
  }
  return parts.join(" | ");
}

export function buildConfiguredModelOptions(
  summary: CodexConfigSummary | null,
  catalogModels: ModelOption[],
): ModelOption[] {
  if (!summary) {
    return [];
  }

  const options: ModelOption[] = [];
  if (
    summary.model &&
    !catalogModels.some((model) => model.model === summary.model || model.id === summary.model)
  ) {
    options.push({
      id: summary.model,
      model: summary.model,
      displayName: `${summary.model} (config)`,
      description: summary.modelProvider
        ? `${CONFIG_MODEL_DESCRIPTION}; provider: ${
            summary.providerName ?? summary.modelProvider
          }`
        : CONFIG_MODEL_DESCRIPTION,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      isDefault: false,
      source: "config",
      modelProvider: summary.modelProvider,
      modelProviderName: summary.providerName,
      codexHome: summary.codexHome,
    });
  }

  for (const profile of summary.profiles) {
    if (!profile.model) {
      continue;
    }
    options.push({
      id: `codex-profile:${profile.name}:${profile.model}`,
      model: profile.model,
      displayName: `${profile.model} (profile: ${profile.name})`,
      description: describeProfile(profile),
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      isDefault: false,
      source: "codex-profile",
      codexProfileName: profile.name,
      codexArgsOverride: profile.codexArgs,
      modelProvider: profile.modelProvider,
      modelProviderName: profile.providerName,
      codexHome: summary.codexHome,
    });
  }

  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) {
      return false;
    }
    seen.add(option.id);
    return true;
  });
}

export function isProfileBackedModel(
  model: ModelOption | null | undefined,
): model is ModelOption & { source: "codex-profile"; codexArgsOverride: string } {
  return model?.source === "codex-profile" && Boolean(model.codexArgsOverride);
}
