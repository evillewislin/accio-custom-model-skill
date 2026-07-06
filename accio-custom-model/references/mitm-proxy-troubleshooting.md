---
title: MITM Proxy Troubleshooting for Accio
date: 2026-07-03
last_updated: 2026-07-03
summary: >
  Common issues and fixes when using MITM proxy to inject custom models into Accio.
---

# MITM Proxy Troubleshooting

## Problem: Proxy Starts But Accio Doesn't Use Custom Model

### Symptoms
- MITM proxy intercepts RLab requests and returns custom modelCode
- Accio logs show `RlabModelRouter` messages
- But the actual LLM call uses the default model (e.g., `1Nexus-R3wF8qJ5vB6h`)

### Root Cause
The modelCode returned by the proxy is not recognized because:
1. The provider doesn't exist in `model_cache.json`
2. The modelCode format doesn't match expected patterns
3. Accio cached the original modelCode from a previous session

### Fix
1. **Add provider to model_cache.json**:
   ```bash
   node scripts/add-model-to-cache.js --provider agnes-ai --display "Agnes AI" --model 1Agnes-F4sH2aS8qJ5v --model-name agnes-2.0-flash
   ```
2. **Clear Accio's cache**: Delete `~/.accio/model_cache.json` and restart Accio
3. **Verify proxy is intercepting**: Check proxy logs for `[RLAB] Intercepted model_routing` messages

## Problem: SSL Certificate Error When Forwarding to Real Gateway

### Symptoms
- Proxy starts successfully on port 7001
- RLab interception works (returns custom modelCode)
- But forwarding to phoenix-gw.alibaba.com fails with:
  `self-signed certificate in certificate chain`

### Root Cause
Accio's offline mode uses a local Spring Boot gateway with self-signed certificates. When the proxy forwards non-intercepted requests to phoenix-gw.alibaba.com, Node.js's https module rejects the self-signed certificate.

### Fix
1. **For RLab interception only**: The proxy already works correctly for RLab requests (they return custom modelCode)
2. **For other requests**: The SSL error only affects non-RLab requests. Since the proxy forwards most requests to the real gateway, this may cause issues with:
   - Heartbeat checks
   - Channel queries
   - Plugin upgrades
   
3. **Workaround**: If Accio works despite the SSL errors (it may cache some responses), continue using the proxy. If not, consider running a full local gateway instead of just a proxy.

### Verification
Check proxy logs for `[MITM] Forward to real gateway error` messages. If they appear frequently, the SSL issue is affecting normal operation.

## Problem: Accio Version 0.20.0 Changes Behavior

### Symptoms
- Old scripts and instructions from version 0.16.1 no longer work
- MCP connection to agnes-ai fails with 404 Not Found
- Different log format and module names

### Root Cause
Accio upgraded from 0.16.1 to 0.20.0 between sessions. The internal architecture changed:
- MCP client now uses `streamable-http` transport
- Model routing still uses RLab but with different internal paths
- Settings structure may have changed

### Fix
1. **Check Accio version**: Look at SDK logs for `"version":"0.20.0"` or similar
2. **Update scripts**: Use `scripts/mitm-proxy-enhanced.js` which is tested with 0.20.0
3. **Verify settings.jsonc**: The `dev.environment` field should still work, but check the structure

### Detection
From SDK logs, look for:
- `"version":"0.20.0"` in log entries
- `module:"McpClient"` for MCP connections
- `module:"RlabModelRouter"` for model routing
- `module:"ConnectorDebug"` for connection details

## Problem: MCP Connection to agnes-ai Fails with 404

### Symptoms
- Proxy intercepts RLab and returns custom modelCode
- Accio looks up model in model_cache.json successfully
- But MCP connection to apihub.agnes-ai.com/v1 fails with 404

### Root Cause
Accio's MCP client constructs the wrong URL path. It tries `POST /v1` but agnes-ai expects `POST /v1/chat/completions`.

### Fix
1. **Modify model_cache.json**: Add correct baseUrl for agnes-ai provider
2. **Use local API gateway**: Run a proxy that rewrites `/v1` to `/v1/chat/completions`
3. **Wait for Accio update**: Accio may fix this in future versions

### Verification
Check SDK logs for:
- `url=https://apihub.agnes-ai.com/v1` (wrong path)
- `status=404` (Not Found)
- `MCP HTTP request 'initialize' failed: 404 Not Found`

## Problem: Port 7001 Already In Use

### Symptoms
- Proxy fails to start with `EADDRINUSE` error
- `netstat -ano | findstr :7001` shows a process listening

### Root Cause
Accio's built-in Spring Boot gateway may also bind to port 7001 in offline mode.

### Fix
1. **Find the process**: `netstat -ano | findstr :7001`
2. **Kill the process**: `powershell -Command "Stop-Process -Id <PID> -Force"`
3. **Alternative**: Use a different port by modifying the proxy script

## Problem: Offline Mode Breaks Login

### Symptoms
- Accio fails to authenticate or shows login errors
- `loginBaseUrl` is set to `https://pre-www.accio.com` in offline mode

### Root Cause
The `offline` environment changes multiple configuration values, not just `gatewayBaseUrl`.

### Fix
1. **Option A**: Revert to `prod` environment and use a different approach
2. **Option B**: Create a custom environment name (e.g., `"custom"`) and add it to the `Me` object via ASAR modification
3. **Option C**: Make the proxy handle ALL gateway paths, including authentication endpoints

## Problem: Model Cache Overwritten on Restart

### Symptoms
- Custom provider works after adding to `model_cache.json`
- But disappears after restarting Accio

### Root Cause
`model_cache.json` is synced from the server on startup. Local modifications are overwritten.

### Fix
The MITM proxy approach is more reliable because it intercepts requests at runtime, not at configuration time. Ensure the proxy is running before launching Accio.

## Verification Checklist

1. [ ] `dev.environment` set to `"offline"` in `~/.accio/settings.jsonc`
2. [ ] No process on port 7001 (kill if present)
3. [ ] MITM proxy running on port 7001
4. [ ] Custom provider added to `model_cache.json`
5. [ ] Proxy intercepts RLab requests (check logs for `[RLAB] Intercepted`)
6. [ ] Accio launched and connected to proxy
7. [ ] SDK logs show RLabRouter messages (check `~/.accio/logs/sdk.log`)
8. [ ] Model code in logs matches custom model (not default)
