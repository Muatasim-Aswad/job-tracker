// Receipt identities contain no notification content and are shared by tabs and the service worker.
const DATABASE = "jt.notificationReceipts.v2";
const STORE = "publications";
const memory = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function seen(key: string): Promise<boolean> {
  if (memory.has(key)) return true;
  const database = await open();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(!!request.result);
    request.onerror = () => resolve(false);
    transaction.oncomplete = () => database.close();
  });
}

async function remember(key: string): Promise<void> {
  memory.add(key);
  if (memory.size > 256) memory.delete(memory.values().next().value!);
  const database = await open();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put({ id: key, at: Date.now() });
    const all = store.getAll();
    all.onsuccess = () => {
      const rows = all.result as { id: string; at: number }[];
      rows.sort((a, b) => b.at - a.at);
      for (const row of rows.slice(256)) store.delete(row.id);
    };
    transaction.oncomplete =
      transaction.onerror =
      transaction.onabort =
        () => {
          database.close();
          resolve();
        };
  });
}

export function presentOnce(key: string, display: () => Promise<void> | void): Promise<void> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    if (await seen(key)) return;
    await display();
    await remember(key);
  })();
  inFlight.set(key, task);
  void task.finally(() => inFlight.delete(key)).catch(() => {});
  return task;
}
