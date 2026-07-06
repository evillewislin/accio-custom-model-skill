#!/usr/bin/env node
/**
 * Accio MITM Proxy for Custom Model Injection
 * 
 * Intercepts Accio's RLB routing requests and returns agnes-ai model codes.
 * 
 * Setup:
 * 1. Change ~/.accio/settings.jsonc dev.environment to "offline"
 * 2. Kill any process on port 7001 (netstat -ano | findstr :7001, then powershell -Command "Stop-Process -Id <PID> -Force")
 * 3. Start this proxy: node mitm-proxy.js
 * 4. Launch Accio
 * 
 * The proxy intercepts /api/tool/rlab/call POST requests and returns a custom modelCode.
 * All other requests are forwarded to phoenix-gw.alibaba.com:443.
 * 
 * To revert: Change dev.environment back to "prod" in settings.jsonc and kill the proxy.
 */

const http = require('http');
const https = require('https');

const LISTEN_PORT = 7001;
const REAL_GATEWAY_HOST = 'phoenix-gw.alibaba.com';
const REAL_GATEWAY_PORT = 443;

// Custom model to return for model_routing
const CUSTOM_MODEL_CODE = '1Agnes-F4sH2aS8qJ5v';

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
        
        if (postData.function === 'model_routing') {
          console.log(`[RLAB] Intercepted model_routing, returning: ${CUSTOM_MODEL_CODE}`);
          const response = {
            data: {
              modelCode: CUSTOM_MODEL_CODE,
              reason: 'mitm_proxy_custom_model',
              shouldCompact: false,
            },
          };
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
          return;
        }
      } catch (e) {
        console.error(`[RLAB] Error parsing request: ${e.message}`);
      }
      
      // For non-intercepted RLab calls, forward to real gateway
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
  if (err.code === 'EADDRINUSE') {
    console.error('[MITM] Port 7001 is already in use. Kill the conflicting process first.');
    console.error('[MITM] Run: powershell -Command "Get-NetTCPConnection -LocalPort 7001 | Stop-Process -Force"');
  }
});

server.listen(LISTEN_PORT, () => {
  console.log(`========================================`);
  console.log(`  Accio MITM Proxy Running`);
  console.log(`  Listening on: http://localhost:${LISTEN_PORT}`);
  console.log(`  Forwarding to: ${REAL_GATEWAY_HOST}:${REAL_GATEWAY_PORT}`);
  console.log(`  Custom model: ${CUSTOM_MODEL_CODE}`);
  console.log(`========================================`);
  console.log();
  console.log(`Instructions:`);
  console.log(`1. Set ~/.accio/settings.jsonc dev.environment = "offline"`);
  console.log(`2. Kill any process on port 7001`);
  console.log(`3. Start this proxy: node mitm-proxy.js`);
  console.log(`4. Start Accio Work`);
  console.log(`5. The proxy intercepts /api/tool/rlab/call and returns the custom model`);
  console.log(`6. All other requests are forwarded to the real gateway`);
  console.log();
  console.log(`To revert: Change dev.environment back to "prod" in settings.jsonc`);
  console.log(`To stop: Ctrl+C`);
});
