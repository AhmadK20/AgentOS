# AgentOS

A personal workspace for your **existing Hermes agents**, built with **Next.js and React**. Pick an agent, start a conversation, assign a task, and follow the work.

## What works

- Discover the default Hermes profile and your named profiles, including their descriptions, models, skills, session counts, and configured MCP connections.
- Chat with a selected agent through Hermes' **Agent Client Protocol (ACP)**, with live responses and tool activity.
- Continue conversations across app restarts using persisted Hermes session IDs.
- Review Hermes tool approval requests in the UI, allow or reject them, and stop active runs.
- Create, edit, assign, execute, complete, reopen, and delete tasks on a three-column board.
- Browse run history and read existing agent memory and identity files.
- Search agents and conversations with Ctrl/Cmd+K. Use light or dark mode, including on mobile.

Hermes owns the agents' model authentication, tools, skills, and memory. AgentOS does not require another model API key and does not copy your credentials into the frontend.

## Run

Requirements: **Node.js 22.13+**, an installed and configured **Hermes Agent**, and its ACP extra.

Verify the runtime:

    hermes acp --check

If ACP is missing, install the ACP extra from your existing Hermes installation following the [Hermes ACP documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp). Keep using your existing installation and profiles.

Install and start development:

    npm ci
    npm run dev

Open **http://127.0.0.1:4310**. Next.js and the Hermes API run in the same process and on the same port.

Production:

    npm run build
    npm start

The custom Node.js server is required: run the npm scripts above rather than invoking Next's development or production server directly. It hosts Next.js and maintains long-lived Hermes subprocesses, ACP messages, and live event connections.

## Configuration

Defaults use the current repository as the agent workspace and the operating-system user's ~/.hermes directory for profiles. Put optional settings in an untracked .env.local file; Next.js loads it when the application starts.

| Variable | Default | Purpose |
| --- | --- | --- |
| HERMES_ROOT | ~/.hermes | The main Hermes directory containing config.yaml and profiles/. |
| HERMES_BIN | hermes | Existing Hermes CLI executable. |
| AGENTOS_PORT | 4310 | Local application port. Set this in your shell before startup. |
| AGENTOS_WORKSPACE | Current directory | Working directory supplied to agent sessions and tools. |
| AGENTOS_DATA_DIR | .data/ | Private AgentOS SQLite database location. |
| AGENTOS_MAX_CONCURRENT | 3 | Maximum simultaneous runs, capped at 8. |
| AGENTOS_RUN_TIMEOUT_MS | 900000 | Run time limit, including time waiting for an approval. |

For a repository other than AgentOS:

    AGENTOS_WORKSPACE=/absolute/path/to/project npm start

AgentOS reads only selected profile metadata. Its memory viewer allows MEMORY.md, USER.md, and SOUL.md, and rejects paths outside the selected profile. Changes to Hermes configuration are picked up with **Refresh profiles** in the Agents screen.

## Remote machine

AgentOS binds to loopback because its backend can control your local Hermes agents. If Hermes runs on a server, use an SSH tunnel from your own computer:

    ssh -N -L 4310:127.0.0.1:4310 user@your-server

Then open http://127.0.0.1:4310 on your computer. This version is a personal application; it has no multi-user login or public hosting configuration.

## How it connects

    Next.js / React UI
            |
       Same-origin API + live events
            |
    Node.js workspace server + SQLite
            |
       ACP JSON-RPC over stdio
            |
    hermes --profile <selected-profile> acp
            |
    Your agent's model, tools, skills, memory, and MCP servers

The backend launches the installed Hermes executable with argument arrays and sends prompts as JSON on stdin. Each conversation gets its own Hermes session. Idle subprocesses close after five minutes and reconnect to the saved session when needed. Stops cancel the Hermes session, then terminate the owned process group if it does not stop. Interrupted runs are marked when AgentOS restarts.

Only approval requests actually emitted by Hermes are surfaced. Hermes' configured tool policies still determine which operations need approval. AgentOS does not add a bypass flag.

Task assignment executes a selected agent; it is not an automatic multi-agent planner. The task board is stored in AgentOS and does not modify Hermes' existing Kanban database. This version shows AgentOS conversations and aggregate existing Hermes session counts; it does not import past conversation transcripts.

## Design references

The interface uses Mistral AI references retrieved through the **official Mobbin MCP server** using the existing Fiddle profile's Mobbin connection. See [docs/design-references.md](docs/design-references.md) for the source screens and adaptations. Reference images, credentials, runtime files, and private memory are excluded from the repository.

## Verification

    npm run check

The production build checks TypeScript. The backend suite uses a deterministic ACP subprocess fixture to verify prompt transport, persistence, profile isolation, approvals, cancellation, task execution, runtime errors, memory boundaries, browser-origin checks, and event replay. These tests do not call a model or use your credentials.

Development verification also exercised the actual installed Scout profile, which returned **“Hermes is connected to AgentOS.”** through the application, and browser checks covered agent selection, task editing, run history, memory, search, theme persistence, and mobile navigation.

## Project layout

| Path | Purpose |
| --- | --- |
| src/app/ | Next.js App Router layout, page, and styles. |
| src/components/AgentOS.tsx | Interactive React workspace. |
| server/index.mjs | Next.js custom server entry point. |
| server/app.mjs | Workspace API, live events, run lifecycle, and approvals. |
| server/acp.mjs | Hermes ACP stdio transport. |
| server/hermes.mjs | Read-only profile discovery and memory access. |
| server/store.mjs | AgentOS SQLite persistence. |
| tests/ | Backend integration tests and ACP fixture. |
