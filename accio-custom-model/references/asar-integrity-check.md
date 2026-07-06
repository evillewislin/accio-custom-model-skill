# ASAR Integrity Check Failure

## Problem
Modifying `app.asar` causes Accio to crash on startup with:
```
[FATAL:asar_util.cc(144)] Integrity check failed for asar archive (XXXX vs YYYY)
```

## Root Cause
Accio ships with Electron's ASAR integrity checking enabled in the compiled C++ binary (`asar_util.cc`). The checksum embedded in Accio.exe is compared against the actual ASAR file hash. Any modification (even adding a single JSON provider) breaks the checksum.

## Why CLI Flags Don't Work
- `--disable-features=AsarIntegrityCheck` — does nothing. Accio's binary doesn't expose this as a toggleable feature.
- `--app=...` — still loads the default `app.asar` first for integrity check before falling back.
- No known Electron command-line flag bypasses this at the C++ level.

## Recovery Procedure
1. Restore original ASAR: `cp "D:/Accio/resources/app.asar.bak" "D:/Accio/resources/app.asar"`
2. Verify: `"D:/Accio/Accio.exe" --no-sandbox` should start without FATAL error
3. If ASAR modification is required, use Approach 2 (MITM Proxy) instead

## Detection
Sign that integrity check is active:
- Modified ASAR causes immediate crash (no UI appears)
- Console shows `FATAL:asar_util.cc(144)] Integrity check failed`
- Original ASAR restores to normal operation

## Implications for Model Injection
Approach 1 (modify model-catalog.json in ASAR) is **not viable** on Accio versions with integrity checking enabled. Fall back to:
- Approach 2: MITM Proxy intercepting `/api/tool/rlab/call`
- Approach 3: Environment variable `PHOENIX_ROUTING_TEST` (limited to built-in models only)
