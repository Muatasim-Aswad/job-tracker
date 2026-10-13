import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const listeners = new Map();
const fetched = [];
const stored = [];
const cache = {
  match: async () => undefined,
  keys: async () => [],
  put: async (request) => {
    stored.push(request.url);
  },
};
const caches = {
  keys: async () => [],
  delete: async () => true,
  match: async () => undefined,
  open: async () => cache,
};
const self = {
  location: new URL("http://localhost:3456/sw.js"),
  registration: { scope: "http://localhost:3456/" },
  caches,
  addEventListener(type, callback) {
    const callbacks = listeners.get(type) ?? [];
    callbacks.push(callback);
    listeners.set(type, callbacks);
  },
};
vm.runInNewContext(
  readFileSync(process.argv[2], "utf8"),
  {
    self,
    location: self.location,
    registration: self.registration,
    caches,
    URL,
    Request,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    FetchEvent: class {},
    fetch: async (request) => {
      fetched.push(typeof request === "string" ? request : request.url);
      return new Response("Synthetic public shell asset");
    },
  },
  { timeout: 5_000 },
);

assert(listeners.has("install") && listeners.has("fetch"));
const pending = [];
for (const callback of listeners.get("install")) {
  callback({ type: "install", waitUntil: (promise) => pending.push(promise) });
}
await Promise.all(pending);
for (const urls of [fetched, stored]) {
  assert(urls.some((url) => new URL(url).pathname === "/pwa-192.png"));
  assert(urls.some((url) => new URL(url).pathname === "/index.html"));
  assert(urls.every((url) => new URL(url).pathname !== "/version.json"));
}
function routed(path) {
  let handled = false;
  for (const callback of listeners.get("fetch")) {
    callback({
      request: new Request(new URL(path, self.location.origin)),
      respondWith(promise) {
        handled = true;
        Promise.resolve(promise).catch(() => {});
      },
      waitUntil(promise) {
        Promise.resolve(promise).catch(() => {});
      },
    });
  }
  return handled;
}
assert(routed("/pwa-192.png"));
assert(routed("/index.html"));
for (const path of [
  "/version.json",
  "/version.json?revision=public",
  "/api/jobs",
  "https://example.invalid/version.json",
]) {
  assert.equal(routed(path), false, `Worker must leave ${path} to the network`);
}
console.log("compiled service-worker identity cache boundary OK");
