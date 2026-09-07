import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexConfigSummary, ModelOption, WorkspaceInfo } from "@/types";
import {
  connectWorkspace,
  getCodexConfigSummary,
  getConfigModel,
  getModelList,
} from "@services/tauri";
import { parseModelListResponse } from "@/features/models/utils/modelListResponse";
import { buildConfiguredModelOptions } from "@/features/models/utils/codexConfigSummary";

type SettingsDefaultModelsState = {
  models: ModelOption[];
  isLoading: boolean;
  error: string | null;
  connectedWorkspaceCount: number;
  configSummary: CodexConfigSummary | null;
};

const EMPTY_STATE: SettingsDefaultModelsState = {
  models: [],
  isLoading: false,
  error: null,
  connectedWorkspaceCount: 0,
  configSummary: null,
};

const parseGptVersionScore = (slug: string): number | null => {
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(slug.trim());
  if (!match) {
    return null;
  }
  const major = Number(match[1] ?? NaN);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  if (!Number.isFinite(major)) {
    return null;
  }
  return major * 1_000_000 + minor * 1_000 + patch;
};

const gptVariantPenalty = (slug: string): number => {
  const match = /^gpt-(\d+(?:\.\d+){0,2})(.*)$/i.exec(slug.trim());
  if (!match) {
    return 1;
  }
  const suffix = match[2] ?? "";
  return suffix.startsWith("-") ? 1 : 0;
};

function compareModelsByLatest(a: ModelOption, b: ModelOption): number {
  const scoreA = parseGptVersionScore(a.model) ?? -1;
  const scoreB = parseGptVersionScore(b.model) ?? -1;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  const penaltyA = gptVariantPenalty(a.model);
  const penaltyB = gptVariantPenalty(b.model);
  if (penaltyA !== penaltyB) {
    return penaltyA - penaltyB;
  }
  if (a.isDefault !== b.isDefault) {
    return a.isDefault ? -1 : 1;
  }
  return a.model.localeCompare(b.model);
}

export function useSettingsDefaultModels(projects: WorkspaceInfo[]) {
  const [state, setState] = useState<SettingsDefaultModelsState>(EMPTY_STATE);
  const requestIdRef = useRef(0);
  const sourceWorkspaceId = projects[0]?.id ?? null;
  const sourceWorkspaceName = projects[0]?.name ?? null;
  const sourceWorkspaceConnected = projects[0]?.connected ?? false;

  const refresh = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    if (!sourceWorkspaceId || !sourceWorkspaceName) {
      setState(EMPTY_STATE);
      return;
    }
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      connectedWorkspaceCount: 1,
    }));

    try {
      const errors: string[] = [];
      let canReadModelList = sourceWorkspaceConnected;
      if (!canReadModelList) {
        try {
          await connectWorkspace(sourceWorkspaceId);
          canReadModelList = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${sourceWorkspaceName}: ${message}`);
        }
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      const [modelListResult, configModelResult, configSummaryResult] = await Promise.allSettled([
        canReadModelList ? getModelList(sourceWorkspaceId) : Promise.resolve(null),
        getConfigModel(sourceWorkspaceId),
        getCodexConfigSummary(sourceWorkspaceId),
      ]);
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (modelListResult.status === "rejected") {
        const message =
          modelListResult.reason instanceof Error
            ? modelListResult.reason.message
            : String(modelListResult.reason);
        errors.push(`${sourceWorkspaceName}: ${message}`);
      }
      if (configModelResult.status === "rejected") {
        const message =
          configModelResult.reason instanceof Error
            ? configModelResult.reason.message
            : String(configModelResult.reason);
        errors.push(`${sourceWorkspaceName}: ${message}`);
      }
      if (configSummaryResult.status === "rejected") {
        const message =
          configSummaryResult.reason instanceof Error
            ? configSummaryResult.reason.message
            : String(configSummaryResult.reason);
        errors.push(`${sourceWorkspaceName}: ${message}`);
      }

      const modelsFromList = parseModelListResponse(
        modelListResult.status === "fulfilled" ? modelListResult.value : null,
      );
      const configModel =
        configModelResult.status === "fulfilled" ? configModelResult.value : null;
      const configSummary =
        configSummaryResult.status === "fulfilled"
          ? {
              ...configSummaryResult.value,
              model: configSummaryResult.value.model ?? configModel,
            }
          : configModel
            ? {
                codexHome: "",
                codexBin: null,
                codexArgs: null,
                activeProfile: null,
                model: configModel,
                modelProvider: null,
                providerName: null,
                baseUrl: null,
                profiles: [],
                providers: [],
                errors: [],
              }
            : null;
      const models = [
        ...buildConfiguredModelOptions(configSummary, modelsFromList),
        ...modelsFromList,
      ].sort(compareModelsByLatest);
      setState({
        models,
        isLoading: false,
        error: errors.length ? errors.join(" | ") : null,
        connectedWorkspaceCount: 1,
        configSummary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId === requestIdRef.current) {
        setState({
          models: [],
          isLoading: false,
          error: message,
          connectedWorkspaceCount: sourceWorkspaceId ? 1 : 0,
          configSummary: null,
        });
      }
    }
  }, [sourceWorkspaceConnected, sourceWorkspaceId, sourceWorkspaceName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}
