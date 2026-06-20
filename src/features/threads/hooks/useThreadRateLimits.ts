import { useCallback, useEffect, useRef } from "react";
import type { DebugEntry, RateLimitSnapshot } from "@/types";
import { getAccountRateLimits, getRateLimitResetCredits } from "@services/tauri";
import { normalizeRateLimits } from "@threads/utils/threadNormalize";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadRateLimitsOptions = {
  activeWorkspaceId: string | null;
  activeWorkspaceConnected?: boolean;
  getCurrentRateLimits?: (workspaceId: string) => RateLimitSnapshot | null;
  dispatch: React.Dispatch<ThreadAction>;
  onDebug?: (entry: DebugEntry) => void;
};

type RefreshAccountRateLimitsOptions = {
  includeResetCreditDetails?: boolean;
};

function extractRateLimitSnapshotPayload(
  response: any,
): Record<string, unknown> | null {
  const result =
    response?.result && typeof response.result === "object"
      ? response.result
      : null;
  const rateLimits =
    (result?.rateLimits as Record<string, unknown> | undefined) ??
    (result?.rate_limits as Record<string, unknown> | undefined) ??
    (response?.rateLimits as Record<string, unknown> | undefined) ??
    (response?.rate_limits as Record<string, unknown> | undefined);
  if (!rateLimits || typeof rateLimits !== "object" || Array.isArray(rateLimits)) {
    return null;
  }
  const resetCredits =
    result?.rateLimitResetCredits ??
    result?.rate_limit_reset_credits ??
    response?.rateLimitResetCredits ??
    response?.rate_limit_reset_credits;
  if (resetCredits === undefined) {
    return rateLimits;
  }
  return {
    ...rateLimits,
    rateLimitResetCredits: resetCredits,
  };
}

function extractResetCreditsPayload(response: any): Record<string, unknown> | null {
  const result =
    response?.result && typeof response.result === "object"
      ? response.result
      : null;
  const resetCredits =
    (result?.rateLimitResetCredits as Record<string, unknown> | undefined) ??
    (result?.rate_limit_reset_credits as Record<string, unknown> | undefined) ??
    (response?.rateLimitResetCredits as Record<string, unknown> | undefined) ??
    (response?.rate_limit_reset_credits as Record<string, unknown> | undefined);
  if (resetCredits && typeof resetCredits === "object" && !Array.isArray(resetCredits)) {
    return resetCredits;
  }
  if (
    response?.credits &&
    typeof response === "object" &&
    !Array.isArray(response)
  ) {
    return response as Record<string, unknown>;
  }
  return null;
}

export function useThreadRateLimits({
  activeWorkspaceId,
  activeWorkspaceConnected,
  getCurrentRateLimits,
  dispatch,
  onDebug,
}: UseThreadRateLimitsOptions) {
  const getCurrentRateLimitsRef = useRef(getCurrentRateLimits);
  useEffect(() => {
    getCurrentRateLimitsRef.current = getCurrentRateLimits;
  }, [getCurrentRateLimits]);

  const refreshAccountRateLimits = useCallback(
    async (
      workspaceId?: string,
      options: RefreshAccountRateLimitsOptions = {},
    ) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-account-rate-limits`,
        timestamp: Date.now(),
        source: "client",
        label: "account/rateLimits/read",
        payload: { workspaceId: targetId },
      });
      try {
        const response = await getAccountRateLimits(targetId);
        onDebug?.({
          id: `${Date.now()}-server-account-rate-limits`,
          timestamp: Date.now(),
          source: "server",
          label: "account/rateLimits/read response",
          payload: response,
        });
        const rateLimits = extractRateLimitSnapshotPayload(response);
        if (rateLimits) {
          let enrichedRateLimits = rateLimits;
          if (options.includeResetCreditDetails) {
            try {
              const resetCreditsResponse = await getRateLimitResetCredits(targetId);
              onDebug?.({
                id: `${Date.now()}-server-rate-limit-reset-credits`,
                timestamp: Date.now(),
                source: "server",
                label: "account/rateLimitResetCredit/list response",
                payload: resetCreditsResponse,
              });
              const resetCredits = extractResetCreditsPayload(resetCreditsResponse);
              if (resetCredits) {
                enrichedRateLimits = {
                  ...rateLimits,
                  rateLimitResetCredits: resetCredits,
                };
              }
            } catch (error) {
              onDebug?.({
                id: `${Date.now()}-client-rate-limit-reset-credits-error`,
                timestamp: Date.now(),
                source: "error",
                label: "account/rateLimitResetCredit/list error",
                payload: error instanceof Error ? error.message : String(error),
              });
            }
          }
          const previousRateLimits =
            getCurrentRateLimitsRef.current?.(targetId) ?? null;
          dispatch({
            type: "setRateLimits",
            workspaceId: targetId,
            rateLimits: normalizeRateLimits(enrichedRateLimits, previousRateLimits),
          });
        }
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-account-rate-limits-error`,
          timestamp: Date.now(),
          source: "error",
          label: "account/rateLimits/read error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeWorkspaceId, dispatch, onDebug],
  );

  useEffect(() => {
    if (activeWorkspaceConnected && activeWorkspaceId) {
      void refreshAccountRateLimits(activeWorkspaceId);
    }
  }, [activeWorkspaceConnected, activeWorkspaceId, refreshAccountRateLimits]);

  return { refreshAccountRateLimits };
}
