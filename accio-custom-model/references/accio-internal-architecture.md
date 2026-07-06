---
title: Accio Internal Architecture Analysis
date: 2026-07-03
last_updated: 2026-07-06
summary: >
  Deep dive into Accio's model routing system. Key findings:
  - agent.json model fields are IGNORED by Accio
  - Model routing is server-controlled via RLab gateway
  - Local gateway on port 4097, relay on 9236
  - PHOENIX_ROUTING_TEST=true forces modelCode 1Nexus-R3wF8qJ5vB6h (Gemini 3 Flash)
  - ASAR path handling on Windows requires stripping leading backslashes from listPackage() output
  - extractFile() needs paths prefixed with / after stripping the leading \
  - Never use asar CLI on Windows — always use Node.js API
  - model-catalog.json is bundled at \node_modules\@ali\accio-adk-ts\model-catalog.json inside ASAR
  - RLab model router calls POST ${gatewayBaseUrl}/api/tool/rlab/call with {function:"model_routing"}
  - ACCIO VERSION: 0.20.0 (upgraded from 0.16.1 on 2026-07-06)
  - MCP client uses streamable-http transport in 0.20.0
  - model_cache.json is NOT overwritten on restart (persists local changes)
---

# Accio Internal Architecture Analysis

## Key Components

### 1. Electron ASAR Bundle
- Location: `D:/Accio/resources/app.asar`
- Contains: All JavaScript/TypeScript source code
- Key files:
  - `node_modules/@ali/accio-adk-ts/model-catalog.json` — Model catalog
  - `out/main/chunks/rlab-model-router-*.js` — Model routing logic

### 2. Model Routing Flow
```
User sends message
  ↓
RlabModelRouter.resolve()
  ↓
POST to ${gatewayBaseUrl}/api/tool/rlab/call
  Body: {function:"model_routing", payload:{...}, token:authToken}
  ↓
Server returns: {modelCode: "1Nexus-R3wF8qJ5vB6h", ...}
  ↓
Accio uses the modelCode to identify which LLM to call
```

### 3. Gateway Ports
- Gateway: `localhost:4097` — Main gateway service
- Relay: `localhost:9236` — Communication relay
- External proxies: `localhost:7890` — Clash/Mihomo proxy

### 4. Configuration Files
- `C:/Users/guyin/.accio/model_cache.json` — Cached model list (server-synced)
- `C:/Users/guyin/.accio/accounts/*/agents/*/agent.json` — Per-agent config (model fields NOT used)
- `C:/Users/guyin/.accio/settings.jsonc` — General settings

## Model Codes Reference

| Model Code | Display Name | Provider |
|------------|--------------|----------|
| 1Nexus-R3wF8qJ5vB6h | Gemini 3 Flash | gemini |
| 1Orbit-I93F4tK8bW1f | Claude Sonnet 5 | claude |
| 1Drift-T2nB5kS9aU7w | Qwen 3 Max | qwen |
| 1Helix-B3jR8wN1dY6s | GPT 5.5 | openai |

## Environment Variables

- `PHOENIX_ROUTING_TEST=true` — Forces default modelCode (1Nexus-R3wF8qJ5vB6h)
- `ACCIO_ADK_AUTH_TOKEN` — Authentication token for ADK calls

## Hijacking Points

1. **Model Catalog** — Modify `model-catalog.json` to add custom providers
2. **Gateway Proxy** — Intercept `/api/tool/rlab/call` requests
3. **Environment Variables** — Force specific modelCode via `PHOENIX_ROUTING_TEST`

## ASAR Path Handling (Windows)

**CRITICAL**: The `asar` CLI tool fails on Windows with path escaping errors. Always use the Node.js API.

### listPackage() returns paths with `\\` prefix

```javascript
const files = asar.listPackage(archivePath);
// Returns: ["\\node_modules\\@ali\\accio-adk-ts\\model-catalog.json", ...]
// (JSON.stringify shows \\\\ because each \\ is escaped)
```

### extractFile() needs paths prefixed with /

```javascript
const cleanPath = file.replace(/^\\\\/, '');  // strip leading \\
const content = asar.extractFile(archivePath, '/' + cleanPath);
```

### Repacking — createPackage is ASYNC

```javascript
asar.createPackage(sourceDir, destPath, callback);
// There is NO createPackageSync() — the function is asynchronous
// If your script exits without error but produces no file, you used the wrong method
```

### Verify after repacking

Always verify the modified ASAR contains your changes before replacing the original:

```javascript
const files = asar.listPackage(modifiedArchivePath);
const hasCatalog = files.some(f => f.includes('model-catalog'));
const content = asar.extractFile(modifiedArchivePath, '/' + cleanCatalogPath);
const catalog = JSON.parse(content);
const hasCustomProvider = catalog.some(p => p.provider === 'agnes-ai');
```

## Notes

- Accio's model system is designed to be server-controlled
- Local configuration changes (agent.json) are ignored for model selection
- Any hijacking must work through the gateway or by modifying the bundled catalog
- Accio updates will overwrite any ASAR modifications