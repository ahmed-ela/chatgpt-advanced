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

  // src/queue-ui.ts
  var exports_queue_ui = {};
  __export(exports_queue_ui, {
    MessageQueue: () => MessageQueue
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

  // node_modules/lucide/dist/esm/icons/arrow-right.mjs
  var ArrowRight = [
    ["path", { d: "M5 12h14" }],
    ["path", { d: "m12 5 7 7-7 7" }]
  ];

  // node_modules/lucide/dist/esm/icons/arrow-up.mjs
  var ArrowUp = [
    ["path", { d: "m5 12 7-7 7 7" }],
    ["path", { d: "M12 19V5" }]
  ];

  // node_modules/lucide/dist/esm/icons/check.mjs
  var Check = [["path", { d: "M20 6 9 17l-5-5" }]];

  // node_modules/lucide/dist/esm/icons/chevron-down.mjs
  var ChevronDown = [["path", { d: "m6 9 6 6 6-6" }]];

  // node_modules/lucide/dist/esm/icons/chevron-right.mjs
  var ChevronRight = [["path", { d: "m9 18 6-6-6-6" }]];

  // node_modules/lucide/dist/esm/icons/grip-vertical.mjs
  var GripVertical = [
    ["circle", { cx: "9", cy: "12", r: "1" }],
    ["circle", { cx: "9", cy: "5", r: "1" }],
    ["circle", { cx: "9", cy: "19", r: "1" }],
    ["circle", { cx: "15", cy: "12", r: "1" }],
    ["circle", { cx: "15", cy: "5", r: "1" }],
    ["circle", { cx: "15", cy: "19", r: "1" }]
  ];

  // node_modules/lucide/dist/esm/icons/loader-circle.mjs
  var LoaderCircle = [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56" }]];

  // node_modules/lucide/dist/esm/icons/pause.mjs
  var Pause = [
    ["rect", { x: "14", y: "3", width: "5", height: "18", rx: "1" }],
    ["rect", { x: "5", y: "3", width: "5", height: "18", rx: "1" }]
  ];

  // node_modules/lucide/dist/esm/icons/pencil.mjs
  var Pencil = [
    [
      "path",
      {
        d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
      }
    ],
    ["path", { d: "m15 5 4 4" }]
  ];

  // node_modules/lucide/dist/esm/icons/play.mjs
  var Play = [
    [
      "path",
      { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }
    ]
  ];

  // node_modules/lucide/dist/esm/icons/plus.mjs
  var Plus = [
    ["path", { d: "M5 12h14" }],
    ["path", { d: "M12 5v14" }]
  ];

  // node_modules/lucide/dist/esm/icons/trash.mjs
  var Trash = [
    ["path", { d: "M10 11v6" }],
    ["path", { d: "M14 11v6" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]
  ];
  // src/icons.ts
  var icons = {
    "arrow-right": ArrowRight,
    send: ArrowUp,
    check: Check,
    "chevron-down": ChevronDown,
    "chevron-right": ChevronRight,
    grip: GripVertical,
    loader: LoaderCircle,
    pause: Pause,
    edit: Pencil,
    play: Play,
    plus: Plus,
    trash: Trash
  };
  var escapeAttribute = (value) => String(value).replace(/[&"<>]/g, (char) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);
  function icon(name, size = 16, className = "") {
    const children = icons[name].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(" ")}></${tag}>`).join("");
    return `<svg class="icon icon-${name}${className ? ` ${escapeAttribute(className)}` : ""}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
  }

  // src/provider-dom.ts
  function currentProvider() {
    return window.location.hostname === "claude.ai" ? "claude" : window.location.hostname === "gemini.google.com" ? "gemini" : "chatgpt";
  }
  var providerComposerSelectors = {
    claude: ["[data-cds='ChatComposer'] [data-testid='chat-input'][contenteditable='true']", "[data-testid='chat-input'][contenteditable='true'][role='textbox']"],
    gemini: ["input-area-v2 rich-textarea .ql-editor[contenteditable='true'][role='textbox']"]
  };
  var providerScopeSelector = "[data-cds='ChatComposer'], input-area-v2";
  var claudeBody = "[data-testid='assistant-message'] :is([data-perf-reply-text], .standard-markdown)";
  var geminiBody = "model-response message-content .markdown";
  function providerAssistantElements() {
    return Array.from(document.querySelectorAll(currentProvider() === "claude" ? claudeBody : geminiBody));
  }
  function hash(text) {
    let value = 2166136261;
    for (let i = 0;i < text.length; i++)
      value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(36);
  }
  function providerMessageId(element, text) {
    if (currentProvider() === "claude") {
      const row = element.closest("[data-testid='transcript-row']");
      const index = row?.getAttribute("data-index");
      const role = row?.getAttribute("data-perf-row");
      if (!index || !/^\d+$/.test(index) || !["human", "assistant"].includes(role ?? ""))
        return null;
      return `claude:${role}:${index}:${hash(text.replace(/\s+/g, " ").trim())}`;
    }
    const user = element.closest("user-query");
    if (user) {
      const prompt = user.querySelector(".query-content[id^='user-query-content-']");
      if (!prompt)
        return null;
      let index = prompt.id.match(/^user-query-content-(\d+)$/)?.[1];
      if (!index) {
        const prompts = Array.from(document.querySelectorAll("user-query .query-content[id]"));
        const position = prompts.indexOf(prompt);
        for (let previous = position - 1;previous >= 0; previous--) {
          const priorIndex = prompts[previous].id.match(/^user-query-content-(\d+)$/)?.[1];
          if (priorIndex) {
            index = String(Number(priorIndex) + position - previous);
            break;
          }
        }
        if (!index && position === 0 && prompts.length === 1)
          index = "0";
      }
      if (index === undefined)
        return null;
      return `gemini:user:user-query-content-${index}:${hash(text.replace(/\s+/g, " ").trim())}`;
    }
    const turn = element.closest(".conversation-container[id]");
    if (!turn?.id)
      return null;
    return `gemini:assistant:${turn.id}`;
  }
  function geminiUserText(element, read) {
    const lines = Array.from(element.querySelectorAll(".query-text-line"));
    if (!lines.length)
      return read(element).replace(/\u00a0/g, " ").trim();
    return lines.map((line) => {
      if (line.children.length === 1 && line.firstElementChild?.tagName === "BR" && !line.textContent)
        return "";
      const text = read(line);
      return text.length >= 2 && text.startsWith(" ") && text.endsWith(" ") ? text.slice(1, -1) : text;
    }).join(`
`).replace(/\u00a0/g, " ");
  }
  function providerMessages(visible, read, onlyRole) {
    const provider = currentProvider();
    const userSelector = provider === "claude" ? "[data-testid='user-message']" : "user-query .query-text";
    const assistantSelector = provider === "claude" ? claudeBody : geminiBody;
    const selector = onlyRole === "user" ? userSelector : onlyRole === "assistant" ? assistantSelector : `${userSelector}, ${assistantSelector}`;
    const messages = [];
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (!visible(element))
        continue;
      const role = element.matches("[data-testid='user-message'], .query-text") ? "user" : "assistant";
      const copy = element.cloneNode(true);
      copy.querySelectorAll("button, [role='button'], script, style, .cdk-visually-hidden, .sr-only").forEach((node) => node.remove());
      const text = provider === "gemini" && role === "user" ? geminiUserText(copy, read) : read(copy).replace(/\u00a0/g, " ").trim();
      const id = providerMessageId(element, text);
      if (id && text.trim() && !messages.some((message) => message.id === id))
        messages.push({ id, text, role, element });
    }
    return messages;
  }
  function providerLoading(visible) {
    const selectors = currentProvider() === "claude" ? "[data-testid='transcript-row'][data-perf-row-streaming='true'], [data-testid='assistant-message'][data-is-streaming='true'], [aria-label='Currently streaming message']" : "model-response [aria-busy='true']";
    return Array.from(document.querySelectorAll(selectors)).some(visible);
  }
  var routeStates = new WeakMap;
  function providerConversationReady(key, messages) {
    if (currentProvider() === "gemini") {
      const id = key.slice("gemini:".length);
      const ids = [];
      for (const node of Array.from(document.querySelectorAll("model-response [jslog]"))) {
        const encoded = node.getAttribute("jslog")?.match(/BardVeMetadataKey:([^;]+)/)?.[1];
        if (!encoded)
          continue;
        try {
          const value = JSON.parse(atob(encoded));
          const conversation = Array.isArray(value) && Array.isArray(value[0]) ? value[0][1] : null;
          if (typeof conversation === "string" && conversation.startsWith("c_"))
            ids.push(conversation.slice(2));
        } catch {}
      }
      return ids.length > 0 && ids.every((value) => value === id);
    }
    const signature = messages.filter((message) => message.role === "user").map((message) => message.id).join("|");
    let state = routeStates.get(document);
    if (!state) {
      state = { key, signature, stale: null };
      routeStates.set(document, state);
    } else if (state.key !== key) {
      state.stale = state.signature;
      state.key = key;
    }
    if (state.stale !== null) {
      if (!signature || signature === state.stale)
        return false;
      state.stale = null;
    }
    state.signature = signature;
    return Array.from(document.querySelectorAll("a[aria-current='page'][href]")).some((link) => {
      try {
        return new URL(link.href).pathname === window.location.pathname;
      } catch {
        return false;
      }
    });
  }
  function providerCompletion(assistant, visible) {
    const provider = currentProvider();
    const container = assistant.element.closest(provider === "claude" ? "[data-testid='transcript-row']" : "model-response");
    if (!container)
      return false;
    if (provider === "claude" && (container.getAttribute("data-perf-row-streaming") !== "false" || assistant.element.closest("[data-testid='assistant-message']")?.getAttribute("data-is-streaming") !== "false"))
      return false;
    if (provider === "gemini" && (assistant.element.getAttribute("aria-busy") !== "false" || !container.querySelector(".response-footer.complete")))
      return false;
    const labels = Array.from(container.querySelectorAll("button")).filter(visible).filter((button) => !assistant.element.contains(button)).map((button) => button.getAttribute("aria-label")?.toLowerCase());
    return labels.includes("copy") && labels.includes("good response") && labels.includes("bad response");
  }

  // src/chatgpt-dom.ts
  var COMPOSER_SELECTORS = [
    "[data-composer-input] [data-composer-markdown][contenteditable='true']",
    "[data-composer-markdown][contenteditable='true'][role='textbox']",
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "form[data-type='unified-composer'] textarea",
    "form.group\\/composer textarea",
    "form[data-type='unified-composer'] [contenteditable='true']",
    "form.group\\/composer [contenteditable='true']"
  ];
  var USER_SELECTOR = "[data-message-author-role='user'], [data-markdown-text-style='user-message'], [data-chatgpt-search-unit-key$=':user']";
  var ASSISTANT_SELECTOR = "[data-message-author-role='assistant'], [data-markdown-text-style='assistant-message']";
  var MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;
  var STOP_LABEL = /^(?:stop|pause)(?:$|[\s…])/i;
  var SEND_LABEL = /^(?:send|send message|send prompt)$/i;
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var conversationAlias = null;
  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected)
      return false;
    for (let node = element;node; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true")
        return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")
        return false;
    }
    return element.getClientRects().length > 0;
  }
  function findQueueComposer() {
    const provider = currentProvider();
    for (const selector of provider === "chatgpt" ? COMPOSER_SELECTORS : providerComposerSelectors[provider]) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(element) || element.closest("[data-plannotator-queue-root], #plannotator-chatgpt-root"))
          continue;
        if (element instanceof HTMLTextAreaElement) {
          if (!element.disabled && !element.readOnly)
            return element;
        } else if (element.getAttribute("contenteditable") === "true" && element.getAttribute("aria-disabled") !== "true") {
          return element;
        }
      }
    }
    return null;
  }
  function composerScope(composer = findQueueComposer()) {
    if (!composer)
      return null;
    const known = composer.closest(`[data-composer-body], form, [data-composer-surface], section[aria-label*='composer' i], ${providerScopeSelector}`);
    if (known)
      return known;
    let parent = composer.parentElement;
    for (let depth = 0;parent && depth < 6; depth++, parent = parent.parentElement) {
      if (parent === document.body || parent.matches("main, [role='main']"))
        break;
      if (Array.from(parent.querySelectorAll("button")).some((button) => isSendControl(button) || isStopControl(button)))
        return parent;
    }
    return composer.parentElement;
  }
  function isStopControl(button) {
    return button.getAttribute("data-testid") === "stop-button" || STOP_LABEL.test((button.getAttribute("aria-label") || button.getAttribute("title") || "").trim());
  }
  function isSendControl(button) {
    if (isStopControl(button))
      return false;
    const label = (button.getAttribute("aria-label") || button.getAttribute("title") || "").trim();
    if (label && !SEND_LABEL.test(label))
      return false;
    return button.getAttribute("data-testid") === "send-button" || button.id === "composer-submit-button" || SEND_LABEL.test(label);
  }
  function findQueueSendButton() {
    const scope = composerScope();
    if (!scope)
      return null;
    for (const button of Array.from(scope.querySelectorAll("button"))) {
      if (isVisible(button) && isSendControl(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true")
        return button;
    }
    return null;
  }
  function findQueueStopButton() {
    const enabledGenerationStop = (button) => {
      if (!isVisible(button) || button.disabled || button.getAttribute("aria-disabled") === "true" || !isStopControl(button))
        return false;
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
      return !/\b(?:audio|playback|recording|dictation|voice|music|read[ -]?aloud)\b/i.test(label) && !button.closest("[data-testid*='audio'], [data-testid*='voice'], [aria-label*='read aloud' i]");
    };
    const scope = composerScope();
    const local = scope && Array.from(scope.querySelectorAll("button")).find(enabledGenerationStop);
    if (local)
      return local;
    return Array.from(document.querySelectorAll("button[data-testid='stop-button']")).find(enabledGenerationStop) ?? null;
  }
  function readComposer(element) {
    if (element instanceof HTMLTextAreaElement)
      return element.value;
    return plainText(element).replace(/\u00a0/g, " ");
  }
  function plainText(element) {
    let text = "";
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 3) {
        text += child.textContent ?? "";
        continue;
      }
      if (!(child instanceof HTMLElement))
        continue;
      if (child.tagName === "BR") {
        text += `
`;
        continue;
      }
      const block = /^(?:P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(child.tagName);
      if (block && text && !text.endsWith(`
`))
        text += `
`;
      text += plainText(child);
      if (block && child.nextSibling && !text.endsWith(`
`))
        text += `
`;
    }
    return text;
  }
  function writeComposer(element, text) {
    if (!element.isConnected)
      return false;
    if (element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly)
        return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter)
        return false;
      setter.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      if (element.getAttribute("contenteditable") !== "true" || element.getAttribute("aria-disabled") === "true")
        return false;
      element.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (!selection)
        return false;
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch {}
      if (!inserted) {
        element.textContent = text;
        element.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: text,
          inputType: "insertText"
        }));
      }
    }
    return normalizeText(readComposer(element)) === normalizeText(text);
  }
  function hasLoadingState() {
    if (currentProvider() !== "chatgpt")
      return providerLoading(isVisible);
    if (Array.from(document.querySelectorAll("main [role='status'][aria-busy='true'], [role='main'] [role='status'][aria-busy='true']")).some((status) => isVisible(status) && !status.closest("[data-composer-body], form, [data-composer-surface]")))
      return true;
    return Array.from(document.querySelectorAll("main[aria-busy='true'], [role='main'][aria-busy='true'], [data-testid='conversation-loading'], [data-testid='conversation-loading-spinner'], [data-is-streaming='true'], [data-message-author-role='assistant'][aria-busy='true'], [data-markdown-text-style='assistant-message'][aria-busy='true']")).some(isVisible);
  }
  function isChatBusy() {
    const scope = composerScope();
    if (scope && Array.from(scope.querySelectorAll("button")).some((button) => isVisible(button) && isStopControl(button)))
      return true;
    if (Array.from(document.querySelectorAll("button[data-testid='stop-button']")).some(isVisible))
      return true;
    if (Array.from(document.querySelectorAll("[data-markdown-animated]")).some((body) => isVisible(body) && !body.closest("[data-chatgpt-selection-message-id], [data-message-id]")))
      return true;
    return hasLoadingState();
  }
  function hasComposerAttachments() {
    const scope = composerScope();
    if (!scope)
      return false;
    if (Array.from(scope.querySelectorAll("input[type='file']")).some((input) => (input.files?.length ?? 0) > 0))
      return true;
    const previews = scope.querySelectorAll("[data-file-id], [data-attachment-id], [data-testid='attachment'], [data-testid*='file-preview'], [data-testid*='attachment-preview'], [data-testid*='image-preview'], [data-test-id*='file-preview'], [data-test-id*='attachment-preview'], uploaded-file, file-preview, img[src^='blob:'], img[src^='data:']");
    if (Array.from(previews).some(isVisible))
      return true;
    return Array.from(scope.querySelectorAll("button")).some((button) => {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
      return isVisible(button) && /\b(?:remove|delete)\b.*\b(?:attachment|file|image|upload)\b/i.test(label);
    });
  }
  function messageId(element) {
    const wrapper = element.closest("[data-chatgpt-selection-message-id], [data-message-id]") || element.querySelector("[data-chatgpt-selection-message-id], [data-message-id]");
    const stableId = wrapper?.getAttribute("data-chatgpt-selection-message-id") || wrapper?.getAttribute("data-message-id");
    if (stableId)
      return stableId;
    const unit = element.closest("[data-chatgpt-search-message-ids]");
    return unit?.getAttribute("data-chatgpt-search-message-ids")?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
  }
  function normalizeText(text) {
    return text.replace(/\r\n/g, `
`).replace(/\u00a0/g, " ").trim();
  }
  function visibleMessages(roleFilter) {
    if (currentProvider() !== "chatgpt")
      return providerMessages(isVisible, plainText, roleFilter);
    const records = [];
    const seen = new Set;
    const selector = roleFilter === "user" ? USER_SELECTOR : roleFilter === "assistant" ? ASSISTANT_SELECTOR : MESSAGE_SELECTOR;
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (!isVisible(element))
        continue;
      const id = messageId(element);
      if (!id || seen.has(id))
        continue;
      const role = element.matches(USER_SELECTOR) ? "user" : "assistant";
      const body = element.querySelector(role === "user" ? "[data-user-message-bubble='true'], [data-markdown-text-style='user-message'], [data-chatgpt-selection-message-id], [data-message-author-role='user']" : "[data-markdown-text-style='assistant-message']") ?? element;
      const copy = body.cloneNode(true);
      copy.querySelectorAll("button, [role='button'], script, style").forEach((node) => node.remove());
      const text = normalizeText(plainText(copy));
      if (!text)
        continue;
      seen.add(id);
      records.push({ id, text, role, element });
    }
    return records;
  }
  function getVisibleUserMessages() {
    return visibleMessages("user").map(({ id, text }) => ({ id, text }));
  }
  function visibleConversationIds() {
    return Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]")).filter(isVisible).map((marker) => marker.getAttribute("data-chatgpt-selection-conversation-id"));
  }
  function registerNewConversationAlias(routeKey, firstMessageText) {
    if (!routeKey.startsWith("chatgpt:") || getQueueKey(window.location.href) !== routeKey)
      return false;
    if (conversationAlias && conversationAlias.routeKey !== routeKey)
      return false;
    const firstUser = getVisibleUserMessages()[0];
    const collapse = (text) => text.replace(/\s+/g, " ").trim();
    if (!firstUser || !UUID_PATTERN.test(firstUser.id) || !firstMessageText.trim() || collapse(firstUser.text) !== collapse(firstMessageText))
      return false;
    const markerIds = visibleConversationIds();
    const localId = markerIds[0];
    if (!localId?.startsWith("local-chatgpt:") || !UUID_PATTERN.test(localId.slice("local-chatgpt:".length)) || markerIds.some((id) => id !== localId))
      return false;
    if (conversationAlias && (conversationAlias.localId !== localId || conversationAlias.firstUserId !== firstUser.id))
      return false;
    conversationAlias = { routeKey, localId, firstUserId: firstUser.id };
    return true;
  }
  function clearConversationAlias() {
    conversationAlias = null;
  }
  function currentConversationMessages() {
    const key = getQueueKey(window.location.href);
    if (!key || !findQueueComposer() || currentProvider() === "chatgpt" && hasLoadingState())
      return null;
    const messages = visibleMessages();
    if (!messages.length)
      return null;
    if (currentProvider() !== "chatgpt")
      return providerConversationReady(key, messages) ? messages : null;
    if (key.startsWith("chatgpt:")) {
      const id = key.slice("chatgpt:".length);
      const markerIds = visibleConversationIds();
      if (!markerIds.length)
        return null;
      if (markerIds.some((markerId) => markerId !== id)) {
        if (!conversationAlias || conversationAlias.routeKey !== key || markerIds.some((markerId) => markerId !== conversationAlias.localId) || !messages.some((message) => message.role === "user" && message.id === conversationAlias.firstUserId))
          return null;
      }
    }
    return messages;
  }
  function isCurrentConversationReady() {
    return currentConversationMessages() !== null;
  }
  function getStableUserMessageAnchor(userId) {
    if (currentProvider() !== "gemini" || !/^gemini:user:user-query-content-\d+:[a-z0-9]+$/.test(userId))
      return null;
    const messages = currentConversationMessages();
    if (!messages)
      return null;
    const user = messages.find((message) => message.role === "user" && message.id === userId);
    const turn = user?.element.closest(".conversation-container[id]");
    return turn && /^[0-9a-f]{16}$/i.test(turn.id) ? `gemini:user:${turn.id}` : null;
  }
  function getAssistantCompletionAfter(userId) {
    if (isChatBusy())
      return false;
    const messages = currentConversationMessages();
    if (!messages)
      return false;
    const userIndex = messages.findIndex((message) => message.role === "user" && (message.id === userId || currentProvider() === "gemini" && userId === `gemini:user:${message.element.closest(".conversation-container[id]")?.id}`));
    if (userIndex < 0)
      return false;
    let assistant;
    for (const message of messages.slice(userIndex + 1)) {
      if (message.role === "user")
        break;
      assistant = message;
    }
    if (!assistant)
      return false;
    if (currentProvider() !== "chatgpt")
      return providerCompletion(assistant, isVisible);
    let container = assistant.element;
    for (let depth = 0;container && depth < 8; depth++, container = container.parentElement) {
      if (container === document.body || container.matches("main, [role='main']"))
        break;
      const containedMessages = messages.filter((message) => container.contains(message.element));
      if (containedMessages.some((message) => message.role === "user" ? message.id !== userId : message.id !== assistant.id))
        break;
      const controls = Array.from(container.querySelectorAll("button")).filter(isVisible);
      if (controls.some((button) => /^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(button.getAttribute("data-testid") ?? "")))
        return true;
      const labels = controls.filter((button) => !button.closest(ASSISTANT_SELECTOR)).map((button) => (button.getAttribute("aria-label") ?? "").trim().toLowerCase());
      if (labels.includes("rate response") && (labels.includes("copy") || labels.includes("copy response")))
        return true;
    }
    return false;
  }
  function getProviderName() {
    return currentProvider() === "claude" ? "Claude" : currentProvider() === "gemini" ? "Gemini" : "ChatGPT";
  }
  function findAssistantMessageElement(node) {
    const element = node instanceof HTMLElement ? node : node?.parentElement;
    if (!element)
      return null;
    if (currentProvider() !== "chatgpt")
      return providerAssistantElements().find((body) => body === element || body.contains(element)) ?? null;
    return element.closest("[data-message-author-role='assistant']") ?? element.closest("[data-markdown-text-style='assistant-message']");
  }
  function getAssistantMessageElements() {
    if (currentProvider() !== "chatgpt")
      return providerAssistantElements();
    return [...new Set(Array.from(document.querySelectorAll(ASSISTANT_SELECTOR)).map(findAssistantMessageElement).filter((element) => element !== null))];
  }
  function getAssistantMessageId(element) {
    if (currentProvider() !== "chatgpt")
      return providerMessageId(element, plainText(element));
    return messageId(element);
  }

  // src/queue-ui.ts
  var ROOT = "plannotator-message-queue";
  var POLL_MS = 900;
  var SEND_DRAFT_WARNING = "Queue or clear the current draft before using Send now.";
  var EDIT_DRAFT_WARNING = "Queue or clear the current draft before editing a queued message.";
  var normalize = (text) => text.replace(/\r\n/g, `
`).replace(/\u00a0/g, " ").trim();
  var escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  var grip = icon("grip", 18, "grip");

  class MessageQueue {
    runtime;
    clientId = crypto.randomUUID();
    key = null;
    state = null;
    error = "";
    expanded = true;
    editing = null;
    editToken = null;
    editBaseText = "";
    editingBusy = false;
    editRevision = 0;
    saving = false;
    dispatching = false;
    nativeDispatch = false;
    polling = false;
    tickPending = false;
    tickTimer = 0;
    observer = null;
    domWaiters = new Set;
    temporaryAnchors = new Set;
    signature = "";
    dragId = null;
    pointerDrag = null;
    pendingSave = null;
    firstSend = null;
    pollTimer = 0;
    lastPoll = 0;
    retryAfter = 0;
    host = document.createElement("div");
    shadow = this.host.attachShadow({ mode: "open" });
    panel = document.createElement("section");
    abort = new AbortController;
    constructor(runtime) {
      this.runtime = runtime;
    }
    start() {
      if (document.getElementById(ROOT))
        return;
      this.host.id = ROOT;
      this.host.style.cssText = "position:fixed;z-index:2147483645;pointer-events:none;display:none";
      this.shadow.innerHTML = `<style>
      :host{color-scheme:light dark;font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:light-dark(#242424,#eee)}
      *{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:8px;padding:5px 8px;background:transparent;color:inherit}
      button:hover{background:light-dark(#e9e9e9,#3a3a3a)}button:disabled{opacity:.4;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid #458cff;outline-offset:2px}
      section{pointer-events:auto;background:light-dark(#fafafa,#232323);border:1px solid light-dark(#dedede,#444);border-radius:16px;box-shadow:0 4px 18px #00000010;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;padding:7px 9px;min-height:42px}.title{font-weight:600;flex:1;text-align:left}.count{font-size:11px;opacity:.65;margin-left:4px}.add{background:light-dark(#222,#eee);color:light-dark(#fff,#222);font-weight:600}.add:hover{opacity:.85;background:light-dark(#222,#eee)}
      ol{padding:0;margin:0;list-style:none;max-height:240px;overflow:auto}li{position:relative;padding:9px 12px;border-top:1px solid light-dark(#e5e5e5,#3c3c3c);display:flex;gap:9px;align-items:flex-start}.order-slot{position:relative;flex:0 0 18px;width:18px;height:24px;padding:0;border-radius:4px;display:grid;place-items:center}.num{opacity:.45;font-size:11px;transition:opacity 140ms ease}.drag-handle{cursor:grab;user-select:none}.drag-handle:hover{background:transparent}.grip{position:absolute;opacity:0;transition:opacity 140ms ease;pointer-events:none}.drag-handle:active{cursor:grabbing}li:hover .drag-handle .num,.drag-handle:focus-visible .num,li.dragging .num{opacity:0}li:hover .grip,.drag-handle:focus-visible .grip,li.dragging .grip{opacity:.65}li.dragging .body{opacity:.5}li.drop-before{box-shadow:inset 0 2px #458cff}li.drop-after{box-shadow:inset 0 -2px #458cff}.body{flex:1;min-width:0}.text{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.status{font-size:11px;opacity:.7;margin-top:3px}.tools{display:flex;align-items:center;gap:1px}.tools button{padding:3px 6px}textarea{display:block;width:100%;min-height:70px;resize:vertical;border:1px solid light-dark(#bbb,#555);border-radius:8px;background:light-dark(white,#181818);color:inherit;padding:8px}.edit-tools{margin-top:6px;display:flex;gap:6px}
      .error{padding:8px 12px;color:light-dark(#9b3025,#ffb3a9);border-top:1px solid light-dark(#e5e5e5,#444)}.review{color:light-dark(#9b3025,#ffb3a9)}
      @media(max-height:650px){ol{max-height:150px}}
      .drag-handle{touch-action:none}
      .icon{display:block;flex:none;pointer-events:none}button{display:inline-flex;align-items:center;justify-content:center;gap:5px}.title{justify-content:flex-start}.count{margin-left:0}.tools button{width:28px;height:28px;padding:5px}.icon-loader{animation:queue-icon-spin 800ms linear infinite}
      @keyframes queue-icon-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.num,.grip{transition:none}.icon-loader{animation:none}}
    </style>`;
      this.panel.setAttribute("aria-label", "Message queue");
      this.shadow.append(this.panel);
      document.body.append(this.host);
      const options = { capture: true, signal: this.abort.signal };
      window.addEventListener("keydown", (event) => this.onKey(event), options);
      window.addEventListener("click", (event) => this.onNativeClick(event), options);
      window.addEventListener("submit", (event) => {
        if (this.nativeDispatch)
          return;
        const composer = findQueueComposer();
        if (composer && event.target instanceof Element && event.target.contains(composer) && this.shouldQueue()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.enqueue();
        }
      }, options);
      document.addEventListener("input", () => {
        queueMicrotask(() => {
          if (this.abort.signal.aborted)
            return;
          this.render();
          this.scheduleTick();
        });
      }, { signal: this.abort.signal });
      document.addEventListener("visibilitychange", () => this.scheduleTick(), { signal: this.abort.signal });
      window.addEventListener("resize", () => this.position(), { signal: this.abort.signal });
      document.addEventListener("scroll", () => this.position(), { capture: true, passive: true, signal: this.abort.signal });
      this.shadow.addEventListener("click", (event) => {
        this.onAction(event);
      });
      this.shadow.addEventListener("pointerdown", (raw) => {
        const event = raw;
        const handle = event.target.closest(".drag-handle");
        const id = handle?.closest("li[data-id]")?.dataset.id;
        if (event.button !== 0 || !handle || !id || this.state?.items.find((item) => item.id === id)?.status !== "queued")
          return;
        event.preventDefault();
        handle.focus({ preventScroll: true });
        this.pointerDrag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, handle };
        this.host.dataset.reloadBlocked = "true";
        handle.setPointerCapture?.(event.pointerId);
      });
      this.shadow.addEventListener("pointermove", (raw) => {
        const event = raw;
        const held = this.pointerDrag;
        if (!held || event.pointerId !== held.pointerId)
          return;
        if (!this.dragId && Math.hypot(event.clientX - held.x, event.clientY - held.y) < 4)
          return;
        this.dragId = held.id;
        held.handle.closest("li")?.classList.add("dragging");
        this.host.dataset.reloadBlocked = "true";
        const rows = Array.from(this.shadow.querySelectorAll("li[data-id]"));
        const row = rows.find((entry) => {
          const rect = entry.getBoundingClientRect();
          return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
        held.toId = row?.dataset.id;
        rows.forEach((entry) => entry.classList.remove("drop-before", "drop-after"));
        const from = this.state?.items.findIndex((item) => item.id === held.id) ?? -1;
        const to = this.state?.items.findIndex((item) => item.id === held.toId) ?? -1;
        if (row && from >= 0 && to >= 0 && from !== to)
          row.classList.add(from > to ? "drop-before" : "drop-after");
      });
      this.shadow.addEventListener("pointerup", (raw) => {
        const event = raw;
        const held = this.pointerDrag;
        if (!held || event.pointerId !== held.pointerId)
          return;
        const from = this.state?.items.findIndex((item) => item.id === this.dragId) ?? -1;
        const to = this.state?.items.findIndex((item) => item.id === held.toId) ?? -1;
        this.clearDrag();
        if (from !== to && from >= 0 && to >= 0)
          this.change("move", { id: held.id, delta: to - from });
      });
      this.shadow.addEventListener("pointercancel", () => this.clearDrag());
      this.shadow.addEventListener("lostpointercapture", () => {
        if (this.pointerDrag)
          this.clearDrag();
      });
      this.shadow.addEventListener("keydown", (raw) => {
        const event = raw;
        if (event.key === "Escape" && this.pointerDrag) {
          event.preventDefault();
          event.stopPropagation();
          this.clearDrag();
          return;
        }
        const handle = event.target.closest(".drag-handle");
        if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const id = handle.closest("li[data-id]")?.dataset.id;
        if (id)
          this.change("move", { id, delta: event.key === "ArrowUp" ? -1 : 1 }).then(() => {
            const row = Array.from(this.shadow.querySelectorAll("li[data-id]")).find((entry) => entry.dataset.id === id);
            row?.querySelector(".drag-handle")?.focus();
          });
      });
      this.shadow.addEventListener("dragstart", (raw) => {
        const event = raw;
        const handle = event.target.closest(".drag-handle");
        const row = handle?.closest("li[data-id]");
        const id = row?.dataset.id;
        if (!id || this.state?.items.find((item) => item.id === id)?.status !== "queued") {
          event.preventDefault();
          return;
        }
        this.dragId = id;
        row.classList.add("dragging");
        this.host.dataset.reloadBlocked = "true";
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
          event.dataTransfer.setDragImage(row, 18, 18);
        }
      });
      this.shadow.addEventListener("dragover", (raw) => {
        if (!this.dragId)
          return;
        const event = raw;
        const row = event.target.closest("li[data-id]");
        const from = this.state?.items.findIndex((item) => item.id === this.dragId) ?? -1;
        const to = this.state?.items.findIndex((item) => item.id === row?.dataset.id) ?? -1;
        this.shadow.querySelectorAll(".drop-before,.drop-after").forEach((entry) => entry.classList.remove("drop-before", "drop-after"));
        if (!row || from < 0 || to < 0)
          return;
        event.preventDefault();
        if (event.dataTransfer)
          event.dataTransfer.dropEffect = "move";
        if (from !== to)
          row.classList.add(from > to ? "drop-before" : "drop-after");
      });
      this.shadow.addEventListener("drop", (event) => {
        event.preventDefault();
        const toId = event.target.closest("li[data-id]")?.dataset.id;
        const fromId = this.dragId;
        this.clearDrag();
        if (!fromId || !toId || !this.state)
          return;
        const from = this.state.items.findIndex((item) => item.id === fromId);
        const to = this.state.items.findIndex((item) => item.id === toId);
        if (from !== to && from >= 0 && to >= 0)
          this.change("move", { id: fromId, delta: to - from });
      });
      this.shadow.addEventListener("dragend", () => this.clearDrag());
      this.runtime.onMessage?.addListener((message) => {
        if (message.type === "plannotator:queue:changed" && message.key === this.key)
          this.scheduleTick();
      });
      this.observer = new MutationObserver((records) => {
        if (records.every((record) => record.target === this.host || this.host.contains(record.target)))
          return;
        for (const wake of this.domWaiters)
          wake();
        if (!this.state?.items.length || this.dispatching || this.saving || isChatBusy())
          return;
        this.scheduleTick();
      });
      this.observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "title", "disabled", "aria-disabled", "hidden", "aria-hidden", "class", "data-testid", "data-is-streaming", "data-perf-row-streaming", "aria-busy", "data-status"]
      });
      this.pollTimer = window.setInterval(() => {
        this.tick();
      }, POLL_MS);
      this.tick();
    }
    stop() {
      clearInterval(this.pollTimer);
      clearTimeout(this.tickTimer);
      this.observer?.disconnect();
      this.abort.abort();
      for (const wake of this.domWaiters)
        wake();
      this.host.remove();
    }
    waitForDomChange(timeoutMs) {
      if (this.abort.signal.aborted)
        return Promise.resolve();
      return new Promise((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.domWaiters.delete(wake);
          resolve();
        };
        const timer = window.setTimeout(wake, timeoutMs);
        this.domWaiters.add(wake);
      });
    }
    scheduleTick() {
      if (this.abort.signal.aborted)
        return;
      this.tickPending = true;
      if (this.tickTimer || this.polling || this.dispatching || this.saving || this.editingBusy)
        return;
      this.tickTimer = window.setTimeout(() => {
        this.tickTimer = 0;
        this.tickPending = false;
        this.tick(true);
      }, 0);
    }
    clearDrag() {
      const held = this.pointerDrag;
      this.pointerDrag = null;
      if (held?.handle.hasPointerCapture?.(held.pointerId))
        held.handle.releasePointerCapture(held.pointerId);
      this.dragId = null;
      this.shadow.querySelectorAll(".dragging,.drop-before,.drop-after").forEach((row) => row.classList.remove("dragging", "drop-before", "drop-after"));
      this.render();
    }
    syncRoute() {
      const key = getQueueKey(location.href);
      if (key !== this.key) {
        clearConversationAlias();
        if (!this.key && key?.startsWith("chatgpt:") && this.firstSend && !this.firstSend.key && Date.now() < this.firstSend.expiresAt) {
          this.firstSend.key = key;
        } else
          this.firstSend = null;
        this.key = key;
        this.state = null;
        this.editing = null;
        this.editToken = null;
        this.error = "";
        this.temporaryAnchors.clear();
        this.editRevision++;
        this.retryAfter = 0;
        this.pendingSave = null;
        this.signature = "";
      }
      if (key && this.firstSend?.key === key && registerNewConversationAlias(key, this.firstSend.text))
        this.firstSend = null;
      return key;
    }
    captureFirstSend() {
      if (location.hostname !== "chatgpt.com" || location.pathname !== "/" || getVisibleUserMessages().length || Array.from(document.querySelectorAll("[data-markdown-text-style='assistant-message'],[data-message-author-role='assistant'],[data-chatgpt-selection-conversation-id]")).some((element) => element.getClientRects().length))
        return;
      const composer = findQueueComposer();
      const text = composer && readComposer(composer);
      if (text?.trim() && !hasComposerAttachments())
        this.firstSend = { text, expiresAt: Date.now() + 120000 };
    }
    async request(action, extra = {}, key = this.key) {
      if (!key)
        throw new Error(`Open a saved ${getProviderName()} conversation to use the queue.`);
      const reply = await this.runtime.sendMessage({ type: QUEUE_MESSAGE_TYPE, key, clientId: this.clientId, action, ...extra });
      if (!reply?.ok || !reply.state)
        throw new Error(reply?.error || "The queue is unavailable. Reload the extension and this tab.");
      if (key === getQueueKey(location.href) && key === this.key && (!this.state || reply.state.revision >= this.state.revision)) {
        this.state = reply.state;
      }
      return { state: reply.state, claimed: reply.claimed };
    }
    async change(action, extra = {}) {
      try {
        await this.request(action, extra);
        this.error = "";
      } catch (error) {
        this.error = this.describe(error);
      }
      this.render();
    }
    async tick(immediate = false) {
      if (this.polling || this.dispatching || this.saving || this.editingBusy || this.abort.signal.aborted || !immediate && Date.now() - this.lastPoll < 400)
        return;
      this.lastPoll = Date.now();
      this.polling = true;
      let editRevision = this.editRevision;
      try {
        const key = this.syncRoute();
        editRevision = this.editRevision;
        if (!key) {
          this.render();
          return;
        }
        const busy = isChatBusy();
        await this.request("heartbeat", { busy });
        if (key !== this.syncRoute() || editRevision !== this.editRevision || this.editingBusy)
          return;
        if (this.editing && this.editToken) {
          const edited = this.state?.items.find((item) => item.id === this.editing);
          if (edited?.status === "editing" && edited.editToken === this.editToken) {
            await this.request("edit-heartbeat", { id: this.editing, editToken: this.editToken }, key);
            if (editRevision !== this.editRevision || this.editingBusy)
              return;
          }
        }
        const previousAnchor = this.state?.lastCompletedUserMessageId;
        const stableAnchor = previousAnchor && this.canUseAnchor(previousAnchor) && getStableUserMessageAnchor(previousAnchor);
        if (stableAnchor && stableAnchor !== previousAnchor) {
          await this.request("anchor", { userMessageId: previousAnchor, afterUserMessageId: stableAnchor }, key);
          if (key !== this.syncRoute() || editRevision !== this.editRevision || this.editingBusy)
            return;
        }
        for (let item of this.state?.items ?? []) {
          if (item.status === "waiting" && item.userMessageId && this.canUseAnchor(item.userMessageId)) {
            const stable = getStableUserMessageAnchor(item.userMessageId);
            if (stable && stable !== item.userMessageId) {
              const result = await this.request("anchor", { id: item.id, userMessageId: item.userMessageId, afterUserMessageId: stable }, key);
              if (key !== this.syncRoute() || editRevision !== this.editRevision || this.editingBusy)
                return;
              const updated = result.state.items.find((entry) => entry.id === item.id);
              if (!updated)
                continue;
              item = updated;
            }
          }
          if (item.status === "waiting" && item.userMessageId && this.canUseAnchor(item.userMessageId) && !busy && getAssistantCompletionAfter(item.userMessageId)) {
            await this.request("complete", { id: item.id, userMessageId: item.userMessageId }, key);
          }
        }
        this.render();
        if (this.canDispatch())
          await this.dispatch();
      } catch (error) {
        if (editRevision === this.editRevision && !this.editingBusy) {
          this.error = this.describe(error);
          this.render();
        }
      } finally {
        this.polling = false;
        if (this.tickPending)
          this.scheduleTick();
      }
    }
    shouldQueue() {
      return Boolean(this.syncRoute() && (!this.state || this.editing || isChatBusy() || this.state.paused || this.state.items.length));
    }
    onKey(event) {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.repeat)
        return;
      const composer = findQueueComposer();
      const target = event.composedPath()[0];
      if (!composer || !(target instanceof Node) || !composer.contains(target))
        return;
      if (!this.shouldQueue()) {
        this.captureFirstSend();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.enqueue();
    }
    onNativeClick(event) {
      if (this.nativeDispatch)
        return;
      const send = findQueueSendButton();
      if (!send || !event.composedPath().includes(send))
        return;
      if (!this.shouldQueue()) {
        this.captureFirstSend();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.enqueue();
    }
    async enqueue() {
      if (this.editing) {
        await this.saveEdit();
        return;
      }
      if (this.saving || this.dispatching)
        return;
      const key = this.syncRoute();
      const composer = findQueueComposer();
      const text = composer ? readComposer(composer) : "";
      if (!key || !composer || !text.trim())
        return;
      if (hasComposerAttachments()) {
        this.error = "Queue supports text messages. Send attachments directly after this response finishes.";
        this.render();
        return;
      }
      this.saving = true;
      this.error = "";
      if (!this.pendingSave || this.pendingSave.text !== text || this.pendingSave.key !== key) {
        this.pendingSave = { id: crypto.randomUUID(), text, key };
      }
      this.render();
      try {
        const pending = this.pendingSave;
        const wasEmpty = this.state?.items.length === 0;
        const previous = getVisibleUserMessages().at(-1)?.id;
        const afterUserMessageId = previous && (getStableUserMessageAnchor(previous) ?? previous);
        const result = await this.request("enqueue", { id: pending.id, text, afterUserMessageId }, key);
        if (key === this.syncRoute() && wasEmpty && afterUserMessageId && result.state.items[0]?.id === pending.id && result.state.lastCompletedUserMessageId === afterUserMessageId)
          this.temporaryAnchors.add(afterUserMessageId);
        if (key === this.syncRoute() && composer.isConnected && readComposer(composer) === text) {
          if (!writeComposer(composer, ""))
            this.error = "Saved to queue. Clear the composer to continue.";
          else
            this.pendingSave = null;
        } else {
          this.pendingSave = null;
        }
        this.expanded = true;
      } catch (error) {
        this.error = `${this.describe(error)} Your draft is still in the composer.`;
      } finally {
        this.saving = false;
        this.render();
        this.scheduleTick();
      }
    }
    canDispatch() {
      const composer = findQueueComposer();
      return Boolean(this.state && this.state.items.length && !this.state.paused && Date.now() >= this.retryAfter && !this.state.items.some((item) => item.status !== "queued") && document.visibilityState === "visible" && !this.editing && !this.saving && !this.dragId && !this.pointerDrag && composer && !readComposer(composer).trim() && !hasComposerAttachments() && !isChatBusy() && this.transcriptReady());
    }
    transcriptReady() {
      return this.state?.lastCompletedUserMessageId ? this.canUseAnchor(this.state.lastCompletedUserMessageId) && getAssistantCompletionAfter(this.state.lastCompletedUserMessageId) : isCurrentConversationReady();
    }
    canUseAnchor(userId) {
      return !userId.startsWith("gemini:user:user-query-content-") || this.temporaryAnchors.has(userId);
    }
    async dispatch(sendNowId) {
      if (this.dispatching || this.saving || this.editing)
        return;
      const sendNow = Boolean(sendNowId);
      if (!sendNow && !this.canDispatch())
        return;
      if (sendNow) {
        this.syncRoute();
        const composer2 = findQueueComposer();
        if (!composer2) {
          this.error = "Wait for the message input to finish loading before using Send now.";
          this.render();
          return;
        }
        if (readComposer(composer2).trim() || hasComposerAttachments()) {
          this.error = SEND_DRAFT_WARNING;
          this.render();
          return;
        }
        if (!isCurrentConversationReady() || document.visibilityState !== "visible") {
          this.error = "Wait for this conversation to finish loading before using Send now.";
          this.render();
          return;
        }
      }
      this.dispatching = true;
      this.host.dataset.reloadBlocked = "true";
      const key = this.key;
      let item;
      let attempted = false;
      let postedUserMessageId;
      let composer = null;
      let clicked = false;
      try {
        item = (await this.request(sendNow ? "steer" : "claim", sendNow ? { id: sendNowId } : { afterUserMessageId: this.state?.lastCompletedUserMessageId }, key)).claimed;
        if (!item)
          return;
        this.error = "";
        this.render();
        composer = findQueueComposer();
        if (key !== this.syncRoute() || !composer || !isCurrentConversationReady() || readComposer(composer).trim() || hasComposerAttachments() || document.visibilityState !== "visible") {
          await this.request("release", { id: item.id }, key);
          return;
        }
        if (sendNow && isChatBusy()) {
          const stop = findQueueStopButton();
          if (!stop)
            throw new Error("The current response cannot be stopped yet. The message remains queued.");
          composer.setAttribute("data-plannotator-queued-send", item.id);
          try {
            stop.click();
          } finally {
            composer.removeAttribute("data-plannotator-queued-send");
          }
          const deadline2 = Date.now() + 7000;
          while (isChatBusy() && key === this.syncRoute() && !this.abort.signal.aborted && Date.now() < deadline2) {
            await this.waitForDomChange(200);
          }
          if (isChatBusy())
            throw new Error("The response is still stopping. The message remains queued.");
        }
        const ready = () => sendNow ? isCurrentConversationReady() : this.transcriptReady();
        composer = findQueueComposer();
        if (key !== this.syncRoute() || !composer || readComposer(composer).trim() || isChatBusy() || !ready() || document.visibilityState !== "visible" || hasComposerAttachments()) {
          await this.request("release", { id: item.id }, key);
          return;
        }
        const before = new Set(getVisibleUserMessages().map((message) => message.id));
        if (!writeComposer(composer, item.text))
          throw new Error("Could not fill the composer. The message remains saved.");
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        const composerDeadline = Date.now() + 1000;
        while (!findQueueSendButton() && Date.now() < composerDeadline && key === this.syncRoute() && !this.abort.signal.aborted && !isChatBusy() && composer.isConnected && normalize(readComposer(composer)) === normalize(item.text)) {
          await this.waitForDomChange(100);
        }
        if (this.abort.signal.aborted || key !== this.syncRoute() || isChatBusy() || !composer.isConnected || normalize(readComposer(composer)) !== normalize(item.text) || hasComposerAttachments() || !findQueueSendButton() || !ready() || document.visibilityState !== "visible") {
          throw new Error("The conversation changed before sending. The message remains saved.");
        }
        await this.request("attempt", { id: item.id }, key);
        attempted = true;
        this.render();
        const send = findQueueSendButton();
        if (this.abort.signal.aborted || !send || key !== this.syncRoute() || isChatBusy() || !composer.isConnected || normalize(readComposer(composer)) !== normalize(item.text) || hasComposerAttachments() || !ready()) {
          throw new Error("Send was interrupted. Check the conversation before retrying.");
        }
        clicked = true;
        this.nativeDispatch = true;
        composer.setAttribute("data-plannotator-queued-send", item.id);
        try {
          send.click();
        } finally {
          this.nativeDispatch = false;
          composer.removeAttribute("data-plannotator-queued-send");
        }
        const deadline = Date.now() + 15000;
        while (!this.abort.signal.aborted && Date.now() < deadline && key === this.syncRoute()) {
          const posted = getVisibleUserMessages().find((message) => !before.has(message.id) && normalize(message.text) === normalize(item.text));
          if (posted) {
            this.temporaryAnchors.add(posted.id);
            postedUserMessageId = getStableUserMessageAnchor(posted.id) ?? posted.id;
            await this.request("ack", { id: item.id, userMessageId: postedUserMessageId }, key);
            this.error = "";
            return;
          }
          await this.waitForDomChange(300);
        }
        throw new Error("Could not confirm the send. Check the conversation before retrying.");
      } catch (error) {
        if (item) {
          try {
            const result = await this.request(attempted ? "review" : "release", { id: item.id, reason: this.describe(error) }, key);
            if (attempted && result.state.items.some((entry) => entry.id === item.id && entry.status === "waiting" && entry.userMessageId)) {
              this.error = "";
              return;
            }
          } catch {
            if (attempted && postedUserMessageId) {
              try {
                const result = await this.request("read", {}, key);
                if (!result.state.items.some((entry) => entry.id === item.id) && (result.state.lastCompletedUserMessageId === postedUserMessageId || result.state.lastCompletedUserMessageId === getStableUserMessageAnchor(postedUserMessageId))) {
                  this.error = "";
                  return;
                }
              } catch {}
            }
          }
        }
        if (!clicked && composer?.isConnected && key === this.key && item && normalize(readComposer(composer)) === normalize(item.text)) {
          writeComposer(composer, "");
        }
        this.error = this.describe(error);
      } finally {
        if (item && !attempted)
          this.retryAfter = Date.now() + 1000;
        this.dispatching = false;
        this.render();
        if (this.tickPending)
          this.scheduleTick();
      }
    }
    async onAction(event) {
      const button = event.target?.closest("button[data-action]");
      if (!button || button.disabled)
        return;
      const id = button.closest("[data-id]")?.dataset.id;
      switch (button.dataset.action) {
        case "enqueue":
          await this.enqueue();
          break;
        case "expand":
          this.expanded = !this.expanded;
          this.render();
          break;
        case "pause":
          await this.change("pause", { paused: !this.state?.paused });
          break;
        case "remove":
          if (id)
            await this.removeItem(id);
          break;
        case "edit":
          if (id)
            await this.beginEdit(id);
          break;
        case "steer":
          if (id)
            await this.dispatch(id);
          break;
        case "save":
          await this.saveEdit();
          break;
        case "cancel-edit":
          await this.cancelEdit();
          break;
        case "retry":
          if (id)
            await this.change("retry", { id });
          break;
        case "resolve":
          if (id)
            await this.change("remove", { id });
          break;
        case "check":
          this.error = "";
          this.lastPoll = 0;
          await this.tick();
          break;
      }
    }
    async saveEdit() {
      if (!this.editing || !this.editToken || this.editingBusy || this.saving || this.dispatching)
        return;
      const key = this.key;
      const id = this.editing;
      const composer = findQueueComposer();
      const text = composer ? readComposer(composer) : "";
      if (!key || !composer || !text.trim())
        return;
      if (hasComposerAttachments()) {
        this.error = "Queue edits support text. Remove attachments before saving this edit.";
        this.render();
        return;
      }
      this.editingBusy = true;
      this.editRevision++;
      this.render();
      try {
        await this.request("read", {}, key);
        if (key !== this.syncRoute())
          return;
        const current = this.state?.items.find((item) => item.id === id);
        if (current?.status === "queued" && current.lastEditToken !== this.editToken) {
          const token = crypto.randomUUID();
          this.editToken = token;
          const reserved = (await this.request("begin-edit", { id, editToken: token }, key)).state.items.find((item) => item.id === id);
          if (reserved?.text !== this.editBaseText) {
            await this.request("cancel-edit", { id, editToken: token }, key);
            throw new Error("This queued message changed in another tab. Your draft is still in the composer.");
          }
        }
        await this.request("edit", { id, text, editToken: this.editToken }, key);
        if (key !== this.syncRoute())
          return;
        this.editing = null;
        this.editToken = null;
        this.error = "";
        if (composer.isConnected && readComposer(composer) === text && !writeComposer(composer, "")) {
          this.pendingSave = { id, key, text };
          this.error = "Edit saved in its queue position. Clear the composer to continue.";
        }
      } catch (error) {
        this.error = this.describe(error);
      } finally {
        this.editingBusy = false;
        this.render();
        this.scheduleTick();
      }
    }
    async beginEdit(id) {
      if (this.editing || this.saving || this.dispatching)
        return;
      const key = this.syncRoute();
      const composer = findQueueComposer();
      if (!key || !composer)
        return;
      if (readComposer(composer).trim() || hasComposerAttachments()) {
        this.error = EDIT_DRAFT_WARNING;
        this.render();
        return;
      }
      const token = crypto.randomUUID();
      this.saving = true;
      this.editRevision++;
      this.render();
      try {
        await this.request("begin-edit", { id, editToken: token }, key);
        const item = this.state?.items.find((entry) => entry.id === id);
        if (key !== this.syncRoute() || !item || !composer.isConnected || readComposer(composer).trim() || hasComposerAttachments()) {
          await this.request("cancel-edit", { id, editToken: token }, key);
          return;
        }
        this.editing = id;
        this.editToken = token;
        this.editBaseText = item.text;
        if (!writeComposer(composer, item.text)) {
          await this.request("cancel-edit", { id, editToken: token }, key);
          this.editing = null;
          this.editToken = null;
          throw new Error("Could not move the saved message into the composer. It remains queued.");
        }
        composer.focus();
        this.error = "";
        this.expanded = true;
      } catch (error) {
        this.error = this.describe(error);
      } finally {
        this.saving = false;
        this.render();
        if (this.tickPending)
          this.scheduleTick();
      }
    }
    async cancelEdit() {
      if (!this.editing || !this.editToken || this.editingBusy)
        return;
      const key = this.key;
      const composer = findQueueComposer();
      const text = composer && readComposer(composer);
      this.editingBusy = true;
      this.editRevision++;
      try {
        const current = (await this.request("read")).state.items.find((item) => item.id === this.editing);
        if (current?.status === "editing" && current.editToken === this.editToken) {
          await this.request("cancel-edit", { id: this.editing, editToken: this.editToken });
        }
        if (key !== this.syncRoute())
          return;
        this.editing = null;
        this.editToken = null;
        this.error = "";
        if (composer?.isConnected && readComposer(composer) === text)
          writeComposer(composer, "");
      } catch (error) {
        this.error = this.describe(error);
      } finally {
        this.editingBusy = false;
        this.render();
        this.scheduleTick();
      }
    }
    async removeItem(id) {
      const ownedEdit = id === this.editing;
      if (ownedEdit && this.editingBusy)
        return;
      const key = this.key;
      const composer = ownedEdit ? findQueueComposer() : null;
      const text = composer && readComposer(composer);
      if (ownedEdit) {
        this.editingBusy = true;
        this.editRevision++;
      }
      try {
        await this.request("remove", { id, ...ownedEdit ? { editToken: this.editToken } : {} });
        if (ownedEdit && key === this.syncRoute()) {
          this.editing = null;
          this.editToken = null;
          if (composer?.isConnected && readComposer(composer) === text)
            writeComposer(composer, "");
        }
        this.error = "";
      } catch (error) {
        this.error = this.describe(error);
      } finally {
        if (ownedEdit)
          this.editingBusy = false;
        this.render();
        this.scheduleTick();
      }
    }
    render() {
      this.host.dataset.reloadBlocked = String(this.saving || this.dispatching || Boolean(this.editing) || Boolean(this.dragId) || Boolean(this.pointerDrag));
      const composer = findQueueComposer();
      const allItems = this.state?.items ?? [];
      const items = allItems.filter((item) => item.status !== "waiting");
      const draft = composer ? readComposer(composer).trim() : "";
      if (composer && !draft && !hasComposerAttachments() && [SEND_DRAFT_WARNING, EDIT_DRAFT_WARNING].includes(this.error))
        this.error = "";
      const busy = isChatBusy();
      const showAdd = Boolean(draft && (busy || allItems.length || this.state?.paused));
      const unknownAnchor = Boolean(this.state?.lastCompletedUserMessageId && !this.canUseAnchor(this.state.lastCompletedUserMessageId)) || allItems.some((item) => item.status === "waiting" && item.userMessageId && !this.canUseAnchor(item.userMessageId));
      const recovery = !this.error && !this.state?.paused && !busy && !this.dispatching && !this.saving && !this.editing && !draft && getQueueKey(location.href) === this.key && items.some((item) => item.status === "queued") && allItems.every((item) => item.status === "queued" || item.status === "waiting") && unknownAnchor && isCurrentConversationReady() ? "This older queue needs confirmation after reopening. Use Send now on the first message to continue." : "";
      if (!this.key || !composer || !items.length && !showAdd && !this.error && !this.state?.paused) {
        this.host.style.display = "none";
        this.panel.replaceChildren();
        this.signature = "";
        return;
      }
      if (!this.host.isConnected)
        document.body.append(this.host);
      this.host.style.display = "block";
      const signature = JSON.stringify([items, this.state?.paused, showAdd, this.saving, this.editingBusy, this.dispatching, this.expanded, this.editing, this.error, recovery]);
      if (signature !== this.signature && !this.dragId && !this.pointerDrag) {
        this.signature = signature;
        this.panel.innerHTML = `<header>
        <button class="title" data-action="expand" aria-label="${this.expanded ? "Collapse" : "Expand"} message queue" aria-expanded="${this.expanded}">${icon(this.expanded ? "chevron-down" : "chevron-right", 14)}${items.length ? `Queue <span class="count">${items.length}</span>` : "Queue next message"}</button>
        ${items.length || this.state?.paused ? `<button data-action="pause" aria-label="${this.state?.paused ? "Resume" : "Pause"} queue">${icon(this.state?.paused ? "play" : "pause", 14)}${this.state?.paused ? "Resume" : "Pause"}</button>` : ""}
        ${showAdd ? `<button class="add" data-action="enqueue" ${this.saving || this.editingBusy ? "disabled" : ""}>${icon(this.saving || this.editingBusy ? "loader" : this.editing ? "check" : "plus", 14)}${this.saving || this.editingBusy ? "Saving…" : this.editing ? "Save edit" : "Queue message"}</button>` : ""}
      </header>
      ${this.expanded && items.length ? `<ol>${items.map((item, index) => this.itemHtml(item, index)).join("")}</ol>` : ""}
      ${this.error ? `<div class="error" role="status">${escapeHtml(this.error)} <button data-action="check">Check again</button></div>` : recovery ? `<div class="error" role="status">${recovery}</div>` : ""}`;
      }
      this.position();
    }
    itemHtml(item, index) {
      const id = escapeHtml(item.id);
      if (this.editing === item.id)
        return `<li data-id="${id}"><span class="order-slot"><span class="num">${index + 1}</span></span><div class="body"><div class="text">${escapeHtml(item.text)}</div><div class="status">Editing in composer · position reserved</div><div class="edit-tools"><button class="add" data-action="save" ${this.editingBusy ? "disabled" : ""}>Save edit</button><button data-action="cancel-edit" ${this.editingBusy ? "disabled" : ""}>Cancel edit</button></div></div><div class="tools"><button data-action="remove" aria-label="Remove message ${index + 1}" title="Delete queued message" ${this.editingBusy ? "disabled" : ""}>${icon("trash")}</button></div></li>`;
      const pending = item.status === "queued";
      const blocked = Boolean(this.editing || this.saving || this.dispatching || this.state?.items.some((entry) => ["editing", "claimed", "sending", "review"].includes(entry.status)));
      const status = item.status === "editing" ? "Editing in a composer · position reserved" : item.status === "claimed" ? "Preparing…" : item.status === "sending" ? "Confirming send…" : item.status === "review" ? "Send unconfirmed · check this chat before retrying" : "";
      const order = pending ? `<button class="order-slot drag-handle" draggable="true" aria-label="Reorder message ${index + 1}" title="Drag to reorder; use arrow keys when focused"><span class="num" aria-hidden="true">${index + 1}</span>${grip}</button>` : `<span class="order-slot"><span class="num">${index + 1}</span></span>`;
      return `<li data-id="${id}" data-user-message-id="${escapeHtml(item.userMessageId ?? "")}">${order}<div class="body"><div class="text">${escapeHtml(item.text)}</div>${status ? `<div class="status ${item.status === "review" ? "review" : ""}">${status}</div>` : ""}
      ${item.status === "review" ? `<div class="edit-tools"><button data-action="retry" title="Retry only after checking that it was not sent">Retry message</button><button data-action="resolve">Dismiss from queue</button></div>` : ""}</div>
      ${pending ? `<div class="tools"><button data-action="steer" aria-label="Send message ${index + 1} now" title="Send now · stop the current response first" ${blocked ? "disabled" : ""}>${icon("send")}</button><button data-action="edit" aria-label="Edit message ${index + 1}" title="Edit in composer" ${blocked ? "disabled" : ""}>${icon("edit")}</button><button data-action="remove" aria-label="Remove message ${index + 1}" title="Delete queued message">${icon("trash")}</button></div>` : ""}</li>`;
    }
    position() {
      const composer = findQueueComposer();
      if (!composer)
        return;
      const anchor = composerScope(composer) ?? composer;
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight) {
        this.host.style.display = "none";
        return;
      }
      const width = Math.min(Math.max(rect.width, 300), innerWidth - 24);
      this.host.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
      this.host.style.width = `${width}px`;
      this.host.style.bottom = `${Math.max(12, innerHeight - rect.top + 9)}px`;
    }
    describe(error) {
      if (error instanceof Error && /context invalidated|Receiving end|message port/i.test(error.message))
        return "Reload this tab to reconnect the saved queue.";
      return error instanceof Error ? error.message : "Could not save the queue. Please try again.";
    }
  }
  var runtime = globalThis.chrome?.runtime;
  if (window.top === window && runtime?.sendMessage)
    new MessageQueue(runtime).start();
})();

//# debugId=6FBF2730C216BFE464756E2164756E21
//# sourceMappingURL=queue-ui.js.map
