# Privacy Aliases

Privacy aliases provide a lightweight way to keep sensitive names or labels out of
Codex prompts, Codex-visible files, debug payloads, and remote daemon traffic.

This is not a full data-loss-prevention system. It is an explicit opt-in
anonymization layer for text the user marks with privacy syntax.

## User Syntax

Use either form in normal chat text:

```text
@p{John Smith} got 9.0 on HW3.
@private{Student A} missed the quiz.
```

Before the message is sent to Codex, CodexMonitor rewrites marked text to a
self-decrypting alias:

```text
P1_<encrypted-token> got 9.0 on HW3.
```

The model sees only the `P1_...` alias. The local UI can reveal the original
plaintext back to the user after the response is rendered.

## Passphrase Behavior

- Users who never type `@p{...}` or `@private{...}` should never see a privacy passphrase prompt.
- The first message in an app session that contains a privacy marker prompts for a passphrase.
- The passphrase is kept in frontend session memory only. It is not persisted.
- Restarting the app clears the session passphrase.
- Opening old messages that contain `P1_...` aliases may prompt once if local reveal is enabled.
- Wrong or cancelled reveal passphrases leave aliases unchanged.

## Settings

The display setting is:

```text
Settings > Display & Chat > Reveal privacy aliases locally
```

It is on by default and controls only local deanonymization in the UI. Sending
side anonymization remains automatic whenever the user explicitly types privacy
markers.

## Markdown Code Contexts

Privacy markers are ignored inside Markdown inline code and fenced code blocks.
This prevents accidental rewrites of source code examples:

````markdown
Use `@p{John Smith}` literally here.

```text
@p{John Smith}
```
````

If sensitive data appears inside a code fence or inline code span, move it out of
the code context before sending or use the standalone tool intentionally on the
file content.

## Cryptographic Design

Privacy aliases are self-decrypting encrypted tokens, not hashes. This is what
allows a later reveal step to recover plaintext from only the alias text and the
same passphrase.

The current `P1_` format works as follows:

- The user passphrase is stretched into a 64-byte key with Argon2id.
- The plaintext inside `@p{...}` / `@private{...}` is encrypted with AES-256-SIV.
- The encrypted bytes are encoded with unpadded URL-safe Base64.
- The final alias is emitted as `P1_<base64url-ciphertext>`.
- Additional authenticated data binds tokens to the CodexMonitor privacy-alias
  v1 format.

AES-SIV is intentionally deterministic here. The same plaintext and passphrase
produce the same alias, which helps the model preserve identity consistency
without seeing the underlying value. A different passphrase produces different
aliases.

Important limits:

- Passphrase strength matters. A weak passphrase weakens the whole layer.
- There is no server-side vault or recovery mechanism.
- If the passphrase is lost, existing `P1_...` aliases cannot be revealed.
- Aliases are authenticated: a wrong passphrase or malformed token is left
  unchanged instead of producing guessed plaintext.
- This layer protects explicitly marked text before it is sent to Codex; it does
  not inspect arbitrary files, screenshots, attachments, terminal output, or
  unmarked sensitive text.

## Standalone File Tool

Release builds include `codexmonitor_privacy`, which can anonymize or reveal
aliases in text files without contacting Codex.

Usage:

```bash
codexmonitor_privacy anonymize [--passphrase <passphrase>] <file|->
codexmonitor_privacy reveal [--passphrase <passphrase>] <file|->
```

Examples:

```bash
# Anonymize a file and write a private copy.
codexmonitor_privacy anonymize grades.md > grades.private.md

# Reveal aliases to stdout, leaving the original file unchanged.
codexmonitor_privacy reveal grades.private.md

# Supply the passphrase non-interactively.
codexmonitor_privacy reveal --passphrase "$PRIVACY_ALIAS_PASSPHRASE" grades.private.md

# Read from stdin.
cat grades.private.md | codexmonitor_privacy reveal -
```

The tool writes transformed text to stdout and does not modify input files in
place.

## Remote Backend Notes

In remote backend mode, chat anonymization and local reveal happen in the desktop
client before text is sent to the remote daemon and after text is received back.
The daemon and Codex process should see aliases, not plaintext.

For files that live on a remote VM, use the `codexmonitor_privacy` binary built
for that remote machine and the same passphrase:

```bash
codexmonitor_privacy reveal remote-file.private.csv > remote-file.revealed.csv
```

## Implementation Notes

- Core logic lives in `src-tauri/src/shared/privacy_alias_core.rs`.
- Tauri IPC commands live in `src-tauri/src/privacy.rs`.
- Frontend session-passphrase handling lives in `src/features/privacy/privacyAliases.ts`.
- The standalone CLI lives in `src-tauri/src/bin/codexmonitor_privacy.rs`.
- Aliases use the `P1_` prefix for the current wire/storage format.
- The encryption path is deterministic for the same plaintext and passphrase so repeated names map to repeated aliases within a workspace/task.

## Future Expansion

This module is deliberately lightweight. It is meant to make real UX testing
possible before adding heavier privacy infrastructure.

Possible future directions:

- Workspace-scoped vaults for stable alias registries, metadata, labels, and
  rotation.
- OS keychain or encrypted-at-rest storage for passphrase/session management.
- Workspace policies that warn about private markers inside code fences or
  attachments.
- Optional whole-file anonymization workflows for CSV, Markdown, JSON, and
  tabular data.
- Bulk reveal/anonymize commands that can rewrite files in place with backups.
- Team/shared vault export for environments where multiple users need consistent
  aliases.
- Stronger UX around passphrase quality and explicit workspace privacy state.

Those are intentionally out of scope for the first version. The current design
keeps the model, daemon, debug payloads, and stored chat history on the alias
side of the boundary while avoiding a persistent vault that users must manage
before the feature has been tested in real workflows.
