const CACHE_NAME = "virtual-root-cache-v2";
const VIRTUAL_ROOT = "/virtual-root/";
const VIRTUAL_ROOT_BARE = VIRTUAL_ROOT.replace(/\/$/, "");
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

  if (pathname === VIRTUAL_ROOT_BARE || pathname === VIRTUAL_ROOT) {
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


function getDirectoryScope(pathname) {
  const normalized = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) return VIRTUAL_ROOT;
  return `${normalized.slice(0, slashIndex + 1)}`;
}

function injectPerPageRegistration(htmlText, resolvedPath) {
  const scopePath = getDirectoryScope(resolvedPath);
  const script = `
<script>(function(){if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{scope:${JSON.stringify(scopePath)}}).catch(function(){});}})();<\/script>
`;

  if (/<\/head>/i.test(htmlText)) {
    return htmlText.replace(/<\/head>/i, `${script}</head>`);
  }
  if (/<\/body>/i.test(htmlText)) {
    return htmlText.replace(/<\/body>/i, `${script}</body>`);
  }
  return `${htmlText}${script}`;
}

async function createTypedResponse(response, resolvedPath) {
  const headers = new Headers(response.headers);
  const mimeType = getMimeType(resolvedPath);
  headers.set("Content-Type", mimeType);
  headers.set("X-Virtual-Path", resolvedPath);

  if (/\.html?$/i.test(resolvedPath)) {
    const htmlText = await response.text();
    const injected = injectPerPageRegistration(htmlText, resolvedPath);
    return new Response(injected, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

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
  if (!(requestUrl.pathname === VIRTUAL_ROOT_BARE || requestUrl.pathname.startsWith(VIRTUAL_ROOT))) return;

  event.respondWith(fromVirtualRoot(event.request));
});
