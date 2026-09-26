# Svara MCP server

Send native **LinkedIn voice notes** from Claude, Cursor, VS Code or any other [MCP](https://modelcontextprotocol.io) client.

[Svara](https://svarapi.io) is a REST API for sending voice notes on LinkedIn. This server exposes it as MCP tools, so your AI assistant can upload a recording, validate a send, deliver a voice note to one of your LinkedIn contacts, and check whether it arrived.

## What it does

- Upload an audio file (MP3, M4A/AAC, OGG/Opus, WAV or WebM, up to 4 MB).
- Send it as a native LinkedIn voice note to someone you can already message on LinkedIn.
- Check delivery status (`queued`, `sent`, `failed`, `expired`).
- Check your plan usage.

Sends are **dry runs by default**: nothing is delivered unless `dry_run` is explicitly set to `false`.

## Prerequisites

1. A Svara account and an API key: create one at <https://svarapi.io/dashboard>.
2. The [Svara Chrome extension](https://chromewebstore.google.com/detail/svara-voice-notes/idhelbcgjmjipihikjnefbphamnbbjaa) installed.
3. You are signed in to LinkedIn in that Chrome browser.
4. Node.js 20 or newer (for `npx`).

## Setup

All clients run the same command: `npx -y svara-mcp` with `SVARA_API_KEY` in the environment.

### Claude Desktop

Add to `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "svara": {
      "command": "npx",
      "args": ["-y", "svara-mcp"],
      "env": { "SVARA_API_KEY": "your_svara_api_key" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add svara --env SVARA_API_KEY=your_svara_api_key -- npx -y svara-mcp
```

### Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "svara": {
      "command": "npx",
      "args": ["-y", "svara-mcp"],
      "env": { "SVARA_API_KEY": "your_svara_api_key" }
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "inputs": [
    { "type": "promptString", "id": "svara-api-key", "description": "Svara API key", "password": true }
  ],
  "servers": {
    "svara": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "svara-mcp"],
      "env": { "SVARA_API_KEY": "${input:svara-api-key}" }
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `upload_audio` | `{ file_path }` Uploads a local audio file and returns an `audio_url`. Sends nothing. |
| `send_linkedin_voice_note` | `{ recipient, audio_url? , file_path?, dry_run = true }` Sends a voice note. `recipient` is a LinkedIn profile URL (preferred) or name. Give exactly one of `audio_url` or `file_path` (a file is uploaded first). |
| `get_send_status` | `{ id }` Delivery status of a send. |
| `get_usage` | `{}` Current plan usage and limits. |

Example prompt: *"Upload ~/Desktop/intro.m4a and do a dry run of sending it to https://www.linkedin.com/in/example. If it validates, send it for real."*

## Safety

`send_linkedin_voice_note` sends a **real** LinkedIn message to a **real** person from **your own** LinkedIn account when `dry_run` is `false`. It cannot be unsent.

- `dry_run` defaults to `true`, which validates the request without sending anything.
- The tool is marked as destructive, so MCP clients that support tool annotations will ask you to confirm before it runs. Keep that confirmation on.
- Only send to people you can already message on LinkedIn, and only messages you would send yourself.

## Pricing

Plans and limits: <https://svarapi.io/pricing>. When you hit a limit, the tool error includes an upgrade link.

## Support

Email [hello@svarapi.io](mailto:hello@svarapi.io).

## License

[MIT](./LICENSE)
