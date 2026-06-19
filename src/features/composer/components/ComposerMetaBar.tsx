import type { CSSProperties } from "react";
import { Check, ChevronDown, SlidersHorizontal, Zap } from "lucide-react";
import type {
  AccessMode,
  ModelOption,
  ServiceTier,
  ThreadTokenUsage,
} from "../../../types";
import { useMenuController } from "../../app/hooks/useMenuController";
import {
  MenuTrigger,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { modelSupportsFastServiceTier } from "../../models/utils/serviceTiers";
import type { CodexArgsOption } from "../../threads/utils/codexArgsProfiles";

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

function formatEffortLabel(effort: string | null): string {
  if (!effort) {
    return "Default";
  }
  return (
    EFFORT_LABELS[effort] ??
    effort
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function shortModelLabel(model: ModelOption | null): string {
  const label = model?.displayName || model?.model || "Model";
  const trimmed = label.trim();
  const withoutGptPrefix = trimmed
    .replace(/^GPT-/i, "")
    .replace(/^gpt-/i, "");
  return withoutGptPrefix.replace(/-codex$/i, "");
}

type ComposerMetaBarProps = {
  disabled: boolean;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  models: ModelOption[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  selectedServiceTier: ServiceTier | null;
  onSelectServiceTier: (tier: ServiceTier | null) => void;
  reasoningSupported: boolean;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  codexArgsOptions?: CodexArgsOption[];
  selectedCodexArgsOverride?: string | null;
  onSelectCodexArgsOverride?: (value: string | null) => void;
  contextUsage?: ThreadTokenUsage | null;
};

export function ComposerMetaBar({
  disabled,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  models,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  selectedServiceTier,
  onSelectServiceTier,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  codexArgsOptions = [],
  selectedCodexArgsOverride = null,
  onSelectCodexArgsOverride,
  contextUsage = null,
}: ComposerMetaBarProps) {
  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? null;
  const modelSettingsMenu = useMenuController();
  const selectedModelLabel = shortModelLabel(selectedModel);
  const selectedEffortLabel = reasoningSupported
    ? formatEffortLabel(selectedEffort ?? reasoningOptions[0] ?? null)
    : "Default";
  const contextWindow = contextUsage?.modelContextWindow ?? null;
  const lastTokens = contextUsage?.last.totalTokens ?? 0;
  const totalTokens = contextUsage?.total.totalTokens ?? 0;
  const usedTokens = lastTokens > 0 ? lastTokens : totalTokens;
  const contextFreePercent =
    contextWindow && contextWindow > 0 && usedTokens > 0
      ? Math.max(
          0,
          100 -
            Math.min(Math.max((usedTokens / contextWindow) * 100, 0), 100),
        )
      : null;
  const planMode =
    collaborationModes.find((mode) => mode.id === "plan") ?? null;
  const defaultMode =
    collaborationModes.find((mode) => mode.id === "default") ?? null;
  const canUsePlanToggle =
    Boolean(planMode) &&
    collaborationModes.every(
      (mode) => mode.id === "default" || mode.id === "plan",
    );
  const planSelected = selectedCollaborationModeId === (planMode?.id ?? "");
  const supportsFastTier = modelSupportsFastServiceTier(selectedModel);
  const showSpeedSection = supportsFastTier || selectedServiceTier === "fast";

  const closeModelSettings = () => modelSettingsMenu.close();
  const selectModel = (id: string) => {
    onSelectModel(id);
    closeModelSettings();
  };
  const selectEffort = (effort: string) => {
    onSelectEffort(effort);
    closeModelSettings();
  };
  const selectServiceTier = (tier: ServiceTier | null) => {
    onSelectServiceTier(tier);
    closeModelSettings();
  };

  return (
    <div className="composer-bar">
      <div className="composer-meta">
        {collaborationModes.length > 0 && (
          canUsePlanToggle ? (
            <div className="composer-select-wrap composer-plan-toggle-wrap">
              <label className="composer-plan-toggle" aria-label="Plan mode">
                <input
                  className="composer-plan-toggle-input"
                  type="checkbox"
                  checked={planSelected}
                  disabled={disabled}
                  onChange={(event) =>
                    onSelectCollaborationMode(
                      event.target.checked
                        ? planMode?.id ?? "plan"
                        : (defaultMode?.id ?? null),
                    )
                  }
                />
                <span className="composer-plan-toggle-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="composer-plan-toggle-label">
                  {planMode?.label || "Plan"}
                </span>
              </label>
            </div>
          ) : (
            <div className="composer-select-wrap">
              <span className="composer-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <select
                className="composer-select composer-select--model composer-select--collab"
                aria-label="Collaboration mode"
                value={selectedCollaborationModeId ?? ""}
                onChange={(event) =>
                  onSelectCollaborationMode(event.target.value || null)
                }
                disabled={disabled}
              >
                {collaborationModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label || mode.id}
                  </option>
                ))}
              </select>
            </div>
          )
        )}
        <div
          className="composer-model-settings"
          ref={modelSettingsMenu.containerRef}
        >
          <MenuTrigger
            isOpen={modelSettingsMenu.isOpen}
            activeClassName="is-open"
            className="composer-model-settings-trigger"
            aria-label="Model settings"
            title="Model settings"
            disabled={disabled}
            onClick={modelSettingsMenu.toggle}
          >
            <span className="composer-model-settings-trigger-label">
              <span className="composer-model-settings-trigger-model">
                {selectedModelLabel}
              </span>
              <span className="composer-model-settings-trigger-effort">
                {selectedEffortLabel}
              </span>
            </span>
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
          </MenuTrigger>
          {modelSettingsMenu.isOpen && (
            <PopoverSurface
              className="composer-model-settings-popover"
              role="menu"
            >
              <div className="composer-model-settings-section">
                <div className="composer-model-settings-heading">Reasoning</div>
                {reasoningOptions.length === 0 && (
                  <button
                    type="button"
                    className="composer-model-settings-item is-disabled"
                    role="menuitem"
                    disabled
                  >
                    <span className="composer-model-settings-item-copy">
                      <span className="composer-model-settings-item-title">
                        Default
                      </span>
                    </span>
                  </button>
                )}
                {reasoningOptions.map((effort) => {
                  const active = selectedEffort === effort;
                  return (
                    <button
                      key={effort}
                      type="button"
                      className={`composer-model-settings-item${
                        active ? " is-active" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={active}
                      disabled={disabled || !reasoningSupported}
                      onClick={() => selectEffort(effort)}
                    >
                      <span className="composer-model-settings-item-copy">
                        <span className="composer-model-settings-item-title">
                          {formatEffortLabel(effort)}
                        </span>
                      </span>
                      {active && (
                        <Check size={15} strokeWidth={1.8} aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="composer-model-settings-divider" />

              <div className="composer-model-settings-section">
                <div className="composer-model-settings-heading">Model</div>
                {models.length === 0 && (
                  <button
                    type="button"
                    className="composer-model-settings-item is-disabled"
                    role="menuitem"
                    disabled
                  >
                    <span className="composer-model-settings-item-copy">
                      <span className="composer-model-settings-item-title">
                        No models
                      </span>
                    </span>
                  </button>
                )}
                {models.map((model) => {
                  const active = model.id === selectedModelId;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`composer-model-settings-item${
                        active ? " is-active" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={active}
                      disabled={disabled}
                      onClick={() => selectModel(model.id)}
                    >
                      <span className="composer-model-settings-item-copy">
                        <span className="composer-model-settings-item-title">
                          {model.displayName || model.model}
                        </span>
                      </span>
                      {active && (
                        <Check size={15} strokeWidth={1.8} aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>

              {showSpeedSection && (
                <>
                  <div className="composer-model-settings-divider" />
                  <div className="composer-model-settings-section">
                    <div className="composer-model-settings-heading">Speed</div>
                    <button
                      type="button"
                      className={`composer-model-settings-item${
                        selectedServiceTier !== "fast" ? " is-active" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={selectedServiceTier !== "fast"}
                      disabled={disabled}
                      onClick={() => selectServiceTier(null)}
                    >
                      <span className="composer-model-settings-item-copy">
                        <span className="composer-model-settings-item-title">
                          Standard
                        </span>
                        <span className="composer-model-settings-item-description">
                          Default speed
                        </span>
                      </span>
                      {selectedServiceTier !== "fast" && (
                        <Check size={15} strokeWidth={1.8} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className={`composer-model-settings-item${
                        selectedServiceTier === "fast" ? " is-active" : ""
                      }`}
                      role="menuitemradio"
                      aria-checked={selectedServiceTier === "fast"}
                      disabled={disabled || !supportsFastTier}
                      onClick={() => selectServiceTier("fast")}
                    >
                      <span className="composer-model-settings-item-copy">
                        <span className="composer-model-settings-item-title composer-model-settings-speed-title">
                          <Zap size={14} strokeWidth={1.8} aria-hidden />
                          Fast
                        </span>
                        <span className="composer-model-settings-item-description">
                          1.5x speed, increased usage
                        </span>
                      </span>
                      {selectedServiceTier === "fast" && (
                        <Check size={15} strokeWidth={1.8} aria-hidden />
                      )}
                    </button>
                  </div>
                </>
              )}
            </PopoverSurface>
          )}
        </div>
        {codexArgsOptions.length > 1 && onSelectCodexArgsOverride && (
          <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <SlidersHorizontal size={14} strokeWidth={1.8} />
            </span>
            <select
              className="composer-select composer-select--approval"
              aria-label="Codex args profile"
              disabled={disabled}
              value={selectedCodexArgsOverride ?? ""}
              onChange={(event) =>
                onSelectCodexArgsOverride(event.target.value || null)
              }
            >
              {codexArgsOptions.map((option) => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="composer-select-wrap">
          <span className="composer-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4l7 3v5c0 4.5-3 7.5-7 8-4-0.5-7-3.5-7-8V7l7-3z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 12.5l1.8 1.8 3.7-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--approval"
            aria-label="Agent access"
            disabled={disabled}
            value={accessMode}
            onChange={(event) =>
              onSelectAccessMode(event.target.value as AccessMode)
            }
          >
            <option value="read-only">Read only</option>
            <option value="current">On-Request</option>
            <option value="full-access">Full access</option>
          </select>
        </div>
      </div>
      <div className="composer-context">
        <div
          className="composer-context-ring"
          data-tooltip={
            contextFreePercent === null
              ? "Context free --"
              : `Context free ${Math.round(contextFreePercent)}%`
          }
          aria-label={
            contextFreePercent === null
              ? "Context free --"
              : `Context free ${Math.round(contextFreePercent)}%`
          }
          style={
            {
              "--context-free": contextFreePercent ?? 0,
            } as CSSProperties
          }
        >
          <span className="composer-context-value">●</span>
        </div>
      </div>
    </div>
  );
}
