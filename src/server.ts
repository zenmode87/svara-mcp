import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SvaraClient, SvaraError, formatError, type ClientOptions } from "./client.js";

export const SERVER_NAME = "svara";
export const SERVER_VERSION = "0.1.0";

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: formatError(err) }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const SEND_DESCRIPTION = [
  "Send a native LinkedIn voice note to a person via Svara.",
  "WARNING: when dry_run is false this sends a REAL LinkedIn voice message to a real person, from the user's own LinkedIn account. It cannot be unsent.",
  "Only call with dry_run=false when the user has explicitly asked you to send this voice note to this recipient. dry_run defaults to true, which validates the request without sending anything.",
  "The recipient must be someone the user can already message on LinkedIn (for example a 1st-degree connection); pass their LinkedIn profile URL (preferred) or the name part after /in/ (not their display name).",
  "Provide exactly one of audio_url (from upload_audio) or file_path (a local audio file, uploaded first).",
  "Delivery requires the Svara Chrome extension to be installed and the user to be signed in to LinkedIn in Chrome.",
  "Returns a message id; check delivery with get_send_status.",
].join(" ");

export function createServer(clientOptions: ClientOptions = {}): McpServer {
  const client = new SvaraClient(clientOptions);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "upload_audio",
    {
      title: "Upload audio",
      description:
        "Upload a local audio file (MP3, M4A/AAC, OGG/Opus, WAV or WebM, max 4 MB) to Svara. Returns an audio_url to pass to send_linkedin_voice_note. Uploading does not send anything.",
      inputSchema: {
        file_path: z.string().min(1).describe("Absolute path to a local audio file."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ file_path }) => run(() => client.uploadAudio(file_path)),
  );

  server.registerTool(
    "send_linkedin_voice_note",
    {
      title: "Send LinkedIn voice note",
      description: SEND_DESCRIPTION,
      inputSchema: {
        recipient: z
          .string()
          .min(1)
          .describe("LinkedIn profile URL (preferred) or full name of someone the user can already message on LinkedIn."),
        audio_url: z.string().url().optional().describe("audio_url returned by upload_audio. Provide this OR file_path."),
        file_path: z.string().min(1).optional().describe("Local audio file to upload and send. Provide this OR audio_url."),
        dry_run: z
          .boolean()
          .default(true)
          .describe("Defaults to true (validate only, nothing is sent). Set false ONLY when the user explicitly asked to send."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ recipient, audio_url, file_path, dry_run }) =>
      run(async () => {
        if ((audio_url ? 1 : 0) + (file_path ? 1 : 0) !== 1) {
          throw new SvaraError("invalid_parameter", "Provide exactly one of audio_url or file_path.");
        }
        const dryRun = dry_run ?? true;
        let url = audio_url;
        if (file_path) {
          const uploaded = (await client.uploadAudio(file_path)) as { audio_url?: string };
          if (!uploaded?.audio_url) throw new SvaraError("upload_failed", "Upload succeeded but returned no audio_url.");
          url = uploaded.audio_url;
        }
        return client.send({ recipient, audio_url: url!, dry_run: dryRun });
      }),
  );

  server.registerTool(
    "get_send_status",
    {
      title: "Get send status",
      description: "Get the delivery status (queued, sent, failed or expired) of a voice note sent with send_linkedin_voice_note.",
      inputSchema: {
        id: z.string().min(1).describe("The id returned by send_linkedin_voice_note."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => client.status(id)),
  );

  server.registerTool(
    "get_usage",
    {
      title: "Get usage",
      description: "Get the current Svara plan usage and limits for this API key.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => run(() => client.usage()),
  );

  return server;
}
