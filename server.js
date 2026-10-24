// =============================================================================
// MotionEyeGo Server
// Zero-dependency Node.js HTTP server for MotionEye camera streaming
// with Frigate NVR integration and MJPEG proxy support.
// =============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// =============================================================================
// Custom .env Reader
// Parses .env files without any external dependencies.
// Supports: comments (#), empty lines, single/double quoted values,
// multiline values (using \ continuation), and inline comments.
// =============================================================================

function loadEnv(envPath) {
  let content;
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[env] No .env file found at ${envPath}, using defaults/environment.`);
      return;
    }
    throw err;
  }

  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    let line = lines[i].trim();
    i++;

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Find the first '=' to split key and value
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue; // Not a valid KEY=VALUE line
    }

    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1);

    // Don't override variables already set in the real environment
    if (process.env[key] !== undefined) {
      continue;
    }

    // Trim leading whitespace from value
    value = value.trimStart();

    // Handle quoted values (single or double quotes)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      // Remove surrounding quotes
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith('"') || value.startsWith("'")) {
      // Multiline quoted value: accumulate lines until closing quote
      const quoteChar = value[0];
      let accumulated = value.substring(1); // Strip opening quote

      while (i < lines.length) {
        const nextLine = lines[i];
        i++;
        if (nextLine.trimEnd().endsWith(quoteChar)) {
          accumulated += '\n' + nextLine.trimEnd().slice(0, -1);
          break;
        } else {
          accumulated += '\n' + nextLine;
        }
      }
      value = accumulated;
    } else {
      // Unquoted value: handle backslash continuation for multiline
      while (value.endsWith('\\') && i < lines.length) {
        value = value.slice(0, -1); // Remove trailing backslash
        value += lines[i].trim();
        i++;
      }

      // Strip inline comments (only for unquoted values)
      // Be careful not to strip # inside URLs, so only strip if preceded by whitespace
      const commentMatch = value.match(/\s+#/);
      if (commentMatch) {
        value = value.substring(0, commentMatch.index);
      }

      value = value.trim();
    }

    process.env[key] = value;
  }
}

// Load .env from project root
loadEnv(path.join(__dirname, '.env'));

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FRIGATE_URL = process.env.FRIGATE_URL || 'http://localhost:5000';
const FRIGATE_ENABLED = (process.env.FRIGATE_ENABLED || 'false').toLowerCase() === 'true';

/**
 * Normalize and convert stream URLs intelligently.
 * Handles:
 * - Frigate Web UI URLs: http://host:port/#camera_name -> http://host:port/api/camera_name
 * - Frigate Web UI cameras route: http://host:port/cameras/camera_name -> http://host:port/api/camera_name
 * - MotionEye web URLs if passed with /picture/ or /#
 * - General trim and cleanup
 */
function normalizeStreamUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  let cleanUrl = rawUrl.trim();

  // Pattern 1: Frigate hash route, e.g., http://192.168.0.87:5000/#camera_1 or /#camera_1/
  // Turns into http://192.168.0.87:5000/api/camera_1
  const frigateHashMatch = cleanUrl.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^\/]+(?:\/.*?)?)\/#([a-zA-Z0-9_\-]+)\/?$/);
  if (frigateHashMatch) {
    const base = frigateHashMatch[1].replace(/\/+$/, '');
    const cameraName = frigateHashMatch[2];
    return `${base}/api/${cameraName}`;
  }

  // Pattern 3: MotionEye UI URLs, e.g. http://host:8765/#camera1 or /#1 -> convert to MotionEye streaming port/picture if needed
  // Note: MotionEye streaming URLs can be on any remote IP/hostname and port (e.g. :8081, :8082, etc.)
  const motionEyeHashMatch = cleanUrl.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^\/]+(?:\/.*?)?)\/#(?:camera_?)?(\d+)\/?$/i);
  if (motionEyeHashMatch) {
    const base = motionEyeHashMatch[1].replace(/\/+$/, '');
    const camId = motionEyeHashMatch[2];
    // MotionEye default snapshot/mjpeg route for camera ID: /picture/{id}/current or /camera/{id}/streaming
    // If not sure, preserve base with /picture/{id}/current
    return `${base}/picture/${camId}/current/`;
  }

  return cleanUrl;
}

/**
 * Parse the STREAMS environment variable into an array of {name, url} objects.
 * Format: NAME|URL,NAME|URL
 */
function parseStreams(streamsStr) {
  if (!streamsStr || !streamsStr.trim()) {
    return [];
  }

  return streamsStr.split(',').reduce((acc, entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return acc;

    const pipeIndex = trimmed.indexOf('|');
    if (pipeIndex === -1) {
      // No name provided, generate one
      const urlConverted = normalizeStreamUrl(trimmed);
      acc.push({ name: `Camera${acc.length + 1}`, url: urlConverted });
    } else {
      const name = trimmed.substring(0, pipeIndex).trim();
      const rawUrl = trimmed.substring(pipeIndex + 1).trim();
      const urlConverted = normalizeStreamUrl(rawUrl);
      acc.push({
        name: name,
        url: urlConverted,
      });
    }
    return acc;
  }, []);
}

const STREAMS = parseStreams(process.env.STREAMS);

// =============================================================================
// MIME Type Map
// =============================================================================

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Set CORS headers on every response.
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Send a JSON response.
 */
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Send a plain-text error response.
 */
function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

/**
 * Serve a static file from the public/ directory.
 */
function serveStaticFile(res, reqPath) {
  // Default to index.html for root path
  let filePath = reqPath === '/' ? '/index.html' : reqPath;

  // Resolve to the public directory and prevent directory traversal
  const publicDir = path.join(__dirname, 'public');
  const fullPath = path.normalize(path.join(publicDir, filePath));

  if (!fullPath.startsWith(publicDir)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendError(res, 404, 'Not Found');
      } else {
        console.error(`[static] Error reading ${fullPath}:`, err.message);
        sendError(res, 500, 'Internal Server Error');
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  });
}

// =============================================================================
// API Handlers
// =============================================================================

/**
 * GET /api/config
 * Returns sanitized application configuration (no passwords).
 */
function handleGetConfig(req, res) {
  const config = {
    streams: STREAMS.map((s) => ({ name: s.name })),
    streamCount: STREAMS.length,
    frigate: {
      enabled: FRIGATE_ENABLED,
      url: FRIGATE_ENABLED ? FRIGATE_URL : null,
    },
    motionEye: {
      url: process.env.MOTIONEYE_URL || null,
      username: process.env.MOTIONEYE_USERNAME || null,
      // Password intentionally omitted for security
    },
  };
  sendJson(res, 200, config);
}

/**
 * GET /api/streams
 * Returns the array of stream objects with proxy URLs instead of raw URLs.
 */
function handleGetStreams(req, res) {
  const streams = STREAMS.map((s, index) => ({
    name: s.name,
    url: `/api/proxy/stream/${index}`,
  }));
  sendJson(res, 200, streams);
}

/**
 * GET /api/proxy/stream/:index
 * Proxies an MJPEG stream to the client to avoid CORS issues.
 * Reads the stream index from the URL and pipes the upstream response.
 */
function handleProxyStream(req, res, streamIndex) {
  const index = parseInt(streamIndex, 10);

  if (isNaN(index) || index < 0 || index >= STREAMS.length) {
    sendError(res, 404, `Stream index ${streamIndex} not found. Available: 0-${STREAMS.length - 1}`);
    return;
  }

  const stream = STREAMS[index];
  const streamUrl = stream.url;

  console.log(`[proxy] Connecting to stream: ${stream.name} (${streamUrl})`);

  let clientLib = http;
  try {
    const parsed = new URL(streamUrl);
    if (parsed.protocol === 'https:') {
      clientLib = https;
    }
  } catch (e) {
    if (streamUrl.startsWith('https:')) clientLib = https;
  }

  const proxyReq = clientLib.get(streamUrl, (proxyRes) => {
    // Copy the content-type header (typically multipart/x-mixed-replace)
    const contentType = proxyRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=myboundary';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Pipe the upstream MJPEG stream directly to the client
    proxyRes.pipe(res);

    // Handle upstream stream ending
    proxyRes.on('end', () => {
      console.log(`[proxy] Stream ended: ${stream.name}`);
      res.end();
    });

    proxyRes.on('error', (err) => {
      console.error(`[proxy] Upstream stream error for ${stream.name}:`, err.message);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Failed to connect to ${stream.name} (${streamUrl}):`, err.message);
    if (!res.headersSent) {
      sendError(res, 502, `Failed to connect to stream: ${err.message}`);
    } else {
      res.end();
    }
  });

  // If the client disconnects, abort the upstream request
  req.on('close', () => {
    proxyReq.destroy();
  });
}

/**
 * GET /api/frigate/*
 * Proxies requests to the Frigate NVR server.
 * Forwards the path after /api/frigate/ to FRIGATE_URL.
 */
function handleFrigateProxy(req, res, frigatePath) {
  if (!FRIGATE_ENABLED) {
    sendError(res, 503, 'Frigate NVR integration is not enabled');
    return;
  }

  // Build the target URL: FRIGATE_URL + /api/ + remaining path
  const targetUrl = `${FRIGATE_URL}/api/${frigatePath}`;

  console.log(`[frigate] Proxying request to: ${targetUrl}`);

  let clientLib = http;
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol === 'https:') {
      clientLib = https;
    }
  } catch (e) {
    if (targetUrl.startsWith('https:')) clientLib = https;
  }

  const parsedTarget = url.parse(targetUrl);

  const options = {
    hostname: parsedTarget.hostname,
    port: parsedTarget.port,
    path: parsedTarget.path,
    method: 'GET',
    headers: {
      'Accept': req.headers['accept'] || 'application/json',
    },
  };

  const proxyReq = clientLib.request(options, (proxyRes) => {
    // Forward the status code and relevant headers
    const headers = {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
    };

    if (proxyRes.headers['content-length']) {
      headers['Content-Length'] = proxyRes.headers['content-length'];
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.error(`[frigate] Upstream response error:`, err.message);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[frigate] Failed to connect to Frigate (${targetUrl}):`, err.message);
    if (!res.headersSent) {
      sendError(res, 502, `Failed to connect to Frigate NVR: ${err.message}`);
    } else {
      res.end();
    }
  });

  proxyReq.end();

  // If the client disconnects, abort the upstream request
  req.on('close', () => {
    proxyReq.destroy();
  });
}

// =============================================================================
// Request Router
// =============================================================================

/**
 * Main request handler. Routes requests to the appropriate handler.
 */
function handleRequest(req, res) {
  // Set CORS headers on every response
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --- API Routes ---

  // GET /api/config
  if (req.method === 'GET' && pathname === '/api/config') {
    handleGetConfig(req, res);
    return;
  }

  // GET /api/streams
  if (req.method === 'GET' && pathname === '/api/streams') {
    handleGetStreams(req, res);
    return;
  }

  // GET /api/proxy/stream/:index
  const streamProxyMatch = pathname.match(/^\/api\/proxy\/stream\/(\d+)$/);
  if (req.method === 'GET' && streamProxyMatch) {
    handleProxyStream(req, res, streamProxyMatch[1]);
    return;
  }

  // GET /api/frigate/*
  const frigateMatch = pathname.match(/^\/api\/frigate\/(.*)$/);
  if (req.method === 'GET' && frigateMatch) {
    const frigatePath = frigateMatch[1] || '';
    handleFrigateProxy(req, res, frigatePath);
    return;
  }

  // --- Static File Serving ---
  if (req.method === 'GET') {
    serveStaticFile(res, pathname);
    return;
  }

  // --- Fallback: Method Not Allowed ---
  sendError(res, 405, 'Method Not Allowed');
}

// =============================================================================
// Server Startup
// =============================================================================

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('  MotionEyeGo Server');
  console.log('='.repeat(60));
  console.log(`  Listening on:    http://${HOST}:${PORT}`);
  console.log(`  Streams:         ${STREAMS.length} configured`);
  STREAMS.forEach((s, i) => {
    console.log(`    [${i}] ${s.name} -> ${s.url}`);
  });
  console.log(`  Frigate NVR:     ${FRIGATE_ENABLED ? 'ENABLED (' + FRIGATE_URL + ')' : 'disabled'}`);
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Shutting down gracefully...');
  server.close(() => {
    console.log('[server] Closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[server] Received SIGTERM, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
