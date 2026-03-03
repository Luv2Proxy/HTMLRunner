const CACHE_NAME = "virtual-root-cache-v2";
const VIRTUAL_ROOT = "/virtual-root/";
const META_PATH = `${VIRTUAL_ROOT}__virtual_root_meta__.json`;
const KEEPALIVE_PATH = `${VIRTUAL_ROOT}__sw_keepalive__`;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
};

function getMimeType(pathname) {
  const lower = pathname.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_TYPES[lower.slice(dot)] || "application/octet-stream";
}

function getLookupCandidates(pathname, entryPath) {
  const normalized = pathname.replace(/\/+$/, "");
  const candidates = new Set([pathname]);

  if (pathname === VIRTUAL_ROOT.slice(0, -1) || pathname === VIRTUAL_ROOT) {
    if (entryPath) candidates.add(`${VIRTUAL_ROOT}${entryPath}`);
    candidates.add(`${VIRTUAL_ROOT}index.html`);
  }

  if (pathname.endsWith("/")) {
    candidates.add(`${pathname}index.html`);
  }

  if (!/\.[a-z0-9]+$/i.test(normalized)) {
    candidates.add(`${normalized}/index.html`);
    candidates.add(`${pathname}/index.html`.replace(/\/+/g, "/"));
  }

  if (entryPath) {
    candidates.add(`${VIRTUAL_ROOT}${entryPath}`);
  }

  return [...candidates];
}

async function readMetadata(cache) {
  const response = await cache.match(META_PATH);
  if (!response) return { entry: null };

  try {
    const payload = await response.json();
    return { entry: payload?.entry || null };
  } catch {
    return { entry: null };
  }
}

async function createTypedResponse(response, resolvedPath) {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", getMimeType(resolvedPath));
  headers.set("X-Virtual-Path", resolvedPath);
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fromVirtualRoot(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);

  if (url.pathname === KEEPALIVE_PATH) {
    return new Response("ok", { status: 204 });
  }

  const { entry } = await readMetadata(cache);
  const candidates = getLookupCandidates(url.pathname, entry);

  for (const path of candidates) {
    const response = await cache.match(path);
    if (response) {
      return createTypedResponse(response, path);
    }
  }

  return new Response(`Not found in virtual root: ${url.pathname}`, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", () => {
  // Keep-alive messages are intentionally ignored; receiving them helps warm startup paths.
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (requestUrl.origin !== self.location.origin) return;
  if (!requestUrl.pathname.startsWith(VIRTUAL_ROOT)) return;

  event.respondWith(fromVirtualRoot(event.request));
});
