# ChatGPT App Feature Backlog

This document tracks CodexMonitor feature ideas inspired by ChatGPT app and Codex CLI capabilities. It is intentionally forward-looking: items here are candidates for design, implementation, or rejection after deeper review.

## High-Priority Candidates

### MCP And Plugin Management

CodexMonitor can surface MCP/plugin configuration instead of requiring users to edit config files or infer app-server behavior from logs.

Possible scope:

- Show configured MCP servers and plugins per workspace/profile.
- Show server health, startup errors, and unavailable tools.
- Expose enable/disable controls for MCP servers.
- Surface approval-blocked MCP tool calls clearly in the chat UI.
- Add a minimal setup flow for common local MCP servers, especially browser automation.

Current slice:

- MCP server status and live diagnostics are available in Settings > MCP.
- The first slice is read-only and uses the active Codex app-server or remote daemon.
- Plugin browsing/install and MCP config mutation remain future work.

Why it matters:

- MCP usage is increasingly common.
- Tool failures are currently hard to distinguish from model hangs.
- CodexMonitor already benefits from being the visibility layer around Codex.

Relevant references:

- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://learn.chatgpt.com/docs/codex/cli

### Scheduled Tasks And Automations

CodexMonitor can add a lightweight scheduler for recurring Codex work inside workspaces.

Possible scope:

- Create scheduled prompts for a workspace.
- Run recurring checks such as status summaries, dependency audits, test runs, or issue triage.
- Show scheduled task history and last result.
- Allow tasks to run through local or remote daemon backends.
- Start with explicit user-authored schedules rather than autonomous background behavior.

Why it matters:

- Many CodexMonitor workflows are naturally recurring.
- The daemon/backend model is already close to what scheduled execution needs.
- A conservative implementation can avoid surprising background changes by making schedules explicit.

Relevant reference:

- https://learn.chatgpt.com/docs/automations

## Other Candidate Features

### Skills Browser And Installer

CodexMonitor can provide a GUI for discovering, installing, enabling, and inspecting Codex skills.

Possible scope:

- List installed skills.
- Show skill descriptions and source locations.
- Install curated or repo-hosted skills.
- Enable workspace-specific skill recommendations.
- Show which skills were active in a thread.

Relevant references:

- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/guides/best-practices

### Subagent Visualization

CodexMonitor can make subagent activity more visible and easier to understand.

Possible scope:

- Show child-agent lifecycle events in a structured panel.
- Display which model/profile each subagent used.
- Group subagent output separately from the main thread.
- Add diagnostics for failed or blocked subagents.
- Consider optional UI affordances for common subagent patterns after usage is clearer.

Relevant reference:

- https://learn.chatgpt.com/docs/agent-configuration/subagents

### Browser Tool Panel

CodexMonitor can improve browser automation workflows without immediately becoming a full browser UI.

Possible scope:

- Show browser MCP tool calls and approvals prominently.
- Surface current browser target/page information when available.
- Add clearer diagnostics when browser tools are installed but unavailable.
- Provide setup guidance for Playwright/browser MCP configurations.

Relevant reference:

- https://learn.chatgpt.com/docs/extend/mcp?surface=cli

### App-Server Parity Diagnostics

CodexMonitor can detect and explain app-server capability mismatches between the UI, bundled daemon, remote daemon, and installed Codex CLI.

Possible scope:

- Show Codex CLI version used by each workspace or daemon.
- Show supported app-server methods and missing-method warnings.
- Warn when a remote daemon is older than the GUI.
- Add a diagnostics panel for model list, rate-limit reset info, MCP events, and approval support.

Why it matters:

- Remote mode makes version skew easy.
- Missing methods currently appear as isolated UI failures.
- CodexMonitor has already needed parity fixes for model lists, reset credits, and daemon RPC surfaces.

Relevant references:

- https://learn.chatgpt.com/docs/codex/cli
- docs/app-server-events.md

## Planning Notes

- Start with MCP/plugin management and scheduled tasks; they are the most product-shaped additions.
- Keep remote-mode parity in scope from the beginning for any backend feature.
- Prefer shared Rust cores plus thin app/daemon adapters for cross-runtime behavior.
- Avoid hidden autonomous execution; scheduled or tool-driven behavior should be explicit and inspectable.
