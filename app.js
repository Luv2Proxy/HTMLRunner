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

const zipInput = document.querySelector("#zipInput");
const extractBtn = document.querySelector("#extractBtn");
const clearBtn = document.querySelector("#clearBtn");
const statusNode = document.querySelector("#status");
const entryLink = document.querySelector("#entryLink");
const fileList = document.querySelector("#fileList");
const preview = document.querySelector("#preview");

function setStatus(message) {
  statusNode.textContent = message;
}

function normalizePath(path) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function getMimeType(path) {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) {
    return "application/octet-stream";
  }
  const ext = lower.slice(dot);
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function scoreRootCandidate(path) {
  const normalized = path.toLowerCase();
  const parts = normalized.split("/");
  const depth = parts.length;
  const name = parts[parts.length - 1];
  const startsWithIndex = name === "index.html" ? 0 : 1;
  const hasDist = parts.includes("dist") || parts.includes("build") ? 1 : 0;
  return [startsWithIndex, depth, hasDist, normalized.length, normalized];
}

function detectRootHtml(paths) {
  const htmlFiles = paths.filter((p) => /\.html?$/i.test(p));
  if (!htmlFiles.length) return null;
  htmlFiles.sort((a, b) => {
    const aa = scoreRootCandidate(a);
    const bb = scoreRootCandidate(b);
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i] < bb[i]) return -1;
      if (aa[i] > bb[i]) return 1;
    }
    return 0;
  });
  return htmlFiles[0];
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support Service Worker.");
  }

  const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;

  if (!navigator.serviceWorker.controller) {
    setStatus("Service worker installed. Reloading once so it can control the page…");
    window.location.reload();
    return registration;
  }

  return registration;
}

async function cacheFile(cache, virtualPath, data, contentType) {
  await cache.put(
    virtualPath,
    new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    }),
  );
}

function renderFileList(paths) {
  fileList.innerHTML = "";
  for (const path of paths) {
    const li = document.createElement("li");
    li.textContent = `${VIRTUAL_ROOT}${path}`;
    fileList.appendChild(li);
  }
}

async function listVirtualRootFiles() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const paths = keys
    .map((req) => new URL(req.url).pathname)
    .filter((pathname) => pathname.startsWith(VIRTUAL_ROOT))
    .map((pathname) => pathname.slice(VIRTUAL_ROOT.length))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  renderFileList(paths);
  const entry = detectRootHtml(paths);
  if (entry) {
    const href = `${VIRTUAL_ROOT}${entry}`;
    entryLink.href = href;
    entryLink.textContent = href;
  } else {
    entryLink.removeAttribute("href");
    entryLink.textContent = "(none)";
  }
  return { paths, entry };
}

async function extractZips(files) {
  if (!files.length) {
    throw new Error("Select at least one ZIP file.");
  }

  const cache = await caches.open(CACHE_NAME);
  const extractedPaths = [];

  for (const file of files) {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files);

    for (const entry of entries) {
      if (entry.dir) continue;
      const relativePath = normalizePath(entry.name);
      if (!relativePath) continue;
      const virtualPath = `${VIRTUAL_ROOT}${relativePath}`;
      const arrayBuffer = await entry.async("arraybuffer");
      await cacheFile(cache, virtualPath, arrayBuffer, getMimeType(relativePath));
      extractedPaths.push(relativePath);
    }
  }

  extractedPaths.sort((a, b) => a.localeCompare(b));
  return extractedPaths;
}

extractBtn.addEventListener("click", async () => {
  try {
    const files = [...zipInput.files];
    setStatus(`Extracting ${files.length} ZIP file(s)…`);
    await extractZips(files);
    const { paths, entry } = await listVirtualRootFiles();
    setStatus(`Done. Cached ${paths.length} file(s) under ${VIRTUAL_ROOT}.`);
    if (entry) {
      preview.src = `${VIRTUAL_ROOT}${entry}`;
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

clearBtn.addEventListener("click", async () => {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .map((req) => new URL(req.url).pathname)
      .filter((pathname) => pathname.startsWith(VIRTUAL_ROOT))
      .map((pathname) => cache.delete(pathname)),
  );
  await listVirtualRootFiles();
  preview.removeAttribute("src");
  setStatus("Cleared /virtual-root/ from cache.");
});

(async function init() {
  try {
    await ensureServiceWorker();
    setStatus("Service worker active. Ready to extract ZIP files.");
    const { entry } = await listVirtualRootFiles();
    if (entry) {
      preview.src = `${VIRTUAL_ROOT}${entry}`;
    }
  } catch (error) {
    setStatus(`Service worker setup failed: ${error.message}`);
  }
})();
