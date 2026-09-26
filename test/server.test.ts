import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

type Reply = { status: number; body: unknown };

let http: Server;
let base: string;
let dir: string;
let requests: Captured[] = [];
let replies: Record<string, Reply> = {};

const KEY = "test_key_123";

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "svara-mcp-test-"));
  http = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      const reply = replies[`${req.method} ${req.url}`] ?? { status: 404, body: { error: { code: "not_found", message: "no route" } } };
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((r) => http.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  replies = {
    "POST /api/v1/audio": {
      status: 201,
      body: { id: "aud_1", audio_url: "https://cdn.example.test/a.mp3", content_type: "audio/mpeg", size: 5, expires_at: "2026-10-01T00:00:00Z" },
    },
    "POST /api/v1/send": { status: 200, body: { dry_run: true, valid: true } },
    "GET /api/v1/status/msg_1": {
      status: 200,
      body: { id: "msg_1", status: "sent", platform: "linkedin", recipient: "x", created_at: "t", delivered_at: "t", error: null, error_code: null },
    },
    "GET /api/usage": { status: 200, body: { plan: "starter", used: 3, limit: 100 } },
  };
});

async function connect(apiKey: string | undefined = KEY) {
  const server = createServer({ apiKey: apiKey ?? "", baseUrl: base });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(b);
  return client;
}

function text(res: unknown): string {
  return ((res as { content: { text: string }[] }).content[0]!).text;
}

async function audioFile(name = "note.mp3"): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, Buffer.from("ID3ab"));
  return p;
}

test("lists exactly the four tools with safety annotations", async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_send_status", "get_usage", "send_linkedin_voice_note", "upload_audio"]);
  const send = tools.find((t) => t.name === "send_linkedin_voice_note")!;
  assert.equal(send.annotations?.destructiveHint, true);
  assert.equal(send.annotations?.openWorldHint, true);
  assert.equal(send.annotations?.readOnlyHint, false);
  assert.match(send.description!, /REAL LinkedIn voice message/);
  assert.match(send.description!, /explicitly asked/);
  assert.match(send.description!, /already message on LinkedIn/);
});

test("upload_audio posts multipart file with bearer auth", async () => {
  const c = await connect();
  const res = await c.callTool({ name: "upload_audio", arguments: { file_path: await audioFile() } });
  assert.ok(!res.isError, text(res));
  assert.match(text(res), /cdn\.example\.test\/a\.mp3/);
  assert.equal(requests.length, 1);
  const r = requests[0]!;
  assert.equal(r.method, "POST");
  assert.equal(r.url, "/api/v1/audio");
  assert.equal(r.headers.authorization, `Bearer ${KEY}`);
  assert.match(String(r.headers["content-type"]), /^multipart\/form-data; boundary=/);
  const body = r.body.toString("latin1");
  assert.match(body, /name="file"; filename="note.mp3"/);
  assert.match(body, /Content-Type: audio\/mpeg/i);
  assert.ok(body.includes("ID3ab"));
});

test("send defaults dry_run to true", async () => {
  const c = await connect();
  const res = await c.callTool({
    name: "send_linkedin_voice_note",
    arguments: { recipient: "https://www.linkedin.com/in/someone", audio_url: "https://cdn.example.test/a.mp3" },
  });
  assert.ok(!res.isError, text(res));
  const r = requests[0]!;
  assert.equal(r.method, "POST");
  assert.equal(r.url, "/api/v1/send");
  assert.equal(r.headers.authorization, `Bearer ${KEY}`);
  assert.match(String(r.headers["content-type"]), /application\/json/);
  assert.deepEqual(JSON.parse(r.body.toString()), {
    platform: "linkedin",
    recipient: "https://www.linkedin.com/in/someone",
    audio_url: "https://cdn.example.test/a.mp3",
    dry_run: true,
  });
});

test("send with dry_run false passes false through", async () => {
  replies["POST /api/v1/send"] = { status: 202, body: { id: "msg_1", status: "queued" } };
  const c = await connect();
  const res = await c.callTool({
    name: "send_linkedin_voice_note",
    arguments: { recipient: "Jane Doe", audio_url: "https://cdn.example.test/a.mp3", dry_run: false },
  });
  assert.ok(!res.isError, text(res));
  assert.equal(JSON.parse(requests[0]!.body.toString()).dry_run, false);
  assert.match(text(res), /msg_1/);
});

test("send with file_path uploads first then sends the returned audio_url", async () => {
  const c = await connect();
  const res = await c.callTool({
    name: "send_linkedin_voice_note",
    arguments: { recipient: "Jane Doe", file_path: await audioFile("v.m4a") },
  });
  assert.ok(!res.isError, text(res));
  assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ["POST /api/v1/audio", "POST /api/v1/send"]);
  const sent = JSON.parse(requests[1]!.body.toString());
  assert.equal(sent.audio_url, "https://cdn.example.test/a.mp3");
  assert.equal(sent.dry_run, true);
});

test("send requires exactly one of audio_url / file_path", async () => {
  const c = await connect();
  const none = await c.callTool({ name: "send_linkedin_voice_note", arguments: { recipient: "Jane" } });
  assert.equal(none.isError, true);
  assert.match(text(none), /exactly one of audio_url or file_path/);
  const both = await c.callTool({
    name: "send_linkedin_voice_note",
    arguments: { recipient: "Jane", audio_url: "https://cdn.example.test/a.mp3", file_path: await audioFile() },
  });
  assert.equal(both.isError, true);
  assert.match(text(both), /exactly one of audio_url or file_path/);
  assert.equal(requests.length, 0);
});

test("get_send_status GETs the status path", async () => {
  const c = await connect();
  const res = await c.callTool({ name: "get_send_status", arguments: { id: "msg_1" } });
  assert.ok(!res.isError, text(res));
  assert.equal(requests[0]!.method, "GET");
  assert.equal(requests[0]!.url, "/api/v1/status/msg_1");
  assert.equal(requests[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.match(text(res), /"status": "sent"/);
});

test("get_usage GETs /api/usage and passes the body through", async () => {
  const c = await connect();
  const res = await c.callTool({ name: "get_usage", arguments: {} });
  assert.ok(!res.isError, text(res));
  assert.equal(requests[0]!.method, "GET");
  assert.equal(requests[0]!.url, "/api/usage");
  assert.deepEqual(JSON.parse(text(res)), { plan: "starter", used: 3, limit: 100 });
});

test("API errors become tool errors with code and message", async () => {
  replies["POST /api/v1/send"] = {
    status: 429,
    body: { error: { code: "rate_limit_exceeded", message: "Daily limit reached", details: { upgrade_url: "https://svarapi.io/pricing" } } },
  };
  const c = await connect();
  const res = await c.callTool({
    name: "send_linkedin_voice_note",
    arguments: { recipient: "Jane", audio_url: "https://cdn.example.test/a.mp3" },
  });
  assert.equal(res.isError, true);
  assert.match(text(res), /rate_limit_exceeded/);
  assert.match(text(res), /Daily limit reached/);
  assert.match(text(res), /svarapi\.io\/pricing/);

  replies["POST /api/v1/audio"] = { status: 413, body: { error: { code: "storage_limit_exceeded", message: "Storage full" } } };
  const up = await c.callTool({ name: "upload_audio", arguments: { file_path: await audioFile() } });
  assert.equal(up.isError, true);
  assert.match(text(up), /storage_limit_exceeded/);
  assert.match(text(up), /Storage full/);
});

test("missing API key gives a clear error and makes no request", async () => {
  const c = await connect("");
  const res = await c.callTool({ name: "get_usage", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(text(res), /SVARA_API_KEY/);
  assert.match(text(res), /https:\/\/svarapi\.io\/dashboard/);
  assert.equal(requests.length, 0);
});

test("unsupported file type is rejected locally", async () => {
  const c = await connect();
  const res = await c.callTool({ name: "upload_audio", arguments: { file_path: await audioFile("x.txt") } });
  assert.equal(res.isError, true);
  assert.match(text(res), /Unsupported audio format/);
  assert.equal(requests.length, 0);
});
