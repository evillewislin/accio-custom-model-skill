---
name: accio-custom-model
description: "Configure Accio desktop app to use custom OpenAI-compatible models (e.g., agnes-2.0-flash) via MITM proxy interception, environment variable forcing, or ASAR modification (when integrity check is absent)."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [accio, model-routing, desktop-app, configuration, hijacking]
---

# Accio Custom Model Configuration

This skill covers configuring the Accio desktop app (by Alibaba) to use custom OpenAI-compatible models like `agnes-2.0-flash` via `https://apihub.agnes-ai.com/v1`.

## Important: Accio's Model Routing Architecture

Accio uses a **server-controlled model routing system** — the `agent.json` file's `model` fields are **NOT used** for provider selection. The model is determined by:

1. `model_cache.json` — synced from server on startup, contains internal `modelCode`s
2. `model-catalog.json` — bundled in the Electron ASAR, defines available models
3. RLab model router — calls `${gatewayBaseUrl}/api/tool/rlab/call` with `{function:"model_routing", ...}` to get the modelCode from the server

## Approach 1: Modify model-catalog.json (⚠️ Often Broken — See Critical Warning Below)

### ⚠️ CRITICAL WARNING: ASAR Integrity Check Fatal Crash

Many Accio versions ship with **Electron ASAR integrity checking enabled** in the compiled binary. When the ASAR hash doesn't match the embedded checksum, Accio crashes immediately with:

```
[FATAL:asar_util.cc(144)] Integrity check failed for asar archive (XXXX vs YYYY)
```

**This is a Chromium/Electron C++ level check — it cannot be bypassed with CLI flags** (`--disable-features=AsarIntegrityCheck` does nothing because Accio's binary doesn't expose that feature toggle).

**Symptom:** After replacing `app.asar` with a modified version, Accio.exe launches and exits immediately with no UI. Console shows the FATAL error above.

**Fix:** Restore the original ASAR from backup:
```bash
cp "D:/Accio/resources/app.asar.bak" "D:/Accio/resources/app.asar"
```

Verify recovery by launching with `--no-sandbox` (which suppresses the sandbox warning but not the integrity check):
```bash
"D:/Accio/Accio.exe" --no-sandbox
```
If Accio starts without the FATAL error, the integrity check is passing.

**Implication:** If Approach 1 fails due to integrity checking, fall through to Approach 2 (MITM Proxy) or Approach 3 (Env Var). Do NOT keep trying to modify the ASAR — it will always crash.

---

### Step 1: Extract the ASAR bundle

**CRITICAL: Never use the `asar` CLI on Windows** — it fails with "too many arguments" or path escape errors. Always use the Node.js API.

Install globally first:
```bash
npm install -g @electron/asar
```

Use the Node.js API (paths from `listPackage()` have leading `\\`):

```javascript
const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const fs = require('fs');
const path = require('path');

const archivePath = 'D:/Accio/resources/app.asar';
const outDir = 'D:/Accio/resources/app_extracted';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const allFiles = asar.listPackage(archivePath);
for (const file of allFiles) {
  const cleanPath = file.replace(/^\\\\/, '');  // strip leading backslash
  const outPath = path.join(outDir, cleanPath);
  const outDir2 = path.dirname(outPath);
  if (!fs.existsSync(outDir2)) {
    fs.mkdirSync(outDir2, { recursive: true });
  }
  const content = asar.extractFile(archivePath, '/' + cleanPath);
  fs.writeFileSync(outPath, content);
}
console.log('Extraction complete');
```

See `references/accio-internal-architecture.md` for detailed path handling notes.

### CRITICAL: Two model-catalog.json files exist in the ASAR

The ASAR contains TWO copies of model-catalog.json:
- `model-catalog.json` (root level)
- `node_modules/@ali/accio-adk-ts/model-catalog.json`

**Accio reads the one in `node_modules/@ali/accio-adk-ts/`.** When modifying, you MUST update the file in the `node_modules/@ali/accio-adk-ts/` directory inside the extracted folder. Simply modifying the root-level copy will NOT work.

After adding your provider, copy the modified file to BOTH locations to be safe:
```bash
cp "D:/Accio/resources/app_extracted/model-catalog.json" "D:/Accio/resources/app_extracted/node_modules/@ali/accio-adk-ts/model-catalog.json"
```

Then repack.

### Step 2: Add custom provider to model-catalog.json

Add a new provider entry to the catalog:

```json
{
  "provider": "agnes-ai",
  "providerDisplayName": "Agnes AI",
  "modelList": [{
    "modelDisplayName": "Agnes-2.0-Flash",
    "modelName": "agnes-2.0-flash",
    "modelCode": "1Agnes-F4sH2aS8qJ5v",
    "group": "custom",
    "multimodal": true,
    "visible": true,
    "reasoningEfforts": ["low"],
    "defaultReasoningEffort": "low",
    "contextWindow": 1000000,
    "isDefault": false
  }]
}
```

### Step 3: Repack the ASAR

**NEVER use the `asar` CLI for repacking on Windows** — it fails with argument parsing errors. Always use the Node.js API.

Create a repack script (e.g., `repack-asar.js`):

```javascript
const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const fs = require('fs');

const sourceDir = 'D:/Accio/resources/app_extracted';
const destPath = 'D:/Accio/resources/app_modified.asar';

// createPackage is ASYNC — use callback
asar.createPackage(sourceDir, destPath, function(err) {
  if (err) {
    console.log('Error:', err);
  } else {
    console.log('Packaged successfully to ' + destPath);
  }
});
```

Then run:
```bash
"C:/Program Files/nodejs/node.exe" D:/Accio/repack-asar.js
```

### Step 4: Verify the modified ASAR

Before replacing the original, verify the modified ASAR contains your changes:

```javascript
const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const archivePath = 'D:/Accio/resources/app_modified.asar';
const files = asar.listPackage(archivePath);

// Check for catalog file
const catalogFiles = files.filter(f => f.includes('model-catalog'));
console.log('Catalog files:', catalogFiles);

// Extract and parse — paths from listPackage() have leading \\
// strip it and prepend /
const cleanPath = catalogFiles[0].replace(/^\\\\/, '');
const content = asar.extractFile(archivePath, '/' + cleanPath);
const catalog = JSON.parse(content);
const hasAgnes = catalog.some(p => p.provider === 'agnes-ai');
console.log('Contains agnes-ai:', hasAgnes);
```

### Step 5: Replace the original ASAR

Backup first, then replace:
```bash
copy "D:/Accio/resources/app.asar" "D:/Accio/resources/app.asar.bak"
copy "D:/Accio/resources/app_modified.asar" "D:/Accio/resources/app.asar"
```

Then restart Accio.

### Restarting Accio

**Do NOT use `kill` or `taskkill` from the git-bash terminal** — these are Linux/Windows commands that may fail depending on the shell. The safest approach is to:

1. Open Windows Task Manager (Ctrl+Shift+Esc)
2. Find all Accio processes (Accio.exe, Accio Renderer, etc.)
3. End them manually
4. Launch Accio normally

Alternatively, use PowerShell (not git-bash):
```powershell
Start-Process powershell -ArgumentList "taskkill /F /IM Accio.exe" -Verb RunAs
```

## Approach 2: MITM Proxy via settings.jsonc (Primary Viable Method)

**This is the recommended approach since modifying app.asar triggers Electron integrity check crash.**

### How it works

Accio determines its gateway URL from `~/.accio/settings.jsonc`:
- `dev.environment: "prod"` → `https://phoenix-gw.alibaba.com`
- `dev.environment: "offline"` → `http://localhost:7001`

By setting `dev.environment` to `"offline"` and running a local proxy on port 7001, we intercept RLab model routing requests and return agnes-ai model codes.

### Step 1: Modify settings.jsonc

Change `dev.environment` from `"prod"` to `"offline"` in `~/.accio/settings.jsonc`:
```jsonc
{
  "dev": {
    "environment": "offline",
    ...
  }
}
```

### Step 2: Run MITM Proxy on port 7001

The proxy script at `scripts/mitm-proxy.js` intercepts `/api/tool/rlab/call` POST requests and returns a custom modelCode. All other requests are forwarded to `phoenix-gw.alibaba.com:443`.

```bash
node D:/Accio/mitm-proxy.js
```

The proxy outputs:
```
Accio RLab Proxy Running
Listening on: http://localhost:7001
Forwarding to: phoenix-gw.alibaba.com:443
Custom model: 1Agnes-F4sH2aS8qJ5v (Agnes-2.0-Flash)
```

### Step 3: Start Accio

Launch Accio normally. It will connect to `localhost:7001` (your proxy) instead of the real gateway.

### Key Implementation Notes

- **Port conflict**: `localhost:7001` is the default offline gateway port. If Accio's built-in Spring Boot gateway is also running on 7001, stop it first.
- **Proxy must forward non-RLab requests**: The proxy only intercepts `/api/tool/rlab/call`. Everything else goes to the real gateway.
- **Test the proxy**: `curl -X POST http://localhost:7001/api/tool/rlab/call -H "Content-Type: application/json" -d '{"function":"model_routing","payload":{},"token":"test"}'` should return `{"data":{"modelCode":"1Agnes-F4sH2aS8qJ5v",...}}`
- **To revert**: Change `dev.environment` back to `"prod"` in settings.jsonc and kill the proxy.

### Known Issue: Offline Mode May Have Side Effects

The `offline` environment also changes `loginBaseUrl` to `https://pre-www.accio.com` and may affect other API endpoints. If you encounter login/account issues, consider:

1. **Using a different port** — e.g., set `dev.environment` to a custom value and modify the environment lookup function (requires ASAR modification, see Approach 1)
2. **Running a full local gateway** — instead of just a proxy, run a complete local gateway that mimics phoenix-gw.alibaba.com
3. **Reverting to prod** — if the offline mode causes more problems than it solves

### Environment Resolution Chain

```
settings.jsonc.dev.environment → et() → Re(env) → Me[env] → gatewayBaseUrl
```

Key functions from `D:/Accio/resources/app_extracted/out/main/index.js`:

- `et()` returns `He().dev?.environment ?? "prod"` (reads from settings.jsonc)
- `Re(e)` returns `Me[e] ?? Me.prod` (environment config lookup)
- `Cs()` returns `ws.gatewayBaseUrl` (current gateway URL)
- `xs(e)` sets `bs=e, ws=Re(e), Ss.updateBaseUrl(ws.gatewayBaseUrl)` (runtime env switch)

The `Me` object defines three environments:
- `offline`: `gatewayBaseUrl: "http://localhost:7001"`, `loginBaseUrl: "https://pre-www.accio.com"`
- `prod`: `gatewayBaseUrl: "https://phoenix-gw.alibaba.com"`, `loginBaseUrl: "https://www.accio.com"`
- `pre`: `gatewayBaseUrl: "https://pre-phoenix-gw.alibaba-inc.com"`, `et: "https://www.accio-ai.com/work"`

Setting `dev.environment` to `"offline"` redirects all API traffic to localhost:7001.

### ⚠️ Port 7001 Conflict — Kill Conflicting Process First

The `offline` environment points to `localhost:7001`. On some systems, Accio's built-in Spring Boot gateway also binds to port 7001. **Steps to resolve:**

1. Check what's on port 7001: `netstat -ano | findstr :7001`
2. Kill the conflicting process: `powershell -Command "Stop-Process -Id <PID> -Force"` (use PowerShell, NOT `taskkill` from git-bash — it may fail with encoding errors)
3. Start your MITM proxy on port 7001
4. Verify: `curl -s http://localhost:7001/test` — should return your proxy's response

### ⚠️ Offline Mode Side Effects

The `offline` environment also changes `loginBaseUrl` to `https://pre-www.accio.com` and may affect authentication, heartbeat checks, and other API endpoints. If you encounter login/account issues:

1. **Option A**: Revert `dev.environment` to `"prod"` and use a different approach
2. **Option B**: Use a custom environment name not in `Me` (e.g., `"custom"`) — but this requires ASAR modification to add the new entry
3. **Option C**: Make the proxy handle ALL gateway paths, not just `/api/tool/rlab/call`

### ⚠️ Proxy-Only-Intercepts-RLab Pitfall — model_cache.json Must Be Updated

The MITM proxy only intercepts `/api/tool/rlab/call`. All other requests (heartbeat, channels, etc.) are forwarded to `phoenix-gw.alibaba.com`. **However, returning a custom modelCode from RLab does NOT guarantee Accio will use it.** The modelCode must:

1. Exist in `model_cache.json` under a valid provider
2. Match the provider's expected format

**Fix**: Always add the custom provider to `~/.accio/model_cache.json` BEFORE testing. Use the script at `scripts/add-model-to-cache.js` to safely append providers.

### Full Workflow (Updated 2026-07-03)

```
1. Kill any process on port 7001 (check with netstat, kill with PowerShell Stop-Process)
2. Set dev.environment = "offline" in settings.jsonc
3. Add custom provider to model_cache.json
4. Start MITM proxy on port 7001
5. Launch Accio
6. Verify: check SDK logs for RLabRouter messages
7. If model still defaults to Gemini: the proxy is not intercepting — check if Accio cached the modelCode
```


## Approach 3: Environment Variable Hack (Limited)

Set `PHOENIX_ROUTING_TEST=true` to force a specific modelCode:

```bash
# On Windows
set PHOENIX_ROUTING_TEST=true
# Then start Accio

# Or permanently in system environment variables
```

This forces Accio to use `1Nexus-R3wF8qJ5vB6h` (Gemini 3 Flash). However, this **does not** redirect to agnes-ai — it only fixes the model selection.

## Troubleshooting

### ASAR integrity check crash (FATAL:asar_util.cc)

**Symptom:** Accio.exe launches and exits immediately. Console shows:
```
[FATAL:asar_util.cc(144)] Integrity check failed for asar archive (XXXX vs YYYY)
```

**Cause:** `app.asar` was modified (hash mismatch with embedded checksum). This is a Chromium/Electron C++ level check — cannot be bypassed with CLI flags.

**Fix:**
1. Restore original ASAR: `cp "D:/Accio/resources/app.asar.bak" "D:/Accio/resources/app.asar"`
2. Verify: `"D:/Accio/Accio.exe" --no-sandbox` — should start without FATAL error
3. Fall back to Approach 2 (MITM Proxy) or Approach 3 (Env Var) for model injection

**Never try `--disable-features=AsarIntegrityCheck`** — Accio's binary doesn't expose that toggle.

### Permission Denied when modifying files in D:/Accio/

Run the extraction/repak scripts from a directory where you have write access (e.g., `D:/Accio/` or `C:/Users/guyin/`).

### ASAR path format gotcha

`asar.listPackage()` returns paths with **leading double-backslash** (e.g., `\\node_modules\\@ali\\accio-adk-ts\\model-catalog.json`). This is an asar quirk on Windows.

- For `extractFile()`: strip the leading `\\` and prepend `/` → `/node_modules/@ali/accio-adk-ts/model-catalog.json`
- For `createPackage()` / `createPackageFromFiles()`: use forward slashes with the source directory path
- When verifying: **prefer `extractAll()` to a temp directory**, then read files with normal `fs.readFileSync()` — this avoids all path-format headaches

This is almost always a **path format mismatch**. `listPackage()` returns paths with leading `\\` (e.g., `\\node_modules\\@ali\\accio-adk-ts\\model-catalog.json`), but `extractFile()` needs a path prefixed with `/` and WITHOUT the leading `\\`:

```javascript
const files = asar.listPackage(archivePath);
const catalogFile = files.find(f => f.includes('model-catalog'));
// catalogFile = '\\node_modules\\@ali\\accio-adk-ts\\model-catalog.json'
const cleanPath = catalogFile.replace(/^\\\\/, '');  // strip leading \\
const content = asar.extractFile(archivePath, '/' + cleanPath);  // prepend /
```

Also: `asar.createPackage()` is **ASYNC** — it uses a callback. There is NO `createPackageSync()`. If your repack script exits without error but produces no file, you likely called a non-existent sync variant.

### Model still not visible after modification

1. Clear Accio's cache: delete `C:/Users/guyin/.accio/model_cache.json`
2. Restart Accio
3. Check that the modified `model-catalog.json` is correctly packed into the ASAR

### API connectivity test

```bash
curl -H "Authorization: Bearer YOUR_KEY" https://apihub.agnes-ai.com/v1/models
```

## Files Referenced

- `references/accio-internal-architecture.md` — Detailed analysis of Accio's internal architecture
- `references/asar-integrity-check.md` — ASAR integrity check failure: symptoms, root cause, recovery, implications
- `references/mitm-proxy-troubleshooting.md` — Common issues and fixes when using MITM proxy to inject custom models into Accio
- `scripts/mitm-proxy.js` — Legacy MITM proxy (intercepts only RLab routing). See `scripts/mitm-proxy-enhanced.js` for the enhanced version that also intercepts LLM API calls.
- `scripts/mitm-proxy-enhanced.js` — Enhanced MITM proxy (v2). Listens on port 7001, intercepts `/api/tool/rlab/call` for model routing AND `/v1/chat/completions` for LLM API calls. Forwards all other requests to phoenix-gw.alibaba.com:443.
- `scripts/add-model-to-cache.js` — Safely adds/updates custom providers in `~/.accio/model_cache.json`. Usage: `node add-model-to-cache.js --provider NAME --display DISPLAY_NAME --model MODEL_CODE --model-name MODEL_NAME`
