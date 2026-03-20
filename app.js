const CACHE_NAME = "virtual-root-cache-v2";
const VIRTUAL_ROOT = "/virtual-root/";
const META_PATH = `${VIRTUAL_ROOT}__virtual_root_meta__.json`;
const HANDLE_DB = "zip-runner-filemap-handles";
const HANDLE_STORE = "folders";

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
const importFolderBtn = document.querySelector("#importFolderBtn");
const clearBtn = document.querySelector("#clearBtn");
const loadFolderBtn = document.querySelector("#loadFolderBtn");
const deleteFolderBtn = document.querySelector("#deleteFolderBtn");
const folderSelect = document.querySelector("#folderSelect");
const statusNode = document.querySelector("#status");
const entryLink = document.querySelector("#entryLink");
const fileList = document.querySelector("#fileList");
const preview = document.querySelector("#preview");

let keepAliveTimer;

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
  if (dot === -1) return "application/octet-stream";
  return MIME_TYPES[lower.slice(dot)] ?? "application/octet-stream";
}

function scoreRootCandidate(path) {
  const normalized = path.toLowerCase();
  const parts = normalized.split("/");
  const name = parts[parts.length - 1];
  const startsWithIndex = name === "index.html" ? 0 : 1;
  const depth = parts.length;
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

function openHandlesDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: "name" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function listSavedFolders() {
  const db = await openHandlesDb();
  const tx = db.transaction(HANDLE_STORE, "readonly");
  const store = tx.objectStore(HANDLE_STORE);
  const result = await requestToPromise(store.getAll());
  db.close();
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveFolderHandle(handle) {
  const db = await openHandlesDb();
  const tx = db.transaction(HANDLE_STORE, "readwrite");
  const store = tx.objectStore(HANDLE_STORE);
  const existing = await requestToPromise(store.get(handle.name));
  const record = {
    name: handle.name,
    handle,
    updatedAt: Date.now(),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await requestToPromise(store.put(record));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  localStorage.setItem("zip-runner-last-folder", handle.name);
}

async function getSavedFolder(name) {
  if (!name) return null;
  const db = await openHandlesDb();
  const tx = db.transaction(HANDLE_STORE, "readonly");
  const store = tx.objectStore(HANDLE_STORE);
  const result = await requestToPromise(store.get(name));
  db.close();
  return result;
}

async function deleteSavedFolder(name) {
  if (!name) return;
  const db = await openHandlesDb();
  const tx = db.transaction(HANDLE_STORE, "readwrite");
  const store = tx.objectStore(HANDLE_STORE);
  await requestToPromise(store.delete(name));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  if (localStorage.getItem("zip-runner-last-folder") === name) {
    localStorage.removeItem("zip-runner-last-folder");
  }
}

async function refreshFolderSelect() {
  const folders = await listSavedFolders();
  folderSelect.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = folders.length ? "Select saved folder" : "No saved folder";
  folderSelect.appendChild(empty);
  for (const folder of folders) {
    const option = document.createElement("option");
    option.value = folder.name;
    option.textContent = folder.name;
    folderSelect.appendChild(option);
  }
  const last = localStorage.getItem("zip-runner-last-folder");
  if (last && folders.some((folder) => folder.name === last)) {
    folderSelect.value = last;
  }
}

async function ensureFolderPermission(handle) {
  const options = { mode: "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support Service Worker.");
  }

  const registration = await navigator.serviceWorker.register("./sw.js", { scope: "/" });
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

async function writeMetadata(cache, { files, entry }) {
  const payload = JSON.stringify({ files, entry, updatedAt: Date.now() });
  await cacheFile(cache, META_PATH, payload, "application/json; charset=utf-8");
}

async function clearVirtualRootCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .map((req) => new URL(req.url).pathname)
      .filter((pathname) => pathname.startsWith(VIRTUAL_ROOT))
      .map((pathname) => cache.delete(pathname)),
  );
  await writeMetadata(cache, { files: [], entry: null });
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
    .filter((pathname) => pathname.startsWith(VIRTUAL_ROOT) && pathname !== META_PATH)
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
  if (!files.length) throw new Error("Select at least one ZIP file.");

  await clearVirtualRootCache();
  const cache = await caches.open(CACHE_NAME);
  for (const file of files) {
    const zip = await JSZip.loadAsync(file);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const relativePath = normalizePath(entry.name);
      if (!relativePath) continue;
      const virtualPath = `${VIRTUAL_ROOT}${relativePath}`;
      const arrayBuffer = await entry.async("arraybuffer");
      await cacheFile(cache, virtualPath, arrayBuffer, getMimeType(relativePath));
    }
  }

  const state = await listVirtualRootFiles();
  await writeMetadata(cache, { files: state.paths, entry: state.entry });
  return state;
}

async function iterateDirectoryFiles(handle, parentPath = "") {
  const files = [];
  for await (const [name, entry] of handle.entries()) {
    const nextPath = normalizePath(`${parentPath}/${name}`);
    if (entry.kind === "file") {
      files.push({ path: nextPath, file: await entry.getFile() });
      continue;
    }
    if (entry.kind === "directory") {
      files.push(...(await iterateDirectoryFiles(entry, nextPath)));
    }
  }
  return files;
}

async function extractFromFolderHandle(handle) {
  if (!(await ensureFolderPermission(handle))) {
    throw new Error(`Read permission denied for folder "${handle.name}".`);
  }

  await clearVirtualRootCache();
  const cache = await caches.open(CACHE_NAME);
  const files = await iterateDirectoryFiles(handle);
  for (const { path, file } of files) {
    await cacheFile(cache, `${VIRTUAL_ROOT}${path}`, await file.arrayBuffer(), getMimeType(path));
  }

  const state = await listVirtualRootFiles();
  await writeMetadata(cache, { files: state.paths, entry: state.entry });
  return state;
}

function startKeepAlive(registration) {
  if (keepAliveTimer) clearInterval(keepAliveTimer);

  keepAliveTimer = window.setInterval(async () => {
    try {
      registration.active?.postMessage({ type: "KEEP_ALIVE", ts: Date.now() });
      await fetch(`${VIRTUAL_ROOT}__sw_keepalive__`, { cache: "no-store" });
    } catch {
      // Ignore temporary failures; next interval will retry.
    }
  }, 25000);
}

extractBtn.addEventListener("click", async () => {
  try {
    const files = [...zipInput.files];
    setStatus(`Extracting ${files.length} ZIP file(s)…`);
    const { paths, entry } = await extractZips(files);
    setStatus(`Done. Cached ${paths.length} file(s) under ${VIRTUAL_ROOT}.`);
    if (entry) preview.src = `${VIRTUAL_ROOT}${entry}`;
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

importFolderBtn.addEventListener("click", async () => {
  try {
    if (!("showDirectoryPicker" in window)) {
      throw new Error("This browser does not support the File System Access API.");
    }

    const handle = await window.showDirectoryPicker({ mode: "read" });
    await saveFolderHandle(handle);
    await refreshFolderSelect();
    folderSelect.value = handle.name;
    setStatus(`Importing folder "${handle.name}"…`);
    const { paths, entry } = await extractFromFolderHandle(handle);
    setStatus(`Imported folder "${handle.name}" with ${paths.length} file(s).`);
    if (entry) preview.src = `${VIRTUAL_ROOT}${entry}`;
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

loadFolderBtn.addEventListener("click", async () => {
  try {
    const name = folderSelect.value;
    if (!name) throw new Error("Select a saved folder.");
    const record = await getSavedFolder(name);
    if (!record?.handle) throw new Error(`Saved folder "${name}" was not found.`);
    localStorage.setItem("zip-runner-last-folder", name);
    setStatus(`Loading saved folder "${name}"…`);
    const { paths, entry } = await extractFromFolderHandle(record.handle);
    setStatus(`Loaded folder "${name}" with ${paths.length} file(s).`);
    if (entry) preview.src = `${VIRTUAL_ROOT}${entry}`;
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

deleteFolderBtn.addEventListener("click", async () => {
  try {
    const name = folderSelect.value;
    if (!name) throw new Error("Select a saved folder to forget.");
    await deleteSavedFolder(name);
    await refreshFolderSelect();
    setStatus(`Forgot saved folder "${name}".`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});

clearBtn.addEventListener("click", async () => {
  await clearVirtualRootCache();
  await listVirtualRootFiles();
  preview.removeAttribute("src");
  setStatus("Cleared /virtual-root/ from cache.");
});

(async function init() {
  try {
    const registration = await ensureServiceWorker();
    startKeepAlive(registration);
    await refreshFolderSelect();
    setStatus("Service worker active. Ready to extract ZIP files or folders.");
    const { entry } = await listVirtualRootFiles();
    if (entry) preview.src = `${VIRTUAL_ROOT}${entry}`;
  } catch (error) {
    setStatus(`Service worker setup failed: ${error.message}`);
  }
})();
