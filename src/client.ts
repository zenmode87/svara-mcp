import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

export const DEFAULT_API_BASE = "https://svarapi.io";
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

/** An error surfaced to the MCP client as a tool error. */
export class SvaraError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SvaraError";
  }
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class SvaraClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.SVARA_API_KEY;
    // SVARA_API_BASE exists for tests only.
    this.baseUrl = (opts.baseUrl ?? process.env.SVARA_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private key(): string {
    const key = this.apiKey?.trim();
    if (!key) {
      throw new SvaraError(
        "missing_api_key",
        "SVARA_API_KEY is not set. Create an API key at https://svarapi.io/dashboard and add it to this MCP server's environment as SVARA_API_KEY.",
      );
    }
    return key;
  }

  private async request(method: string, path: string, body?: BodyInit, contentType?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key()}`,
      Accept: "application/json",
    };
    if (contentType) headers["Content-Type"] = contentType;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body });
    } catch (err) {
      throw new SvaraError("network_error", `Could not reach the Svara API: ${(err as Error).message}`);
    }

    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
      throw new SvaraError(
        e?.code ?? `http_${res.status}`,
        e?.message ?? (typeof data === "string" && data ? data : `Request failed with HTTP ${res.status}`),
        res.status,
        e?.details,
      );
    }
    return data;
  }

  async uploadAudio(filePath: string): Promise<unknown> {
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      throw new SvaraError("file_not_found", `Could not read file: ${filePath}`);
    }
    if (size > MAX_AUDIO_BYTES) {
      throw new SvaraError("file_too_large", `Audio file is ${size} bytes; the maximum is 4 MB.`);
    }
    const type = AUDIO_TYPES[extname(filePath).toLowerCase()];
    if (!type) {
      throw new SvaraError(
        "unsupported_format",
        "Unsupported audio format. Use MP3, M4A/AAC, OGG/Opus, WAV or WebM.",
      );
    }
    const bytes = await readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), basename(filePath));
    return this.request("POST", "/api/v1/audio", form);
  }

  send(input: { recipient: string; audio_url: string; dry_run: boolean }): Promise<unknown> {
    return this.request(
      "POST",
      "/api/v1/send",
      JSON.stringify({ platform: "linkedin", recipient: input.recipient, audio_url: input.audio_url, dry_run: input.dry_run }),
      "application/json",
    );
  }

  status(id: string): Promise<unknown> {
    return this.request("GET", `/api/v1/status/${encodeURIComponent(id)}`);
  }

  usage(): Promise<unknown> {
    return this.request("GET", "/api/usage");
  }
}

export function formatError(err: unknown): string {
  if (err instanceof SvaraError) {
    let msg = `Svara API error [${err.code}]: ${err.message}`;
    const upgrade = (err.details as { upgrade_url?: string } | undefined)?.upgrade_url;
    if (upgrade) msg += `\nUpgrade: ${upgrade}`;
    else if (err.details !== undefined) msg += `\nDetails: ${JSON.stringify(err.details)}`;
    return msg;
  }
  return `Error: ${(err as Error)?.message ?? String(err)}`;
}
