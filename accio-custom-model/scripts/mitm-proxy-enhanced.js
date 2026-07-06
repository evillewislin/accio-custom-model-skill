#!/usr/bin/env node
/**
 * Enhanced Accio MITM Proxy for Custom Model Injection
 * 
 * This proxy:
 * 1. Intercepts RLab model routing requests and returns agnes-ai modelCode
 * 2. Intercepts LLM API calls and routes them to agnes-ai
 * 3. Forwards all other requests to the real gateway
 * 
 * ACCIO VERSION: 0.20.0 (tested 2026-07-06)
 * 
 * SETUP:
 * 1. Change ~/.accio/settings.jsonc dev.environment = "offline"
 * 2. Kill any process on port 7001: powershell -Command "Stop-Process -Id <PID> -Force"
 * 3. Start this proxy: node scripts/mitm-proxy-enhanced.js
 * 4. Launch Accio
 * 
 * KNOWN ISSUES (v2026-07-06):
 * - SSL error when forwarding to real gateway: "self-signed certificate in certificate chain"
 *   This happens because Accio's offline mode uses a local Spring Boot gateway with self-signed certs.
 *   The proxy forwards non-intercepted requests to phoenix-gw.alibaba.com which may fail.
 * - Accio's MCP connection to agnes-ai fails because it uses wrong URL path:
 *   Accio tries POST /v1 but agnes-ai expects POST /v1/chat/completions
 *   This is a client-side configuration issue, not a proxy issue.
 * 
 * WORKFLOW:
 * 1. Proxy intercepts RLab model_routing → returns "1Agnes-F4sH2aS8qJ5v"
 * 2. Accio looks up modelCode in model_cache.json → finds agnes-ai provider
 * 3. Accio attempts MCP connection to apihub.agnes-ai.com/v1 → FAILS (wrong path)
 * 
 * FIX FOR MCP PATH ISSUE:
 * - Modify Accio's model_cache.json to include correct baseUrl for agnes-ai
 * - OR use a local API gateway that rewrites /v1 to /v1/chat/completions
 * 
 * TO REVERT:
 * 1. Change dev.environment back to "prod" in settings.jsonc
 * 2. Kill the proxy
 * 3. Restart Accio
 */

const http = require('http');
const https = require('https');

const LISTEN_PORT = 7001;
const REAL_GATEWAY_HOST = 'phoenix-gw.alibaba.com';
const REAL_GATEWAY_PORT = 443;
const AGNES_AI_HOST = 'apihub.agnes-ai.com';
const AGNES_AI_PORT = 443;

// Custom model mapping
const CUSTOM_MODELS = {
  '1Agnes-F4sH2aS8qJ5v': {
    displayName: 'Agnes-2.0-Flash',
    provider: 'agnes-ai',
    modelName: 'agnes-2.0-flash',
    apiPath: '/v1/chat/completions',
  },
};

// Default model to return for model_routing
const DEFAULT_MODEL_CODE = '1Agnes-F4sH2aS8qJ5v';

// Track which models are being requested
const REQUESTED_MODELS = new Set();

function forwardToRealGateway(req, res) {
  const options = {
    hostname: REAL_GATEWAY_HOST,
    port: REAL_GATEWAY_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };
  
  // Remove hop-by-hop headers
  delete options.headers['host'];
  delete options.headers['connection'];
  options.headers['host'] = REAL_GATEWAY_HOST;
  options.headers['accept-encoding'] = 'gzip, deflate';
  
  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (err) => {
    console.error(`[MITM] Forward to real gateway error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'Bad Gateway', message: err.message}));
    }
  });
  
  req.pipe(proxyReq);
}

function forwardToAgnesAI(req, res) {
  const url = new URL(req.url, `http://localhost:${LISTEN_PORT}`);
  const path = url.pathname + url.search;
  
  const options = {
    hostname: AGNES_AI_HOST,
    port: AGNES_AI_PORT,
    path: path,
    method: req.method,
    headers: { ...req.headers },
  };
  
  // Remove hop-by-hop headers
  delete options.headers['host'];
  delete options.headers['connection'];
  options.headers['host'] = AGNES_AI_HOST;
  options.headers['accept-encoding'] = 'gzip, deflate';
  
  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (err) => {
    console.error(`[MITM] Forward to Agnes AI error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'Bad Gateway', message: err.message}));
    }
  });
  
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${LISTEN_PORT}`);
  const path = url.pathname;
  
  // Intercept RLab model routing
  if (path === '/api/tool/rlab/call' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const postData = JSON.parse(body);
        
        console.log(`[RLAB] Intercepted: function=${postData.function}`);
        
        if (postData.function === 'model_routing') {
          // Return our custom model
          const response = {
            data: {
              modelCode: DEFAULT_MODEL_CODE,
              reason: 'mitm_proxy_custom_model',
              shouldCompact: false,
            },
          };
          
          console.log(`[RLAB] Returning custom model: ${DEFAULT_MODEL_CODE}`);
          REQUESTED_MODELS.add(DEFAULT_MODEL_CODE);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
          return;
        }
      } catch (e) {
        console.error(`[RLAB] Error parsing request: ${e.message}`);
      }
      
      // For non-intercepted RLab calls, forward to real gateway
      console.log(`[RLAB] Forwarding: ${path}`);
      forwardToRealGateway(req, res);
      return;
    });
    return;
  }
  
  // Intercept LLM API calls for agnes-ai models
  if (path === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const postData = JSON.parse(body);
        
        // Check if this is for agnes-ai model
        if (postData.model === 'agnes-2.0-flash' || postData.model === DEFAULT_MODEL_CODE) {
          console.log(`[LLM] Intercepted agnes-ai request: model=${postData.model}`);
          forwardToAgnesAI(req, res);
          return;
        }
      } catch (e) {
        console.error(`[LLM] Error parsing request: ${e.message}`);
      }
      
      // For non-intercepted LLM calls, forward to real gateway
      console.log(`[LLM] Forwarding: ${path}`);
      forwardToRealGateway(req, res);
      return;
    });
    return;
  }
  
  // For all other requests, forward to real gateway
  forwardToRealGateway(req, res);
});

server.on('error', (err) => {
  console.error(`[MITM] Server error: ${err.message}`);
});

// Print summary on shutdown
process.on('SIGINT', () => {
  console.log('\n[MITM] Shutting down...');
  console.log(`[MITM] Models requested: ${Array.from(REQUESTED_MODELS).join(', ') || 'none'}`);
  server.close(() => process.exit(0));
});

server.listen(LISTEN_PORT, () => {
  console.log(`========================================`);
  console.log(`  Accio RLab Proxy Running`);
  console.log(`  Listening on: http://localhost:${LISTEN_PORT}`);
  console.log(`  Forwarding to: ${REAL_GATEWAY_HOST}:${REAL_GATEWAY_PORT}`);
  console.log(`  Custom model: ${DEFAULT_MODEL_CODE} (Agnes-2.0-Flash)`);
  console.log(`========================================`);
  console.log();
  console.log(`Instructions:`);
  console.log(`1. Set ~/.accio/settings.jsonc dev.environment = "offline"`);
  console.log(`2. Start this proxy: node mitm-proxy-enhanced.js`);
  console.log(`3. Start Accio Work`);
  console.log(`4. The proxy intercepts /api/tool/rlab/call and returns Agnes-2.0-Flash`);
  console.log(`5. All other requests are forwarded to the real gateway`);
  console.log();
  console.log(`To stop: Ctrl+C`);
});
