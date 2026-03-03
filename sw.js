const CACHE_NAME = "virtual-root-cache-v1";
const VIRTUAL_ROOT = "/virtual-root/";

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

function possiblePaths(pathname) {
  const normalized = pathname.replace(/\/+$/, "");
  const candidates = new Set([pathname]);

  if (pathname.endsWith("/")) {
    candidates.add(`${pathname}index.html`);
  }

  if (!/\.[a-z0-9]+$/i.test(normalized)) {
    candidates.add(`${normalized}/index.html`);
    candidates.add(`${pathname}/index.html`.replace(/\/+/g, "/"));
  }

  return [...candidates];
}

async function fromVirtualRoot(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  const lookupPaths = possiblePaths(url.pathname);

  for (const path of lookupPaths) {
    const response = await cache.match(path);
    if (!response) continue;

    const headers = new Headers(response.headers);
    headers.set("Content-Type", getMimeType(path));
    headers.set("X-Virtual-Path", path);

    return new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
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

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (event.request.method !== "GET") return;
  if (requestUrl.origin !== self.location.origin) return;
  if (!requestUrl.pathname.startsWith(VIRTUAL_ROOT)) return;

  event.respondWith(fromVirtualRoot(event.request));
});
