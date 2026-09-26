# Maintainer notes

## Before the first release

- [ ] Published from the maintainer's personal npm account (unscoped name `svara-mcp`; no npm org).
- [ ] npm trusted publishing: on npmjs.com, package `svara-mcp` > Settings > Trusted publishing > GitHub Actions: this repository, workflow filename `publish.yml`, environment `release`. npm only lets you configure this on an existing package, so the very first `0.1.0` may need a one-off manual `npm publish --access public` from a maintainer machine (then configure the trusted publisher and disallow token publishing).
- [ ] GitHub environment `release` exists (optionally with required reviewers).
- [ ] MCP Registry DNS auth: TXT record at the **apex** `svarapi.io` (not a subdomain), and the `MCP_REGISTRY_DNS_KEY` repository/environment secret (below).

## MCP Registry DNS key

The registry proves ownership of the `io.svarapi/*` namespace with an Ed25519 key whose public half is published in DNS.

Generate a key pair locally (OpenSSL 3.0+). Keep `key.pem` out of this repo and in the team password manager.

```bash
openssl genpkey -algorithm Ed25519 -out key.pem

# Public key -> DNS TXT record value
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}"

# Private key -> GitHub secret MCP_REGISTRY_DNS_KEY (64 hex chars, the raw 32-byte seed; NOT the PEM)
openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
```

- DNS: add a `TXT` record on `svarapi.io` (apex, `@`) with value `v=MCPv1; k=ed25519; p=<PUBLIC_KEY>`. It can coexist with other apex TXT records (SPF, verification tokens).
- GitHub: store the hex string as secret `MCP_REGISTRY_DNS_KEY`.
- The workflow runs `mcp-publisher login dns --domain svarapi.io --private-key "$MCP_REGISTRY_DNS_KEY"` then `mcp-publisher publish`.

Check the record: `dig +short TXT svarapi.io`.

## Release steps

1. Bump the version in **three** places to the same value: `package.json` `version`, `server.json` `version`, and `server.json` `packages[0].version`. Also bump `SERVER_VERSION` in `src/server.ts`.
2. `npm ci && npm run typecheck && npm test && npm run build`.
3. Commit, then tag: `git tag v0.1.1 && git push origin main --tags`.
4. `publish.yml` checks the versions match the tag, tests, publishes to npm with provenance, then publishes `server.json` to the MCP Registry.
5. Verify: `npm view svara-mcp version` and `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.svarapi/mcp"`.

`server.json` `name` must equal `package.json` `mcpName` (`io.svarapi/mcp`); the registry checks this against the published npm package.

## Local development

```bash
npm install
npm test          # local HTTP stub, no network
npm run build
SVARA_API_KEY=... node dist/index.js   # stdio server
```

`SVARA_API_BASE` overrides the API base URL and exists for tests only.
