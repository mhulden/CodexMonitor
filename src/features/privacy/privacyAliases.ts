import {
  privacyAliasAnonymizeText,
  privacyAliasContainsMarkers,
  privacyAliasRevealText,
} from "@services/tauri";

let sessionPassphrase: string | null = null;
let revealPromptDeclined = false;
let pendingPassphrasePrompt: Promise<string | null> | null = null;

// Passphrases are intentionally session-only. The backend receives the
// passphrase only for the immediate transform and never persists it.
export function containsPrivacyAliasToken(text: string) {
  return /\bP1_[A-Za-z0-9_-]+/.test(text);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function requestPrivacyPassphrase(reason: string, required: boolean) {
  if (typeof document === "undefined") {
    return Promise.resolve<string | null>(null);
  }

  return new Promise<string | null>((resolve) => {
    const root = createElement("div", "ds-modal privacy-passphrase-modal");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "privacy-passphrase-title");
    root.setAttribute("aria-describedby", "privacy-passphrase-description");

    const backdrop = createElement("div", "ds-modal-backdrop");
    const card = createElement("form", "ds-modal-card privacy-passphrase-modal-card");
    const title = createElement("div", "ds-modal-title");
    title.id = "privacy-passphrase-title";
    title.textContent = "Privacy alias passphrase";

    const description = createElement("div", "ds-modal-subtitle");
    description.id = "privacy-passphrase-description";
    description.textContent = reason;

    const label = createElement("label", "ds-modal-label");
    label.htmlFor = "privacy-passphrase-input";
    label.textContent = "Passphrase";

    const input = createElement("input", "ds-modal-input");
    input.id = "privacy-passphrase-input";
    input.type = "password";
    input.autocomplete = "current-password";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Privacy alias passphrase");

    const error = createElement("div", "ds-modal-error privacy-passphrase-error");
    error.textContent = "Passphrase is required.";
    error.hidden = true;

    const actions = createElement("div", "ds-modal-actions");
    const cancelButton = createElement("button", "ds-modal-button secondary");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    const submitButton = createElement("button", "ds-modal-button primary");
    submitButton.type = "submit";
    submitButton.textContent = "Continue";

    actions.append(cancelButton, submitButton);
    card.append(title, description, label, input, error, actions);
    root.append(backdrop, card);

    let settled = false;
    const cleanup = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener("keydown", handleKeyDown);
      root.remove();
      resolve(value);
    };
    const handleCancel = () => cleanup(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancel();
      }
    };

    card.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value;
      if (required && !value) {
        error.hidden = false;
        input.focus();
        return;
      }
      cleanup(value || null);
    });
    cancelButton.addEventListener("click", handleCancel);
    backdrop.addEventListener("click", handleCancel);
    document.addEventListener("keydown", handleKeyDown);
    document.body.append(root);
    requestAnimationFrame(() => input.focus());
  });
}

async function promptForPassphrase(reason: string, required: boolean) {
  if (!required && revealPromptDeclined) {
    return null;
  }
  if (sessionPassphrase) {
    return sessionPassphrase;
  }
  pendingPassphrasePrompt ??= requestPrivacyPassphrase(reason, required).finally(() => {
    pendingPassphrasePrompt = null;
  });
  const value = await pendingPassphrasePrompt;
  if (!value) {
    if (!required) {
      revealPromptDeclined = true;
      return null;
    }
    throw new Error("Privacy alias passphrase is required.");
  }
  sessionPassphrase = value;
  revealPromptDeclined = false;
  return sessionPassphrase;
}

export async function anonymizePrivateTextForSend(text: string) {
  const hasMarkers = await privacyAliasContainsMarkers(text);
  if (!hasMarkers) {
    return { text, changed: false, replacements: 0 };
  }
  const passphrase = await promptForPassphrase(
    "Enter the privacy alias passphrase for this session.",
    true,
  );
  if (!passphrase) {
    throw new Error("Privacy alias passphrase is required.");
  }
  return privacyAliasAnonymizeText(text, passphrase);
}

export async function revealPrivateAliasesForDisplay(text: string) {
  if (!containsPrivacyAliasToken(text)) {
    return { text, changed: false, replacements: 0 };
  }
  const passphrase = await promptForPassphrase(
    "Enter the privacy alias passphrase to reveal aliases locally.",
    false,
  );
  if (!passphrase) {
    return { text, changed: false, replacements: 0 };
  }
  return privacyAliasRevealText(text, passphrase);
}

export function clearPrivacyAliasSessionPassphrase() {
  sessionPassphrase = null;
  revealPromptDeclined = false;
}
