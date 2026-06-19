import type { ModelOption } from "../../../types";

function modelIdentity(model: Pick<ModelOption, "model" | "displayName">): string {
  return `${model.model} ${model.displayName ?? ""}`.toLowerCase();
}

export function modelSupportsFastServiceTier(
  model: Pick<ModelOption, "model" | "displayName" | "serviceTiers"> | null | undefined,
): boolean {
  if (!model) {
    return false;
  }

  if (model.serviceTiers?.some((tier) => tier.id === "fast")) {
    return true;
  }

  const identity = modelIdentity(model);
  if (identity.includes("(config)")) {
    return false;
  }

  const isGpt55 = /\bgpt-5\.5\b/.test(identity);
  const isGpt54 = /\bgpt-5\.4\b/.test(identity);
  const isMini = /\bgpt-5\.4-mini\b/.test(identity);
  return isGpt55 || (isGpt54 && !isMini);
}
