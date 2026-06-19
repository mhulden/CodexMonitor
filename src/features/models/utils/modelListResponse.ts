import type { ModelOption } from "../../../types";

export function normalizeEffortValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractModelItems(response: unknown): unknown[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const record = response as Record<string, unknown>;
  const result =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : null;

  const resultData = result?.data;
  if (Array.isArray(resultData)) {
    return resultData;
  }

  const topLevelData = record.data;
  if (Array.isArray(topLevelData)) {
    return topLevelData;
  }

  return [];
}

function parseReasoningEfforts(item: Record<string, unknown>): ModelOption["supportedReasoningEfforts"] {
  const camel = item.supportedReasoningEfforts;
  if (Array.isArray(camel)) {
    return camel
      .map((effort) => {
        if (!effort || typeof effort !== "object") {
          return null;
        }
        const entry = effort as Record<string, unknown>;
        return {
          reasoningEffort: String(entry.reasoningEffort ?? entry.reasoning_effort ?? ""),
          description: String(entry.description ?? ""),
        };
      })
      .filter((effort): effort is { reasoningEffort: string; description: string } =>
        effort !== null,
      );
  }

  const snake = item.supported_reasoning_efforts;
  if (Array.isArray(snake)) {
    return snake
      .map((effort) => {
        if (!effort || typeof effort !== "object") {
          return null;
        }
        const entry = effort as Record<string, unknown>;
        return {
          reasoningEffort: String(entry.reasoningEffort ?? entry.reasoning_effort ?? ""),
          description: String(entry.description ?? ""),
        };
      })
      .filter((effort): effort is { reasoningEffort: string; description: string } =>
        effort !== null,
      );
  }

  return [];
}

function parseServiceTiers(item: Record<string, unknown>): ModelOption["serviceTiers"] {
  const tiers = item.serviceTiers ?? item.service_tiers;
  if (Array.isArray(tiers)) {
    return tiers
      .map((tier) => {
        if (!tier || typeof tier !== "object") {
          return null;
        }
        const entry = tier as Record<string, unknown>;
        const id = String(entry.id ?? "").trim();
        if (!id) {
          return null;
        }
        const rawName = String(entry.name ?? "").trim();
        return {
          id,
          name: rawName || id,
          description: String(entry.description ?? ""),
        };
      })
      .filter((tier): tier is { id: string; name: string; description: string } =>
        tier !== null,
      );
  }

  const speedTiers = item.additionalSpeedTiers ?? item.additional_speed_tiers;
  if (Array.isArray(speedTiers)) {
    return speedTiers
      .map((tier) => String(tier ?? "").trim())
      .filter((id) => id.length > 0)
      .map((id) => ({
        id,
        name: id,
        description: "",
      }));
  }

  return [];
}

export function parseModelListResponse(response: unknown): ModelOption[] {
  const items = extractModelItems(response);

  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const modelSlug = String(record.model ?? record.id ?? "");
      const rawDisplayName = String(record.displayName || record.display_name || "");
      const displayName = rawDisplayName.trim().length > 0 ? rawDisplayName : modelSlug;
      const model: ModelOption = {
        id: String(record.id ?? record.model ?? ""),
        model: modelSlug,
        displayName,
        description: String(record.description ?? ""),
        supportedReasoningEfforts: parseReasoningEfforts(record),
        defaultReasoningEffort: normalizeEffortValue(
          record.defaultReasoningEffort ?? record.default_reasoning_effort,
        ),
        serviceTiers: parseServiceTiers(record),
        defaultServiceTier: normalizeEffortValue(
          record.defaultServiceTier ?? record.default_service_tier,
        ),
        isDefault: Boolean(record.isDefault ?? record.is_default ?? false),
      };
      return model;
    })
    .filter((model): model is ModelOption => model !== null);
}
