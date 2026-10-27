# Day-1 verification (Task 0)

Run on 2026-10-27 (build day 2) on Windows 11, Node 22.23, pnpm 11.20.

## Meta Model API

| Item | Value |
|---|---|
| Base URL | `https://api.meta.ai/v1` (OpenAI-compatible; `/chat/completions` and `/responses` both answer) |
| Model id | `muse-spark-1.3` |
| Key | `META_API_KEY` in local `.env`, never committed |

The base URL first copied from dev.meta.ai pointed at `/v1/responses`. Clients that append `/chat/completions` need the bare `/v1` base, so `.env` now holds `https://api.meta.ai/v1`.

| Check | Result |
|---|---|
| Plain chat completion | HTTP 200, `usage` returned. "Say hi in two words": 14 input tokens, 321 output tokens, of which 310 reasoning |
| `response_format` JSON schema `{ok: boolean}` | Works. Returned `{"ok": true}` |
| Image input (`image_url` data URL, PNG) | Works. A 64x64 blue PNG was answered "blue" |
| Tool calling | Works. Returned a `get_weather` call with `{"city":"Lagos"}` |
| Prompt caching | `cached_tokens` reported (113 of 544 on the tool call) |

### Reasoning tokens drive cost

Muse Spark reasons before every answer, and reasoning is billed as output. A two-word reply cost 100 to 800 output tokens. What follows for the build:

- `reasoning_effort` is supported: `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (`none` is rejected). `minimal` cut the trivial reply from about 300 to 124 output tokens. The adapter (Task 2) should set effort per role call: low or minimal for narrow extraction, medium for analysis.
- `max_completion_tokens` includes reasoning tokens. With a cap of 100 the reply came back empty (`content: null`). Caps must leave room for reasoning, and the adapter must treat empty content as an error, not as an answer.
- Price per million tokens was not visible through the API. Still to confirm in the Meta console: the reported $1.25 input and $4.25 output.

## Coding agent

| Candidate | Result |
|---|---|
| Muse Code (Meta) | Not usable here. Its launcher supports macOS and Linux only and stops with "unsupported platform" on Windows (MINGW64). WSL has no Linux distribution installed. It would bill to the same `META_API_KEY`, so it stays an option if a Linux environment is set up later |
| Cline (VS Code) | Not tried. Setting its provider needs the key pasted into the extension settings by the founder |
| OpenCode 1.19.4 | Works on Muse Spark. Asked to create `hello.txt`, it wrote "hello from muse spark" |

OpenCode setup: a custom provider using `@ai-sdk/openai-compatible`, base URL above, `apiKey` read from `{env:META_API_KEY}`, model `meta/muse-spark-1.3`. Run it with `OPENCODE_DISABLE_CLAUDE_CODE=1` and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`. Without them it loads every skill in the machine's personal Claude folders into the agent's context, which wastes credits and mixes pre-event material into the demo agent.

## MCP

A stdio "echo" server built with `@modelcontextprotocol/sdk` (scratch folder outside the repo) was added to OpenCode's `mcp` config. Asked to call it, the agent returned `ECHO: kryterea day one`. MCP from the coding agent to a local server works.

## Pre-mortem

Run with pre-existing private tooling (disclosed in `BUILT_DURING_HACKATHON.md`); its report stays outside the repo. Plan changes it led to are listed below.

<!-- filled in after the pre-mortem -->
