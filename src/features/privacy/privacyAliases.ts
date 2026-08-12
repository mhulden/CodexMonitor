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

async function promptForPassphrase(reason: string, required: boolean) {
  if (!required && revealPromptDeclined) {
    return null;
  }
  if (sessionPassphrase) {
    return sessionPassphrase;
  }
  pendingPassphrasePrompt ??= Promise.resolve(window.prompt(reason)).finally(() => {
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
