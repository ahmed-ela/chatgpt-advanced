(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __moduleCache = /* @__PURE__ */ new WeakMap;
  var __toCommonJS = (from) => {
    var entry = __moduleCache.get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function")
      __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
        get: () => from[key],
        enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
      }));
    __moduleCache.set(from, entry);
    return entry;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: (newValue) => all[name] = () => newValue
      });
  };
  var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

  // src/dev-worker.ts
  var exports_dev_worker = {};
  __export(exports_dev_worker, {
    registerDevReload: () => registerDevReload,
    allExtensionPagesSafe: () => allExtensionPagesSafe
  });
  function supportedPage(value) {
    try {
      const url = new URL(value ?? "");
      if (url.username || url.password)
        return null;
      if (["https://chatgpt.com", "https://claude.ai", "https://gemini.google.com"].includes(url.origin))
        return url;
      if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
        return url;
    } catch {}
    return null;
  }
  function isSupportedSender(sender) {
    if (!Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || sender.frameId !== 0)
      return false;
    const documentUrl = supportedPage(sender.url);
    if (!documentUrl)
      return false;
    if (sender.tab?.url !== undefined) {
      const tabUrl = supportedPage(sender.tab.url);
      if (!tabUrl || tabUrl.origin !== documentUrl.origin || tabUrl.pathname !== documentUrl.pathname)
        return false;
    }
    return true;
  }
  function registerDevReload(runtime, options) {
    const devOrigin = supportedPage(options.origin);
    if (!devOrigin || devOrigin.protocol !== "http:")
      throw new Error("Development reload requires a localhost HTTP origin.");
    const versionUrl = `${devOrigin.origin}/__plannotator/version`;
    const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(() => {
      callback();
    }, delayMs));
    const canReload = options.canReload ?? (async () => true);
    const fetchVersion = options.fetchVersion ?? fetch;
    let reloadQueued = false;
    let pendingSafetyCheck = null;
    const checkSafety = () => {
      if (!pendingSafetyCheck) {
        pendingSafetyCheck = Promise.resolve().then(canReload).catch(() => false).finally(() => {
          pendingSafetyCheck = null;
        });
      }
      return pendingSafetyCheck;
    };
    runtime.onMessage.addListener((message, sender, respond) => {
      if (!message || typeof message !== "object")
        return;
      const type = message.type;
      if (type !== "plannotator:dev-reload" && type !== "plannotator:dev-version")
        return;
      if (!isSupportedSender(sender)) {
        respond({ ok: false, error: "Dev reload requires a supported top-level page." });
        return false;
      }
      if (type === "plannotator:dev-version") {
        (async () => {
          try {
            const response = await fetchVersion(versionUrl, { cache: "no-store", signal: AbortSignal.timeout(3000) });
            if (!response.ok)
              throw new Error("Development server is unavailable.");
            const payload = await response.json();
            const buildId = payload && typeof payload === "object" ? payload.buildId : undefined;
            if (typeof buildId !== "string" || !buildId.trim())
              throw new Error("Development server returned no build ID.");
            respond({ ok: true, buildId, workerBuildId: options.workerBuildId });
          } catch (error) {
            respond({ ok: false, error: error instanceof Error ? error.message : "Development server is unavailable." });
          }
        })();
        return true;
      }
      (async () => {
        if (!await checkSafety()) {
          respond({ ok: true, scheduled: false });
          return;
        }
        if (!reloadQueued) {
          reloadQueued = true;
          schedule(async () => {
            if (!await checkSafety()) {
              reloadQueued = false;
              return;
            }
            try {
              runtime.reload();
            } catch (error) {
              reloadQueued = false;
              console.error("[plannotator] development reload failed", error);
            }
          }, 160);
        }
        respond({ ok: true, scheduled: true });
      })();
      return true;
    });
  }
  async function allExtensionPagesSafe(tabs, timeoutMs = 1000) {
    const deadline = async (operation) => {
      let timer;
      try {
        return await Promise.race([
          operation,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Page safety check timed out")), timeoutMs);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const openTabs = await deadline(tabs.query({}));
      const readiness = await Promise.all(openTabs.map(async (tab) => {
        if (!Number.isInteger(tab.id) || tab.id < 0)
          return false;
        try {
          const reply = await deadline(tabs.sendMessage(tab.id, { type: "plannotator:dev-can-reload" }, { frameId: 0 }));
          return Boolean(reply && typeof reply === "object" && reply.ok === true && reply.safe === true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /receiving end does not exist|no tab with id|the tab was closed|tab not found/i.test(message);
        }
      }));
      return readiness.every(Boolean);
    } catch {
      return false;
    }
  }
  var chromeApi;
  var init_dev_worker = __esm(() => {
    chromeApi = globalThis.chrome;
    if (chromeApi?.runtime)
      registerDevReload(chromeApi.runtime, {
        origin: "http://127.0.0.1:19445",
        workerBuildId: "mute98hi-rexalk",
        canReload: () => chromeApi.tabs ? allExtensionPagesSafe(chromeApi.tabs) : Promise.resolve(false)
      });
  });

  // src/queue-worker.ts
  var exports_queue_worker = {};
  __export(exports_queue_worker, {
    registerAnnotationWorker: () => registerAnnotationWorker
  });

  // src/encrypted-storage.ts
  var RECORDS = "encrypted-records";
  var KEYS = "encryption-keys";
  var KEY_ID = "record-key";
  var FORMAT = 1;
  var MAX_CONFLICTS = 128;

  class EncryptedRecordStore {
    factory;
    name;
    legacyTable;
    connection;
    constructor(factory, name, legacyTable) {
      this.factory = factory;
      this.name = name;
      this.legacyTable = legacyTable;
    }
    async close() {
      const connection = this.connection;
      this.connection = undefined;
      if (connection)
        (await connection).close();
    }
    async apply(key, initial, mutate) {
      const database = await this.database();
      const id = await this.lookupId(key);
      for (let attempt = 0;attempt < MAX_CONFLICTS; attempt++) {
        const snapshot = await this.snapshot(database, id);
        const value = snapshot.record ? await this.decrypt(snapshot.record, snapshot.key, key) : initial();
        const mutation = mutate(value);
        if (!mutation.changed)
          return mutation.result;
        const next = await this.encrypt(id, snapshot.key, mutation.value);
        if (await this.compareAndSwap(database, id, snapshot, next))
          return mutation.result;
      }
      throw new Error("Storage is busy in another tab. Keep this tab open and retry.");
    }
    database() {
      if (!this.connection) {
        const opening = this.open().then(async (database) => {
          try {
            await this.initializeKey(database);
            await this.migrate(database);
            return database;
          } catch (error) {
            database.close();
            throw error;
          }
        });
        this.connection = opening;
        opening.catch(() => {
          if (this.connection === opening)
            this.connection = undefined;
        });
      }
      return this.connection;
    }
    open() {
      return new Promise((resolve, reject) => {
        const request = this.factory.open(this.name, 2);
        let failed = false;
        const fail = (error) => {
          failed = true;
          reject(error);
        };
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(this.legacyTable))
            database.createObjectStore(this.legacyTable, { keyPath: "key" });
          if (!database.objectStoreNames.contains(RECORDS))
            database.createObjectStore(RECORDS, { keyPath: "id" });
          if (!database.objectStoreNames.contains(KEYS))
            database.createObjectStore(KEYS, { keyPath: "id" });
        };
        request.onerror = () => fail(request.error ?? new Error("Could not open encrypted storage"));
        request.onblocked = () => fail(new Error("Storage is busy; close older extension pages and retry"));
        request.onsuccess = () => {
          const database = request.result;
          if (failed) {
            database.close();
            return;
          }
          database.onversionchange = () => {
            database.close();
            this.connection = undefined;
          };
          resolve(database);
        };
      });
    }
    async initializeKey(database) {
      const existing = await transaction(database, [KEYS, RECORDS], "readonly", (tx, finish) => {
        const read = tx.objectStore(KEYS).get(KEY_ID);
        read.onsuccess = () => finish(read.result);
      });
      if (existing) {
        validateKey(existing);
        return;
      }
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const candidate = { id: KEY_ID, token: crypto.randomUUID(), key };
      await transaction(database, [KEYS, RECORDS], "readwrite", (tx, finish, fail) => {
        const read = tx.objectStore(KEYS).get(KEY_ID);
        read.onsuccess = () => {
          try {
            if (read.result) {
              validateKey(read.result);
              finish();
              return;
            }
            const count = tx.objectStore(RECORDS).count();
            count.onsuccess = () => {
              try {
                if (count.result !== 0) {
                  fail(new Error("The encryption key is missing. Existing data has been preserved; do not reset extension storage."));
                  return;
                }
                tx.objectStore(KEYS).add(candidate);
                finish();
              } catch (error) {
                fail(error);
              }
            };
          } catch (error) {
            fail(error);
          }
        };
      });
    }
    async lookupId(key) {
      const hash = await crypto.subtle.digest("SHA-256", encode(JSON.stringify([this.name, this.legacyTable, key])));
      return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
    }
    authenticatedData(id, token) {
      return encode(JSON.stringify([FORMAT, this.name, this.legacyTable, id, token]));
    }
    async encrypt(id, key, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.authenticatedData(id, key.token) }, key.key, encode(JSON.stringify(value)));
      return { id, format: FORMAT, keyToken: key.token, iv, ciphertext };
    }
    async decrypt(record, key, expectedKey) {
      try {
        if (record.format !== FORMAT || record.keyToken !== key.token || !(record.iv instanceof Uint8Array) || record.iv.byteLength !== 12 || !(record.ciphertext instanceof ArrayBuffer))
          throw new Error;
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: this.authenticatedData(record.id, key.token) }, key.key, record.ciphertext);
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
        if (!value || value.key !== expectedKey)
          throw new Error;
        return value;
      } catch {
        throw new Error("Stored data could not be decrypted or verified. It has been preserved; do not reset extension storage.");
      }
    }
    snapshot(database, id, legacyKey) {
      const tables = [KEYS, RECORDS, ...legacyKey === undefined ? [] : [this.legacyTable]];
      return transaction(database, tables, "readonly", (tx, finish, fail) => {
        const key = tx.objectStore(KEYS).get(KEY_ID);
        const record = tx.objectStore(RECORDS).get(id);
        const legacy = legacyKey === undefined ? undefined : tx.objectStore(this.legacyTable).get(legacyKey);
        const last = legacy ?? record;
        last.onsuccess = () => {
          try {
            validateKey(key.result);
            finish({ key: key.result, record: record.result, legacy: legacy?.result });
          } catch (error) {
            fail(error);
          }
        };
      });
    }
    compareAndSwap(database, id, before, next, legacyKey, deleteLegacy = false) {
      const tables = [KEYS, RECORDS, ...legacyKey === undefined ? [] : [this.legacyTable]];
      return transaction(database, tables, "readwrite", (tx, finish, fail) => {
        const key = tx.objectStore(KEYS).get(KEY_ID);
        const record = tx.objectStore(RECORDS).get(id);
        const legacy = legacyKey === undefined ? undefined : tx.objectStore(this.legacyTable).get(legacyKey);
        (legacy ?? record).onsuccess = () => {
          try {
            validateKey(key.result);
            if (key.result.token !== before.key.token)
              throw new Error("The encryption key changed. Keep this tab open and retry.");
            if (!sameEnvelope(record.result, before.record) || legacy && JSON.stringify(legacy.result) !== JSON.stringify(before.legacy)) {
              finish(false);
              return;
            }
            if (next)
              tx.objectStore(RECORDS).put(next);
            if (deleteLegacy)
              tx.objectStore(this.legacyTable).delete(legacyKey);
            finish(true);
          } catch (error) {
            fail(error);
          }
        };
      });
    }
    async migrate(database) {
      for (;; ) {
        const legacyKey = await transaction(database, [this.legacyTable], "readonly", (tx, finish) => {
          const read = tx.objectStore(this.legacyTable).openKeyCursor();
          read.onsuccess = () => finish(read.result?.key);
        });
        if (legacyKey === undefined)
          return;
        if (typeof legacyKey !== "string")
          throw new Error("Legacy storage could not be verified. Its original data has been preserved.");
        const id = await this.lookupId(legacyKey);
        let finished = false;
        for (let attempt = 0;attempt < MAX_CONFLICTS; attempt++) {
          const snapshot = await this.snapshot(database, id, legacyKey);
          if (snapshot.legacy === undefined) {
            finished = true;
            break;
          }
          const legacy = snapshot.legacy;
          if (!legacy || legacy.key !== legacyKey)
            throw new Error("Legacy storage could not be verified. Its original data has been preserved.");
          if (snapshot.record) {
            const verified = await this.decrypt(snapshot.record, snapshot.key, legacyKey);
            if (JSON.stringify(verified) !== JSON.stringify(legacy))
              throw new Error("Legacy and encrypted records differ. Both copies have been preserved.");
            if (await this.compareAndSwap(database, id, snapshot, undefined, legacyKey, true)) {
              finished = true;
              break;
            }
          } else {
            const encrypted = await this.encrypt(id, snapshot.key, legacy);
            await this.compareAndSwap(database, id, snapshot, encrypted, legacyKey);
          }
        }
        if (!finished)
          throw new Error("Storage migration is busy. Original data is preserved; retry.");
      }
    }
  }
  function encode(text) {
    return new TextEncoder().encode(text);
  }
  function validateKey(value) {
    if (!value || value.id !== KEY_ID || typeof value.token !== "string" || !value.token || !value.key || value.key.type !== "secret" || value.key.extractable || value.key.algorithm?.name !== "AES-GCM" || value.key.algorithm.length !== 256 || !Array.isArray(value.key.usages) || !value.key.usages.includes("encrypt") || !value.key.usages.includes("decrypt")) {
      throw new Error("The encryption key is missing or invalid. Existing data has been preserved; do not reset extension storage.");
    }
  }
  function sameEnvelope(a, b) {
    if (!a || !b)
      return a === b;
    return a.id === b.id && a.format === b.format && a.keyToken === b.keyToken && equalBytes(a.iv, b.iv) && equalBytes(a.ciphertext, b.ciphertext);
  }
  function equalBytes(a, b) {
    const left = new Uint8Array(a instanceof Uint8Array ? a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) : a);
    const right = new Uint8Array(b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  function transaction(database, tables, mode, run) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(tables, mode, { durability: "strict" });
      let result;
      let finished = false;
      let failure;
      const fail = (error) => {
        failure = error;
        tx.abort();
      };
      tx.oncomplete = () => finished ? resolve(result) : reject(new Error("Storage returned no result"));
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Storage transaction failed. Keep this tab open and retry."));
      tx.onerror = () => {
        failure ??= tx.error;
      };
      try {
        run(tx, (value) => {
          result = value;
          finished = true;
        }, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  // src/queue-store.ts
  var QUEUE_MESSAGE_TYPE = "plannotator:queue";
  var QUEUE_CHANGED_TYPE = "plannotator:queue:changed";
  var QUEUE_CLAIM_MS = 1e4;
  var QUEUE_EDIT_MS = 30000;
  var QUEUE_SEND_TIMEOUT_MS = 30000;
  var QUEUE_BUSY_MS = 3000;
  var QUEUE_MAX_TEXT = 200000;
  var QUEUE_MAX_ITEMS = 100;
  function getQueueKey(url) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password)
        return null;
      if (parsed.protocol === "https:" && parsed.hostname === "chatgpt.com") {
        const match = parsed.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)(?:\/|$)/);
        return match ? `chatgpt:${match[1]}` : null;
      }
      if (parsed.origin === "https://claude.ai") {
        const match = parsed.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,128})\/?$/);
        return match ? `claude:${match[1]}` : null;
      }
      if (parsed.origin === "https://gemini.google.com") {
        const match = parsed.pathname.match(/^\/app\/([A-Za-z0-9_-]{1,128})\/?$/);
        return match ? `gemini:${match[1]}` : null;
      }
      if (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
        return `fixture:${parsed.origin}${parsed.pathname}`;
      }
    } catch {}
    return null;
  }

  class QueueStore {
    storage;
    constructor(factory = indexedDB, name = "plannotator-message-queue-v1") {
      this.storage = new EncryptedRecordStore(factory, name, "queues");
    }
    close() {
      return this.storage.close();
    }
    async apply(request, owner, now = Date.now()) {
      validateRequest(request);
      if (!owner || owner.length > 256)
        throw new Error("Invalid queue client");
      return this.storage.apply(request.key, () => ({ key: request.key, revision: 0, paused: false, items: [], busyLeases: [] }), (state) => {
        const before = JSON.stringify(state);
        recover(state, now);
        const claimed = mutate(state, request, owner, now);
        const changed = JSON.stringify(state) !== before;
        if (changed)
          state.revision += 1;
        const {
          retiredIds: _retiredIds,
          editReceipts: _editReceipts,
          busyLeases: _busyLeases,
          legacyBusyUntil: _legacyBusyUntil,
          ...visible
        } = state;
        const result = {
          state: structuredClone(visible),
          changed,
          ...claimed ? { claimed: structuredClone(claimed) } : {}
        };
        return { value: state, result, changed };
      });
    }
  }
  function validateRequest(request) {
    if (!request || request.type !== QUEUE_MESSAGE_TYPE || typeof request.key !== "string" || request.key.length > 2048 || !/^(chatgpt|claude|gemini|fixture):/.test(request.key))
      throw new Error("Invalid queue conversation");
    if (typeof request.clientId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.clientId))
      throw new Error("Invalid queue client");
    if (!["read", "enqueue", "begin-edit", "edit-heartbeat", "cancel-edit", "steer", "edit", "move", "remove", "pause", "heartbeat", "claim", "attempt", "ack", "anchor", "complete", "release", "review", "retry"].includes(request.action))
      throw new Error("Unknown queue action");
    if (request.id !== undefined && (typeof request.id !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.id)))
      throw new Error("Invalid queued message ID");
    if (request.editToken !== undefined && (typeof request.editToken !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.editToken)))
      throw new Error("Invalid queue edit token");
    if (["begin-edit", "edit-heartbeat", "cancel-edit"].includes(request.action) && !request.editToken)
      throw new Error("Missing queue edit token");
    if (request.afterUserMessageId !== undefined && (typeof request.afterUserMessageId !== "string" || !request.afterUserMessageId || request.afterUserMessageId.length > 256))
      throw new Error("Invalid queue transcript anchor");
    if (["enqueue", "edit"].includes(request.action) && (typeof request.text !== "string" || !request.text.trim() || request.text.length > QUEUE_MAX_TEXT))
      throw new Error(`Queued messages must contain 1–${QUEUE_MAX_TEXT.toLocaleString()} characters`);
  }
  function recover(state, now) {
    for (const item of state.items) {
      if (item.status === "editing" && (item.leaseUntil ?? 0) <= now) {
        resetToQueued(item);
        state.paused = true;
      }
      if (item.status === "claimed" && (item.leaseUntil ?? 0) <= now)
        resetToQueued(item);
      if (item.status === "sending" && (item.attemptedAt ?? 0) + QUEUE_SEND_TIMEOUT_MS <= now) {
        item.status = "review";
        item.reason = "Delivery could not be confirmed. Check the chat before retrying to avoid a duplicate.";
        delete item.leaseUntil;
      }
    }
    refreshBusyUntil(state, now);
  }
  function refreshBusyUntil(state, now) {
    if (!state.busyLeases) {
      if ((state.busyUntil ?? 0) > now) {
        state.legacyBusyUntil = Math.max(state.legacyBusyUntil ?? 0, state.busyUntil);
      }
      state.busyLeases = [];
    }
    state.busyLeases = state.busyLeases.filter((lease) => lease.until > now);
    if ((state.legacyBusyUntil ?? 0) <= now)
      delete state.legacyBusyUntil;
    const until = state.busyLeases.reduce((latest, lease) => Math.max(latest, lease.until), state.legacyBusyUntil ?? 0);
    if (until > now)
      state.busyUntil = until;
    else
      delete state.busyUntil;
  }
  function mutate(state, request, owner, now) {
    const item = state.items.find((entry) => entry.id === request.id);
    const requireItem = () => {
      if (!item)
        throw new Error("This queued message is no longer available");
      return item;
    };
    const owned = (status) => {
      const current = requireItem();
      if (current.status !== status || current.owner !== owner)
        throw new Error("This queued message is being handled by another tab or has changed");
      return current;
    };
    const ownedEdit = () => {
      const current = owned("editing");
      if (current.editToken !== request.editToken)
        throw new Error("This edit session has changed; reopen the queued message");
      return current;
    };
    switch (request.action) {
      case "read":
        return;
      case "heartbeat": {
        if (request.busy === true || request.busy === false) {
          const previous = state.busyLeases.find((lease) => lease.owner === owner);
          state.busyLeases = state.busyLeases.filter((lease) => lease.owner !== owner);
          if (request.busy)
            state.busyLeases.push({ owner, until: Math.max(previous?.until ?? 0, now + QUEUE_BUSY_MS) });
          refreshBusyUntil(state, now);
        }
        return;
      }
      case "enqueue":
        if (!request.id)
          throw new Error("Missing queued message ID");
        if (item || state.retiredIds?.includes(request.id))
          return;
        if (state.items.length >= QUEUE_MAX_ITEMS)
          throw new Error(`Queue is full (${QUEUE_MAX_ITEMS} messages)`);
        if (state.items.length === 0) {
          if (request.afterUserMessageId)
            state.lastCompletedUserMessageId = request.afterUserMessageId;
          else
            delete state.lastCompletedUserMessageId;
        }
        state.items.push({ id: request.id, text: request.text, createdAt: now, status: "queued" });
        return;
      case "pause":
        if (typeof request.paused !== "boolean")
          throw new Error("Invalid queue pause state");
        state.paused = request.paused;
        if (state.paused) {
          for (const entry of state.items)
            if (entry.status === "claimed")
              resetToQueued(entry);
        }
        return;
      case "begin-edit": {
        const current = requireItem();
        if (current.status === "editing" && current.owner === owner && current.editToken === request.editToken) {
          current.leaseUntil = now + QUEUE_EDIT_MS;
          return;
        }
        if (current.status !== "queued")
          throw new Error("Only queued messages can be edited");
        current.status = "editing";
        current.owner = owner;
        current.editToken = request.editToken;
        current.leaseUntil = now + QUEUE_EDIT_MS;
        return;
      }
      case "edit-heartbeat": {
        ownedEdit().leaseUntil = now + QUEUE_EDIT_MS;
        return;
      }
      case "cancel-edit": {
        resetToQueued(ownedEdit());
        return;
      }
      case "edit": {
        if (!item && request.editToken && state.editReceipts?.some((receipt) => receipt.id === request.id && receipt.editToken === request.editToken && receipt.text === request.text))
          return;
        const current = requireItem();
        if (current.status !== "editing" && request.editToken && current.lastEditToken === request.editToken && current.text === request.text)
          return;
        if (current.status === "editing") {
          ownedEdit();
          current.text = request.text;
          current.lastEditToken = request.editToken;
          resetToQueued(current);
          return;
        }
        if (current.status !== "queued")
          throw new Error("Only queued messages can be edited");
        if (request.editToken)
          throw new Error("This edit session has expired or changed; reopen the queued message");
        current.text = request.text;
        delete current.lastEditToken;
        return;
      }
      case "move": {
        const current = requireItem();
        if (current.status !== "queued")
          throw new Error("Only queued messages can be reordered");
        if (!Number.isInteger(request.delta) || !request.delta || Math.abs(request.delta) > QUEUE_MAX_ITEMS)
          throw new Error("Invalid queue move");
        const index = state.items.indexOf(current);
        const target = Math.max(0, Math.min(state.items.length - 1, index + request.delta));
        if (state.items.slice(Math.min(index, target), Math.max(index, target) + 1).some((entry) => entry.status !== "queued"))
          throw new Error("Cannot move past a message that is already being sent");
        state.items.splice(index, 1);
        state.items.splice(target, 0, current);
        return;
      }
      case "remove": {
        if (!item)
          return;
        if (item.status === "editing") {
          if (item.owner !== owner)
            throw new Error("Another tab is editing this queued message");
        } else if (!["queued", "review"].includes(item.status))
          throw new Error("Wait for this message's delivery status before removing it");
        retire(state, item);
        return;
      }
      case "claim": {
        if (state.lastCompletedUserMessageId && request.afterUserMessageId !== state.lastCompletedUserMessageId)
          return;
        if (state.paused || (state.busyUntil ?? 0) > now || state.items.some((entry) => entry.status !== "queued"))
          return;
        const next = state.items[0];
        if (!next)
          return;
        next.status = "claimed";
        next.owner = owner;
        next.leaseUntil = now + QUEUE_CLAIM_MS;
        return next;
      }
      case "steer": {
        const current = requireItem();
        if (current.status !== "queued" || state.items.some((entry) => !["queued", "waiting"].includes(entry.status))) {
          throw new Error("Wait for the active send or edit to finish before sending this message now");
        }
        state.items.splice(state.items.indexOf(current), 1);
        const lastWaiting = state.items.reduce((index, entry, next) => entry.status === "waiting" ? next : index, -1);
        state.items.splice(lastWaiting + 1, 0, current);
        current.status = "claimed";
        current.owner = owner;
        current.leaseUntil = now + QUEUE_CLAIM_MS;
        current.sendNow = true;
        return current;
      }
      case "attempt": {
        const current = owned("claimed");
        if (current.sendNow) {
          for (const previous of state.items.filter((entry) => entry.status === "waiting"))
            retire(state, previous);
          delete state.lastCompletedUserMessageId;
        } else if (state.paused || (state.busyUntil ?? 0) > now)
          throw new Error("ChatGPT became busy or the queue was paused");
        current.status = "sending";
        current.attemptedAt = now;
        current.leaseUntil = now + QUEUE_SEND_TIMEOUT_MS;
        return;
      }
      case "ack": {
        const current = requireItem();
        if (current.owner !== owner || !["sending", "review", "waiting"].includes(current.status))
          throw new Error("This message's delivery cannot be acknowledged by this tab");
        if (typeof request.userMessageId !== "string" || !request.userMessageId || request.userMessageId.length > 256)
          throw new Error("Missing confirmed ChatGPT message ID");
        if (current.status === "waiting" && current.userMessageId !== request.userMessageId)
          throw new Error("Conflicting ChatGPT message ID");
        current.status = "waiting";
        current.userMessageId = request.userMessageId;
        delete current.leaseUntil;
        delete current.reason;
        return;
      }
      case "anchor": {
        if (!request.key.startsWith("gemini:") || typeof request.userMessageId !== "string" || !/^gemini:user:user-query-content-\d+:[a-z0-9]+$/.test(request.userMessageId ?? "") || !/^gemini:user:[0-9a-f]{16}$/i.test(request.afterUserMessageId ?? ""))
          throw new Error("Invalid Gemini transcript anchor promotion");
        if (request.id) {
          if (item?.status === "waiting" && item.userMessageId === request.userMessageId)
            item.userMessageId = request.afterUserMessageId;
        } else if (state.lastCompletedUserMessageId === request.userMessageId) {
          state.lastCompletedUserMessageId = request.afterUserMessageId;
        }
        return;
      }
      case "complete": {
        if (!item)
          return;
        if (item.status !== "waiting")
          throw new Error("Delivery must be confirmed before completing a queued message");
        if (request.userMessageId !== undefined && request.userMessageId !== item.userMessageId)
          throw new Error("ChatGPT message ID does not match");
        state.lastCompletedUserMessageId = item.userMessageId;
        retire(state, item);
        return;
      }
      case "release": {
        if (!item)
          return;
        resetToQueued(owned("claimed"));
        return;
      }
      case "review": {
        const current = requireItem();
        if (current.owner !== owner)
          throw new Error("This send attempt belongs to another tab or has changed");
        if (current.status === "waiting")
          return;
        if (!["sending", "review"].includes(current.status))
          throw new Error("This message has not been sent yet");
        current.status = "review";
        current.reason = typeof request.reason === "string" ? request.reason.slice(0, 1000) : "Check whether this message was delivered before retrying.";
        delete current.leaseUntil;
        return;
      }
      case "retry": {
        const current = requireItem();
        if (current.status !== "review")
          throw new Error("Only messages needing review can be retried");
        resetToQueued(current);
        return;
      }
    }
  }
  function resetToQueued(item) {
    item.status = "queued";
    delete item.owner;
    delete item.leaseUntil;
    delete item.attemptedAt;
    delete item.userMessageId;
    delete item.reason;
    delete item.editToken;
    delete item.sendNow;
  }
  function retire(state, item) {
    if (item.lastEditToken) {
      state.editReceipts = [
        ...state.editReceipts ?? [],
        { id: item.id, editToken: item.lastEditToken, text: item.text }
      ].slice(-20);
    }
    state.items.splice(state.items.indexOf(item), 1);
    state.retiredIds = [...state.retiredIds ?? [], item.id].slice(-1000);
  }

  // src/annotation-store.ts
  var ANNOTATION_MESSAGE_TYPE = "plannotator:annotations";
  var ANNOTATION_CHANGED_TYPE = "plannotator:annotations:changed";
  var ANNOTATION_MAX_NOTES = 500;
  var ANNOTATION_MAX_TEXT = 200000;
  var ANNOTATION_MAX_TOMBSTONES = 2000;
  var MAX_DOCUMENT_TEXT = 8000000;
  function getAnnotationKey(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "chatgpt.com" && parsed.origin !== "https://chatgpt.com")
        return null;
      return getQueueKey(url);
    } catch {
      return null;
    }
  }

  class AnnotationStore {
    storage;
    constructor(factory = indexedDB, name = "plannotator-annotations-v1") {
      this.storage = new EncryptedRecordStore(factory, name, "annotations");
    }
    close() {
      return this.storage.close();
    }
    async apply(request, now = Date.now()) {
      const input = validateRequest2(request);
      return this.storage.apply(input.key, () => ({ key: input.key, revision: 0, notes: [], tombstones: [] }), (state) => {
        const before = JSON.stringify(state);
        mutate2(state, input, now);
        const changed = JSON.stringify(state) !== before;
        if (changed) {
          if (state.notes.length > ANNOTATION_MAX_NOTES || JSON.stringify(state.notes).length > MAX_DOCUMENT_TEXT) {
            throw new Error("This conversation has reached its annotation storage limit. Remove some notes and retry.");
          }
          state.revision++;
        }
        const result = { notes: structuredClone(state.notes), revision: state.revision, changed };
        return { value: state, result, changed };
      });
    }
  }
  function validId(id) {
    return typeof id === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(id);
  }
  function validateRequest2(request) {
    if (!request || request.type !== ANNOTATION_MESSAGE_TYPE || typeof request.key !== "string" || request.key.length > 2048 || !/^(chatgpt|claude|gemini|fixture):.+$/.test(request.key))
      throw new Error("Invalid annotation conversation");
    if (!["read", "upsert", "remove", "import"].includes(request.action))
      throw new Error("Unknown annotation action");
    if (request.action === "read")
      return { type: request.type, key: request.key, action: request.action };
    if (request.action === "remove") {
      if (!Array.isArray(request.ids) || request.ids.length > ANNOTATION_MAX_NOTES || !request.ids.every(validId))
        throw new Error("Invalid annotation IDs");
      return { type: request.type, key: request.key, action: request.action, ids: [...new Set(request.ids)] };
    }
    if (!Array.isArray(request.notes) || request.notes.length > ANNOTATION_MAX_NOTES)
      throw new Error("Invalid annotation notes");
    const notes = request.notes.map(cleanNote);
    if (new Set(notes.map((note) => note.id)).size !== notes.length)
      throw new Error("Duplicate annotation IDs");
    if (JSON.stringify(notes).length > MAX_DOCUMENT_TEXT)
      throw new Error("These annotations are too large to save in one request");
    return { type: request.type, key: request.key, action: request.action, notes };
  }
  function cleanNote(note) {
    if (!note || !validId(note.id) || typeof note.messageId !== "string" || !note.messageId || note.messageId.length > 512)
      throw new Error("Invalid annotation identity");
    for (const field of ["messageExcerpt", "quote", "comment", "contextBefore", "contextAfter"]) {
      if (typeof note[field] !== "string" || note[field].length > ANNOTATION_MAX_TEXT)
        throw new Error(`Annotation ${field} must contain at most ${ANNOTATION_MAX_TEXT.toLocaleString()} characters`);
    }
    if (!Number.isFinite(note.createdAt) || note.createdAt < 0)
      throw new Error("Invalid annotation creation time");
    for (const offset of [note.startOffset, note.endOffset]) {
      if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0))
        throw new Error("Invalid annotation selection offset");
    }
    if (note.startOffset !== undefined && note.endOffset !== undefined && note.startOffset > note.endOffset)
      throw new Error("Invalid annotation selection range");
    return {
      id: note.id,
      messageId: note.messageId,
      messageExcerpt: note.messageExcerpt,
      quote: note.quote,
      comment: note.comment,
      contextBefore: note.contextBefore,
      contextAfter: note.contextAfter,
      ...note.startOffset !== undefined ? { startOffset: note.startOffset } : {},
      ...note.endOffset !== undefined ? { endOffset: note.endOffset } : {},
      createdAt: note.createdAt
    };
  }
  function mutate2(state, request, now) {
    if (request.action === "read")
      return;
    if (request.action === "remove") {
      for (const id of request.ids) {
        const note = state.notes.find((entry) => entry.id === id);
        state.notes = state.notes.filter((entry) => entry.id !== id);
        if (!state.tombstones.some((entry) => entry.id === id))
          state.tombstones.push({ id, createdAt: note?.createdAt ?? now });
      }
      while (state.tombstones.length > ANNOTATION_MAX_TOMBSTONES) {
        const retired = state.tombstones.shift();
        state.retiredBefore = Math.max(state.retiredBefore ?? 0, retired.createdAt);
      }
      return;
    }
    for (const note of request.notes) {
      const index = state.notes.findIndex((entry) => entry.id === note.id);
      if (request.action === "import" && (index >= 0 || state.tombstones.some((entry) => entry.id === note.id)))
        continue;
      if (state.tombstones.some((entry) => entry.id === note.id))
        throw new Error("This annotation was removed in another tab. Create a new note to restore it.");
      if (index < 0 && state.retiredBefore !== undefined && note.createdAt <= state.retiredBefore) {
        throw new Error("These older annotations may have been deleted. Keep their source copy and create a new note to restore them.");
      }
      if (index < 0)
        state.notes.push(note);
      else
        state.notes[index] = note;
    }
  }

  // src/queue-worker.ts
  var chromeApi2 = globalThis.chrome;
  function registerAnnotationWorker(api, annotationStore = new AnnotationStore) {
    const annotationTabs = new Map;
    api.runtime?.onMessage.addListener((message, sender, respond) => {
      if (!message || typeof message !== "object" || message.type !== ANNOTATION_MESSAGE_TYPE)
        return;
      const request = message;
      const tabId = sender.tab?.id;
      const tabUrl = sender.tab?.url ?? sender.url ?? "";
      const tabKey = getAnnotationKey(tabUrl);
      let sameOrigin = false;
      try {
        sameOrigin = new URL(sender.url ?? "").origin === new URL(tabUrl).origin;
      } catch {}
      if (!Number.isInteger(tabId) || tabId < 0 || sender.frameId !== 0 || !sameOrigin || !tabKey || request.key !== tabKey) {
        respond({ ok: false, error: "Annotation conversation does not match the current top-level tab" });
        return false;
      }
      annotationTabs.set(tabId, tabKey);
      annotationStore.apply(request).then((result) => {
        respond({ ok: true, notes: result.notes, revision: result.revision });
        if (result.changed) {
          for (const [knownTab, knownKey] of annotationTabs) {
            if (knownKey !== request.key)
              continue;
            api.tabs?.sendMessage(knownTab, {
              type: ANNOTATION_CHANGED_TYPE,
              key: request.key,
              revision: result.revision
            }, { frameId: 0 }).catch(() => {
              annotationTabs.delete(knownTab);
            });
          }
        }
      }).catch((error) => {
        respond({ ok: false, error: error instanceof Error ? error.message : "Annotations could not be saved. Keep this tab open and retry." });
      });
      return true;
    });
  }
  if (chromeApi2?.runtime) {
    const store = new QueueStore;
    const seenTabs = new Map;
    chromeApi2?.runtime?.onMessage.addListener((message, sender, respond) => {
      if (!message || typeof message !== "object" || message.type !== QUEUE_MESSAGE_TYPE)
        return;
      const request = message;
      const tabId = sender.tab?.id;
      const tabKey = getQueueKey(sender.tab?.url ?? sender.url ?? "");
      if (typeof tabId !== "number" || sender.frameId !== undefined && sender.frameId !== 0 || !tabKey || request.key !== tabKey) {
        respond({ ok: false, error: "Queue conversation does not match the current tab" });
        return false;
      }
      seenTabs.set(tabId, tabKey);
      store.apply(request, `${tabId}:${request.clientId}`).then((result) => {
        respond({ ok: true, state: result.state, ...result.claimed ? { claimed: result.claimed } : {} });
        if (result.changed && request.action !== "edit-heartbeat" && (request.action !== "heartbeat" || request.busy === false)) {
          for (const [knownTab, knownKey] of seenTabs) {
            if (knownKey !== request.key)
              continue;
            chromeApi2?.tabs?.sendMessage(knownTab, {
              type: QUEUE_CHANGED_TYPE,
              key: request.key,
              revision: result.state.revision
            }).catch(() => {
              seenTabs.delete(knownTab);
            });
          }
        }
      }).catch((error) => {
        respond({ ok: false, error: error instanceof Error ? error.message : "Queue could not be saved. Your message has not been cleared." });
      });
      return true;
    });
    registerAnnotationWorker(chromeApi2);
  }
  if (true)
    Promise.resolve().then(() => init_dev_worker());
})();

//# debugId=C19976232093395F64756E2164756E21
//# sourceMappingURL=queue-worker.js.map
