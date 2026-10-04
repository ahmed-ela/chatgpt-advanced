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

  // src/content.ts
  var ROOT_ID = "plannotator-chatgpt-root";
  var STYLE_ID = "plannotator-chatgpt-page-style";
  var MESSAGE_ID_ATTR = "data-plannotator-message-id";
  var STORAGE_KEY_PREFIX = "plannotator-chatgpt-notes:v1:";
  var HIGHLIGHT_NAME = "plannotator-notes";
  var ACTIVE_HIGHLIGHT_NAME = "plannotator-note-active";
  var MAX_EXCERPT = 120;
  var CONTEXT_WINDOW = 48;
  var POPOVER_WIDTH = 260;
  var POPOVER_GAP = 14;
  var SELECTION_SETTLE_MS = 140;
  var NOTE_MAX_ROWS = 4;
  var ACTION_SUCCESS_MS = 1400;
  var PERSIST_DEBOUNCE_MS = 120;
  var CONVERSATION_POLL_MS = 400;
  var DEV_POLL_INTERVAL_MS = 700;
  var DEV_ENABLED = true;
  var DEV_BUILD_ID = "mute98hi-rexalk";
  var state = {
    notes: [],
    activeNoteId: null,
    selectionDraft: null,
    draftEditorOpen: false,
    draftText: "",
    notesMenuOpen: false,
    actionFeedback: "idle",
    actionError: ""
  };
  var annotationSessions = new Map;
  var annotationUi = null;
  var selectionFrame = 0;
  var selectionSettleTimer = null;
  var selectionVersion = 0;
  var draftFocusFrame = 0;
  var draftFocusVersion = 0;
  var renderFrame = 0;
  var actionFeedbackTimer = null;
  var persistTimer = null;
  var currentConversationKey = null;
  var pendingRestoreNotes = [];
  var restoreFrame = 0;
  var conversationPollTimer = 0;
  var restoreObserver = null;
  var domRefreshObserver = null;
  var suppressActiveScrollClearUntil = 0;
  if (window.top === window) {
    bootstrap();
  }
  function bootstrap() {
    if (document.getElementById(ROOT_ID))
      return;
    ensurePageStyles();
    const ui = createUi();
    annotationUi = ui;
    if (true)
      startDevHotReload();
    startConversationPersistence(ui);
    startDomRefreshObserver(ui);
    document.addEventListener("selectionchange", () => {
      if (selectionFrame)
        return;
      selectionFrame = window.requestAnimationFrame(() => {
        selectionFrame = 0;
        syncSelectionDraft(ui);
      });
    }, true);
    window.addEventListener("keydown", (event) => {
      const origin = event.composedPath()[0];
      const target = origin instanceof HTMLElement ? origin : null;
      const noteField = (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.getRootNode() === ui.shadow;
      if (noteField)
        event.stopImmediatePropagation();
      const draftField = (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && noteField && target.dataset.field === "draft";
      if (event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "enter") {
          event.preventDefault();
          insertPrompt(ui);
          return;
        }
        if (key === "i") {
          event.preventDefault();
          insertPrompt(ui);
          return;
        }
        if (key === "c") {
          event.preventDefault();
          navigator.clipboard.writeText(buildPrompt());
          return;
        }
        if (key === "k") {
          event.preventDefault();
          clearActionFeedback();
          clearAllNotes();
          render(ui);
          return;
        }
      }
      if (draftField && event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        state.draftText = target.value;
        commitDraftNote();
        render(ui);
        return;
      }
      if (event.key !== "Escape")
        return;
      if (state.notesMenuOpen) {
        state.notesMenuOpen = false;
        render(ui);
        return;
      }
      if (draftField) {
        clearSelectionDraft();
        render(ui);
        return;
      }
      clearSelectionDraft();
      if (state.activeNoteId) {
        state.activeNoteId = null;
      }
      render(ui);
    }, true);
    document.addEventListener("pointerdown", (event) => {
      if (event.composedPath().includes(ui.host))
        return;
      if (!state.activeNoteId && !state.selectionDraft && !state.notesMenuOpen)
        return;
      clearSelectionDraft();
      state.activeNoteId = null;
      state.notesMenuOpen = false;
      scheduleRender(ui);
    }, true);
    window.addEventListener("resize", () => scheduleRender(ui), { passive: true });
    window.addEventListener("scroll", () => handleViewportScroll(ui), { passive: true });
    document.addEventListener("scroll", () => handleViewportScroll(ui), {
      passive: true,
      capture: true
    });
    window.addEventListener("wheel", () => clearActiveNoteFromUserScroll(ui), {
      passive: true,
      capture: true
    });
    window.addEventListener("touchmove", () => clearActiveNoteFromUserScroll(ui), {
      passive: true,
      capture: true
    });
    window.addEventListener("pagehide", () => {
      flushPersistedConversationState();
    }, { capture: true });
    window.addEventListener("beforeunload", (event) => {
      if (!hasUnsavedAnnotationChanges())
        return;
      event.preventDefault();
      event.returnValue = "";
    });
    render(ui);
    loadPersistedConversationState(ui);
  }
  function startDevHotReload() {
    if (false)
      ;
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage)
      return;
    const sendMessage = runtime.sendMessage.bind(runtime);
    setDevReloadState("polling");
    let polling = false;
    let needsPageReload = false;
    let reloadTimer = 0;
    const safeToReload = () => {
      const composer = findQueueComposer();
      const noteShadow = document.getElementById(ROOT_ID)?.shadowRoot;
      const queueHost = document.getElementById("plannotator-message-queue");
      const queueShadow = queueHost?.shadowRoot;
      return Boolean(composer && !readComposer(composer).trim() && !isChatBusy() && !hasComposerAttachments() && !state.draftEditorOpen && !state.draftText.trim() && !persistTimer && !hasUnsavedAnnotationChanges() && state.actionFeedback !== "loading" && !noteShadow?.querySelector("textarea") && queueHost?.getAttribute("data-reload-blocked") !== "true" && !queueShadow?.querySelector("textarea, button[data-action='enqueue']:disabled"));
    };
    const schedulePageReload = (delayMs = 420) => {
      if (reloadTimer)
        return;
      if (!safeToReload()) {
        setDevReloadState("waiting-for-idle");
        return;
      }
      setDevReloadState("page-reload-scheduled");
      reloadTimer = window.setTimeout(() => {
        reloadTimer = 0;
        if (!safeToReload()) {
          setDevReloadState("waiting-for-idle");
          return;
        }
        setDevReloadState("page-reloading");
        window.location.reload();
      }, delayMs);
    };
    runtime.onMessage?.addListener?.((message, _sender, respond) => {
      if (message?.type === "plannotator:dev-can-reload") {
        respond?.({ ok: true, safe: safeToReload() });
        return;
      }
      if (message?.type !== "plannotator:dev-page-reload") {
        return;
      }
      needsPageReload = true;
      setDevReloadState("page-reload-message");
      schedulePageReload();
    });
    const poll = async () => {
      if (polling || reloadTimer)
        return;
      if (needsPageReload) {
        schedulePageReload();
        return;
      }
      polling = true;
      try {
        const payload = await sendMessage({ type: "plannotator:dev-version" });
        if (!payload?.buildId || payload.buildId === "booting" || payload.buildId === DEV_BUILD_ID && payload.workerBuildId === DEV_BUILD_ID) {
          return;
        }
        if (payload.workerBuildId === payload.buildId) {
          needsPageReload = true;
          setDevReloadState(`worker-current:${payload.buildId}`);
          schedulePageReload();
          return;
        }
        if (!safeToReload()) {
          setDevReloadState("waiting-for-idle");
          return;
        }
        setDevReloadState(`build-change:${payload.buildId}`);
        const reply = await sendMessage({ type: "plannotator:dev-reload", buildId: payload.buildId });
        if (reply?.ok && reply.scheduled === false) {
          setDevReloadState("waiting-for-other-tabs");
          return;
        }
        if (reply?.ok && reply.scheduled === true) {
          setDevReloadState(`reload-requested:${payload.buildId}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/context invalidated/i.test(message)) {
          needsPageReload = true;
          schedulePageReload();
        }
      } finally {
        polling = false;
      }
    };
    poll();
    window.setInterval(() => {
      poll();
    }, DEV_POLL_INTERVAL_MS);
  }
  function ensurePageStyles() {
    if (document.getElementById(STYLE_ID))
      return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background: rgba(251, 191, 36, 0.35);
      color: inherit;
    }

    ::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
      background: rgba(245, 158, 11, 0.62);
      color: inherit;
    }
  `;
    document.head.appendChild(style);
  }
  function createUi() {
    const host = document.createElement("div");
    host.id = ROOT_ID;
    if (DEV_ENABLED) {
      host.dataset.buildId = DEV_BUILD_ID;
      host.dataset.reloadState = "booted";
    }
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .icon { display: block; flex: none; pointer-events: none; }
      button:focus-visible { outline: 2px solid #458cff; outline-offset: 3px; }

      .shell {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483646;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      }

      .selection-trigger,
      .note-popover,
      .notes-toolbar {
        pointer-events: auto;
      }

      .markers-layer,
      .popover-layer,
      .actions-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      .selection-trigger {
        position: fixed;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: #1d4ed8;
        color: white;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 12px 28px rgba(29, 78, 216, 0.35);
        cursor: pointer;
      }

      .selection-trigger:hover {
        transform: translateY(-1px);
      }

      .note-popover {
        position: fixed;
        width: 260px;
        max-width: calc(100vw - 24px);
        background: transparent;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        backdrop-filter: none;
        padding: 0;
      }

      .note-popover-shell {
        position: relative;
      }

      .input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 0;
        border: 1px solid rgba(37, 99, 235, 0.22);
        border-radius: 18px;
        padding: 10px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.45;
        color: #0f172a;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
        resize: none;
        overflow-y: hidden;
      }

      .note-popover-shell.has-delete .input {
        padding-right: 38px;
      }

      .delete-note {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.08);
        color: #475569;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
      }

      .delete-note:hover {
        background: rgba(239, 68, 68, 0.14);
        color: #b91c1c;
      }

      .notes-toolbar {
        position: fixed;
        right: 18px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .notes-action,
      .notes-list-toggle {
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 13px;
        font-weight: 750;
        cursor: pointer;
        transition: transform 120ms ease, background 140ms ease, box-shadow 140ms ease;
      }

      .notes-action {
        background: #1d4ed8;
        color: white;
        box-shadow: 0 14px 30px rgba(29, 78, 216, 0.3);
      }

      .notes-list-toggle {
        background: rgba(255, 255, 255, 0.98);
        color: #92400e;
        border: 1px solid rgba(217, 119, 6, 0.35);
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.16);
      }

      .notes-list-toggle.active {
        background: #f59e0b;
        color: #111827;
        border-color: #f59e0b;
      }

      .notes-action:hover,
      .notes-list-toggle:hover {
        transform: translateY(-1px);
      }

      .notes-action.success {
        background: #16a34a;
        box-shadow: 0 14px 30px rgba(22, 163, 74, 0.28);
      }

      .notes-action.loading {
        background: #1e40af;
        box-shadow: 0 14px 30px rgba(30, 64, 175, 0.28);
      }

      .notes-action:disabled {
        cursor: default;
      }

      .notes-action.success:hover,
      .notes-action:disabled:hover {
        transform: none;
      }

      .notes-action svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .notes-menu {
        position: absolute;
        right: 0;
        bottom: 52px;
        width: min(340px, calc(100vw - 36px));
        max-height: min(420px, calc(100vh - 132px));
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 22px 52px rgba(15, 23, 42, 0.2);
        padding: 6px;
        box-sizing: border-box;
      }

      .notes-menu-row {
        width: 100%;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #0f172a;
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr);
        column-gap: 10px;
        align-items: start;
        padding: 9px 8px;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .notes-menu-row:hover,
      .notes-menu-row.active {
        background: rgba(251, 191, 36, 0.22);
      }
      .notes-menu-item { display: flex; align-items: center; }
      .notes-menu-item .notes-menu-row { min-width: 0; }
      .notes-menu-delete { flex: none; width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer; }
      .notes-menu-delete:hover { background: #fee2e2; color: #b91c1c; }
      .notes-help { padding: 8px; margin: 0; font-size: 11px; color: #64748b; }
      .notes-status { max-width: min(340px, calc(100vw - 150px)); padding: 8px 10px; border-radius: 8px; background: white; box-shadow: 0 4px 18px #0f172a22; font-size: 12px; }
      .notes-status.error { color: #991b1b; }
      .notes-status button { margin-left: 6px; font: inherit; cursor: pointer; }

      .notes-menu-index {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.18);
        color: #92400e;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
      }

      .notes-menu-text {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .notes-menu-comment,
      .notes-menu-quote {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .notes-menu-comment {
        font-size: 13px;
        font-weight: 700;
        color: #0f172a;
      }

      .notes-menu-quote {
        font-size: 12px;
        color: #64748b;
      }

      .notes-action-spinner {
        animation: notes-action-spin 720ms linear infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .notes-action-spinner { animation: none; }
      }

      @keyframes notes-action-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 720px) {
        .note-popover {
          width: min(260px, calc(100vw - 20px));
        }
      }
    </style>
    <div class="shell">
      <div class="markers-layer" id="markers-layer"></div>
      <div class="popover-layer" id="popover-layer"></div>
      <div class="actions-layer" id="actions-layer"></div>
    </div>
  `;
    const markersLayer = shadow.getElementById("markers-layer");
    const popoverLayer = shadow.getElementById("popover-layer");
    const actionsLayer = shadow.getElementById("actions-layer");
    if (!markersLayer || !popoverLayer || !actionsLayer) {
      throw new Error("Threadlane extension failed to initialize its UI");
    }
    const ui = {
      host,
      shadow,
      markersLayer,
      popoverLayer,
      actionsLayer
    };
    shadow.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (target?.closest("[data-action='open-draft']")) {
        event.preventDefault();
        state.draftEditorOpen = true;
        state.activeNoteId = null;
        render(ui);
        return;
      }
      if (target?.closest("[data-action='insert-notes']")) {
        event.preventDefault();
        if (state.notes.length === 0 || state.actionFeedback !== "idle")
          return;
        insertPrompt(ui);
        return;
      }
    });
    shadow.addEventListener("click", (event) => {
      const target = event.target;
      if (!target)
        return;
      if (target.closest("[data-action='retry-notes']")) {
        retryAnnotationSave();
        return;
      }
      if (target.closest("[data-action='open-draft']")) {
        if (event instanceof MouseEvent && event.detail === 0) {
          state.draftEditorOpen = true;
          state.activeNoteId = null;
          render(ui);
        }
        return;
      }
      if (target.closest("[data-action='insert-notes']")) {
        if (event instanceof MouseEvent && event.detail === 0 && state.notes.length > 0 && state.actionFeedback === "idle")
          insertPrompt(ui);
        return;
      }
      if (target.closest("[data-action='toggle-notes-menu']")) {
        if (allConversationNotes().length === 0)
          return;
        state.notesMenuOpen = !state.notesMenuOpen;
        render(ui);
        return;
      }
      const jumpTarget = target.closest("[data-action='jump-note']");
      if (jumpTarget?.dataset.noteId) {
        jumpToNote(jumpTarget.dataset.noteId, ui);
        return;
      }
      const deleteTarget = target.closest("[data-action='delete-note']");
      if (deleteTarget) {
        const noteId = deleteTarget.closest("[data-note-id]")?.dataset.noteId;
        if (!noteId)
          return;
        deleteNote(noteId);
        render(ui);
        return;
      }
      return;
    });
    const updateNoteField = (target) => {
      if (currentConversationKey !== getConversationStorageKey()) {
        if (target.dataset.field === "draft")
          state.draftText = target.value;
        ensureAnnotationRoute();
        return;
      }
      if (target.dataset.field === "draft")
        state.draftText = target.value;
      else {
        const noteId = target.closest("[data-note-id]")?.dataset.noteId;
        if (noteId)
          updateNote(noteId, { comment: target.value });
      }
      autosizeNoteField(target);
    };
    shadow.addEventListener("input", (event) => {
      const target = event.composedPath()[0];
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
        updateNoteField(target);
    });
    for (const type of ["keypress", "keyup", "beforeinput", "input", "paste", "copy", "cut"]) {
      window.addEventListener(type, (event) => {
        const target = event.composedPath()[0];
        if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) || target.getRootNode() !== shadow)
          return;
        event.stopImmediatePropagation();
        if (type !== "input")
          return;
        updateNoteField(target);
      }, true);
    }
    return ui;
  }
  function render(ui) {
    reanchorDetachedNotes();
    renderMarkers(ui);
    renderPopover(ui);
    renderActions(ui);
    renderHighlights();
  }
  function reanchorDetachedNotes() {
    let changed = false;
    state.notes = state.notes.flatMap((note) => {
      if (getRangeRect(note.range)) {
        return [note];
      }
      const restored = restorePersistedNote(note);
      if (!restored) {
        return [note];
      }
      changed = true;
      return [restored];
    });
  }
  function renderMarkers(ui) {
    ui.markersLayer.innerHTML = "";
  }
  function renderActions(ui) {
    const isLoading = state.actionFeedback === "loading";
    const isSuccess = state.actionFeedback === "inserted";
    const notes = allConversationNotes();
    const session = currentAnnotationSession();
    const otherUnsaved = Array.from(annotationSessions.values()).find((entry) => entry !== session && (entry.pending.size > 0 || entry.draft?.text.trim() || !entry.key && entry.notes.size));
    const error = session.error || session.migrationError || state.actionError;
    const status = error || (session.pending.size || session.loading || session.flushing ? "Saving notes…" : "");
    if (notes.length === 0 && !isLoading && !isSuccess && !status && !otherUnsaved) {
      ui.actionsLayer.innerHTML = "";
      return;
    }
    const composer = findComposer();
    let bottom = 24;
    if (composer instanceof HTMLElement) {
      const rect = composer.getBoundingClientRect();
      if (rect.top < window.innerHeight) {
        bottom = clamp(window.innerHeight - rect.top + 18, 24, 180);
      }
    }
    const menu = state.notesMenuOpen && notes.length > 0 ? renderNotesMenu() : "";
    const toggleButton = notes.length > 0 ? `
    <button
      class="notes-list-toggle${state.notesMenuOpen ? " active" : ""}"
      data-action="toggle-notes-menu"
      type="button"
      title="Show notes"
      aria-label="Show notes"
      aria-expanded="${state.notesMenuOpen ? "true" : "false"}"
    >${notes.length}</button>
  ` : "";
    ui.actionsLayer.innerHTML = `
    <div class="notes-toolbar" style="bottom:${bottom}px;">
      ${menu}
      ${status ? `<span class="notes-status${error ? " error" : ""}" role="${error ? "alert" : "status"}">${escapeHtml(status)}${session.error || session.migrationError ? '<button data-action="retry-notes" type="button">Retry save</button>' : ""}</span>` : ""}
      ${otherUnsaved ? `<span class="notes-status error" role="alert">Notes in another chat are not saved. <a href="${escapeHtml(otherUnsaved.route.slice(STORAGE_KEY_PREFIX.length))}">Return to save</a></span>` : ""}
      ${toggleButton}
    <button
      class="notes-action${isLoading ? " loading" : ""}${isSuccess ? " success" : ""}"
      data-action="insert-notes"
      type="button"
      title="${isLoading ? "Inserting into" : isSuccess ? "Inserted into" : "Insert notes into"} ${getProviderName()}"
      aria-label="${isLoading ? "Inserting into" : isSuccess ? "Inserted into" : "Insert notes into"} ${getProviderName()}"
      data-state="${isLoading ? "loading" : isSuccess ? "success" : "idle"}"
      ${isLoading || isSuccess || state.notes.length === 0 ? "disabled" : ""}
    >
      ${isLoading ? icon("loader", 16, "notes-action-spinner") : isSuccess ? icon("check") : icon("arrow-right")}
    </button>
    </div>
  `;
  }
  function renderNotesMenu() {
    return `
    <section class="notes-menu" aria-label="Saved notes">
      <p class="notes-help">Saved notes remain until you delete them.</p>
      ${allConversationNotes().map((note, index) => `
        <div class="notes-menu-item" data-note-id="${escapeHtml(note.id)}">
        <button
          class="notes-menu-row${note.id === state.activeNoteId ? " active" : ""}"
          data-action="jump-note"
          data-note-id="${escapeHtml(note.id)}"
          type="button"
          title="${escapeHtml(note.comment || note.quote)}"
          aria-label="Jump to note ${index + 1}"
        >
          <span class="notes-menu-index">${index + 1}</span>
          <span class="notes-menu-text">
            <span class="notes-menu-comment">${escapeHtml(truncateInline(note.comment || "Untitled note", 80))}</span>
            <span class="notes-menu-quote">${escapeHtml(truncateInline(note.quote, 90))}</span>
          </span>
        </button>
        <button class="notes-menu-delete" data-action="delete-note" type="button" aria-label="Delete note ${index + 1}" title="Delete note ${index + 1}">${icon("trash")}</button>
        </div>
      `).join("")}
    </section>
  `;
  }
  function renderPopover(ui) {
    const draft = state.selectionDraft;
    if (!draft) {
      cancelDraftFocus();
      ui.popoverLayer.innerHTML = "";
      return;
    }
    if (!state.draftEditorOpen) {
      cancelDraftFocus();
      const side2 = pickSide(draft.rect);
      const triggerX = getDraftTriggerX(draft.rect, side2);
      const triggerY = clamp(draft.rect.top + draft.rect.height / 2 - 12, 12, window.innerHeight - 24 - 12);
      ui.popoverLayer.innerHTML = `
      <button
        class="selection-trigger"
        data-action="open-draft"
        type="button"
        aria-label="Add note"
        title="Add note"
        style="left:${triggerX}px;top:${triggerY}px;"
      >${icon("plus")}</button>
    `;
      return;
    }
    const draftKey = getSelectionDraftKey(draft);
    const side = pickSide(draft.rect);
    const rect = draft.rect;
    let popover = ui.popoverLayer.querySelector(".note-popover[data-draft-editor='true']");
    let field = popover?.querySelector("textarea[data-field='draft']") ?? null;
    let created = false;
    if (!popover || !field || popover.dataset.draftKey !== draftKey) {
      cancelDraftFocus();
      ui.popoverLayer.innerHTML = `
      <section class="note-popover" data-draft-editor="true">
        <div class="note-popover-shell">
          <textarea
            class="input"
            data-field="draft"
            placeholder="Type a note and press Enter"
            rows="1"
            autocomplete="off"
            spellcheck="true"
          ></textarea>
        </div>
      </section>
    `;
      popover = ui.popoverLayer.querySelector(".note-popover");
      field = popover?.querySelector("textarea[data-field='draft']") ?? null;
      if (!popover || !field)
        return;
      popover.dataset.draftKey = draftKey;
      field.value = state.draftText;
      created = true;
    } else if (field.value !== state.draftText) {
      const wasFocused = ui.shadow.activeElement === field;
      const selectionStart = field.selectionStart;
      const selectionEnd = field.selectionEnd;
      field.value = state.draftText;
      if (wasFocused) {
        const valueLength = field.value.length;
        field.setSelectionRange(Math.min(selectionStart, valueLength), Math.min(selectionEnd, valueLength));
      }
    }
    popover.dataset.side = side;
    autosizeNoteField(field);
    popover.style.left = "-9999px";
    popover.style.top = "-9999px";
    const measuredHeight = popover.offsetHeight || 52;
    const popoverLeft = getPopoverLeft(side, rect);
    const popoverTop = clamp(rect.top + rect.height / 2 - measuredHeight / 2, 12, window.innerHeight - measuredHeight - 12);
    popover.style.left = `${popoverLeft}px`;
    popover.style.top = `${popoverTop}px`;
    if (created) {
      focusDraftField(ui, draftKey, field);
    }
  }
  function getSelectionDraftKey(draft) {
    return JSON.stringify([
      draft.messageId,
      draft.startOffset,
      draft.endOffset,
      draft.quote
    ]);
  }
  function syncSelectionDraft(ui) {
    syncAnnotationRoute(ui);
    if (isDraftInputFocused(ui)) {
      return;
    }
    const draft = getSelectionDraft();
    selectionVersion += 1;
    const version = selectionVersion;
    if (selectionSettleTimer) {
      clearTimeout(selectionSettleTimer);
      selectionSettleTimer = null;
    }
    if (!draft) {
      if (!state.draftEditorOpen || !state.selectionDraft) {
        state.selectionDraft = null;
        state.draftEditorOpen = false;
      }
      render(ui);
      return;
    }
    selectionSettleTimer = setTimeout(() => {
      if (version !== selectionVersion)
        return;
      const previousId = state.selectionDraft?.messageId ?? null;
      const nextId = draft.messageId;
      const changed = previousId !== nextId || state.selectionDraft?.quote !== draft.quote;
      if (changed) {
        state.draftText = "";
        state.draftEditorOpen = false;
        state.activeNoteId = null;
      }
      state.selectionDraft = draft;
      render(ui);
    }, SELECTION_SETTLE_MS);
  }
  function getSelectionDraft() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return null;
    const range = selection.getRangeAt(0);
    if (!range || range.collapsed)
      return null;
    const startMessage = findAssistantMessage(range.startContainer);
    const endMessage = findAssistantMessage(range.endContainer);
    if (!startMessage || startMessage !== endMessage)
      return null;
    if (isInsideRoot(range.commonAncestorContainer))
      return null;
    const quote = collapseWhitespace(selection.toString()).trim();
    if (!quote)
      return null;
    const rect = getSelectionTailRect(range) ?? range.getBoundingClientRect();
    if (!rect.width && !rect.height)
      return null;
    const messageId2 = ensureMessageId(startMessage);
    const offsets = getOffsetsWithin(startMessage, range);
    const fullText = getNodeText(startMessage);
    return {
      messageId: messageId2,
      quote,
      range: createStableRange(range),
      messageExcerpt: collapseWhitespace(fullText).slice(0, MAX_EXCERPT),
      contextBefore: collapseWhitespace(fullText.slice(Math.max(0, offsets.start - CONTEXT_WINDOW), offsets.start)),
      contextAfter: collapseWhitespace(fullText.slice(offsets.end, offsets.end + CONTEXT_WINDOW)),
      startOffset: offsets.start,
      endOffset: offsets.end,
      rect
    };
  }
  function commitDraftNote() {
    if (!ensureAnnotationRoute())
      return;
    const draft = state.selectionDraft;
    if (!draft)
      return;
    const comment = state.draftText.trim();
    if (!comment) {
      clearSelectionDraft();
      return;
    }
    const note = {
      id: crypto.randomUUID(),
      messageId: draft.messageId,
      messageExcerpt: draft.messageExcerpt,
      quote: draft.quote,
      comment,
      contextBefore: draft.contextBefore,
      contextAfter: draft.contextAfter,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      range: draft.range,
      createdAt: Date.now()
    };
    clearActionFeedback();
    state.notes.push(note);
    state.activeNoteId = null;
    clearSelectionDraft();
    queueAnnotationMutation({ action: "upsert", note: serializeNote(note) }, true);
  }
  function updateNote(noteId, updates) {
    if (!ensureAnnotationRoute())
      return;
    const note = state.notes.find((entry) => entry.id === noteId);
    if (!note)
      return;
    if (updates.comment !== undefined) {
      note.comment = updates.comment;
    }
    queueAnnotationMutation({ action: "upsert", note: serializeNote(note) });
  }
  function deleteNote(noteId) {
    if (!ensureAnnotationRoute())
      return;
    const remaining = getOrderedNotes().filter((note) => note.id !== noteId);
    state.notes = remaining;
    if (state.activeNoteId === noteId) {
      state.activeNoteId = remaining.at(-1)?.id ?? null;
    }
    pendingRestoreNotes = pendingRestoreNotes.filter((note) => note.id !== noteId);
    queueAnnotationMutation({ action: "remove", id: noteId }, true);
  }
  function clearAllNotes() {
    if (!ensureAnnotationRoute())
      return;
    const ids = allConversationNotes().map((note) => note.id);
    state.notes = [];
    state.activeNoteId = null;
    state.notesMenuOpen = false;
    pendingRestoreNotes = [];
    stopRestoreObserver();
    clearSelectionDraft();
    const cssHighlights = CSS.highlights;
    cssHighlights?.set(HIGHLIGHT_NAME, new Highlight);
    cssHighlights?.set(ACTIVE_HIGHLIGHT_NAME, new Highlight);
    for (const id of ids)
      queueAnnotationMutation({ action: "remove", id });
    flushPersistedConversationState();
  }
  function buildPrompt() {
    if (state.notes.length === 0) {
      return "Select assistant text and add at least one note.";
    }
    return getOrderedNotes().map((note) => [
      `user: ${formatPromptValue(note.comment)}`,
      `responding to AI selected text: ${formatPromptValue(note.quote)}`
    ].join(`
`)).join(`

`).trim();
  }
  async function insertPrompt(ui) {
    if (!ensureAnnotationRoute())
      return;
    if (state.notes.length === 0 || state.actionFeedback === "loading") {
      return;
    }
    const composer = findComposer();
    if (!composer) {
      state.actionError = "The composer is unavailable. Your notes are still saved here.";
      render(ui);
      return;
    }
    if (getComposerText(composer).trim() || hasComposerAttachments()) {
      state.actionError = "Send or clear the current draft before inserting notes.";
      render(ui);
      return;
    }
    const route = getConversationStorageKey();
    const prompt = buildPrompt();
    state.actionError = "";
    clearActionFeedback();
    state.actionFeedback = "loading";
    render(ui);
    await nextPaint();
    if (route !== getConversationStorageKey() || !composer.isConnected || findComposer() !== composer || getComposerText(composer).trim() || hasComposerAttachments()) {
      clearActionFeedback();
      state.actionError = "The conversation or draft changed. Your notes were kept.";
      render(ui);
      return;
    }
    if (!setComposerText(composer, prompt)) {
      clearActionFeedback();
      state.actionError = "Could not insert notes. Your notes were kept.";
      render(ui);
      return;
    }
    showInsertSuccess(ui);
    render(ui);
  }
  function startConversationPersistence(ui) {
    currentConversationKey = getConversationStorageKey();
    if (conversationPollTimer)
      return;
    annotationRuntime()?.onMessage?.addListener((message) => {
      const session = currentAnnotationSession();
      if (message.type === ANNOTATION_CHANGED_TYPE && message.key === session.key)
        refreshAnnotationSession(session);
    });
    conversationPollTimer = window.setInterval(() => syncAnnotationRoute(ui), CONVERSATION_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible")
        refreshAnnotationSession(currentAnnotationSession());
    });
  }
  function syncAnnotationRoute(ui) {
    const nextKey = getConversationStorageKey();
    if (nextKey === currentConversationKey)
      return;
    const previous = currentAnnotationSession();
    if (state.selectionDraft && state.draftText.trim())
      previous.draft = { selection: state.selectionDraft, text: state.draftText };
    stopRestoreObserver();
    pendingRestoreNotes = [];
    clearActionFeedback();
    clearSelectionDraft(false);
    state.notes = [];
    state.activeNoteId = null;
    state.notesMenuOpen = false;
    state.actionError = "";
    currentConversationKey = nextKey;
    const next = currentAnnotationSession();
    if (next.draft) {
      state.selectionDraft = next.draft.selection;
      state.draftText = next.draft.text;
      state.draftEditorOpen = true;
    }
    applyAnnotationSession(next);
    render(ui);
    loadPersistedConversationState(ui);
  }
  function ensureAnnotationRoute() {
    if (!currentConversationKey) {
      currentConversationKey = getConversationStorageKey();
      return true;
    }
    if (currentConversationKey === getConversationStorageKey())
      return true;
    if (annotationUi)
      syncAnnotationRoute(annotationUi);
    return false;
  }
  function startDomRefreshObserver(ui) {
    if (domRefreshObserver || !document.body)
      return;
    domRefreshObserver = new MutationObserver(() => {
      if (pendingRestoreNotes.length > 0) {
        scheduleRestorePendingNotes(ui);
      }
      if (state.notes.length > 0) {
        scheduleRender(ui);
      }
    });
    domRefreshObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  async function loadPersistedConversationState(ui) {
    annotationUi = ui;
    currentConversationKey ??= getConversationStorageKey();
    const session = currentAnnotationSession();
    await loadAnnotationSession(session);
    if (session.pending.size)
      await flushAnnotationSession(session);
  }
  function schedulePersistedConversationState() {
    if (persistTimer)
      clearTimeout(persistTimer);
    const session = currentAnnotationSession();
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      flushAnnotationSession(session);
    }, PERSIST_DEBOUNCE_MS);
  }
  async function flushPersistedConversationState() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await flushAnnotationSession(currentAnnotationSession());
  }
  function annotationRuntime() {
    return globalThis.chrome?.runtime;
  }
  function currentAnnotationSession() {
    const route = currentConversationKey ?? getConversationStorageKey();
    let session = annotationSessions.get(route);
    if (!session) {
      session = { route, key: getAnnotationKey(route.slice(STORAGE_KEY_PREFIX.length)), notes: new Map, saved: new Map, pending: new Map, revision: -1, loaded: false, loading: null, flushing: null, error: "", migrationError: "", draft: null };
      annotationSessions.set(route, session);
    }
    return session;
  }
  function allConversationNotes() {
    const notes = new Map(currentAnnotationSession().notes);
    for (const note of pendingRestoreNotes)
      if (!notes.has(note.id))
        notes.set(note.id, note);
    for (const note of state.notes)
      notes.set(note.id, serializeNote(note));
    return Array.from(notes.values()).sort((a, b) => a.createdAt - b.createdAt);
  }
  function hasUnsavedAnnotationChanges() {
    return Boolean(state.draftText.trim() || Array.from(annotationSessions.values()).some((session) => session.pending.size || session.draft?.text.trim() || !session.key && session.notes.size));
  }
  function applyAnnotationSession(session) {
    if (session.route !== currentConversationKey || session.route !== getConversationStorageKey())
      return;
    const old = new Map(state.notes.map((note) => [note.id, note]));
    state.notes = [];
    pendingRestoreNotes = [];
    for (const note of session.notes.values()) {
      const restored = restorePersistedNote(note);
      const previous = old.get(note.id);
      if (restored)
        state.notes.push(restored);
      else if (previous)
        state.notes.push({ ...previous, comment: note.comment });
      else
        pendingRestoreNotes.push(note);
    }
    if (annotationUi) {
      if (pendingRestoreNotes.length)
        scheduleRestorePendingNotes(annotationUi);
      render(annotationUi);
    }
  }
  function acceptAnnotationSnapshot(session, reply) {
    if (reply.revision >= session.revision) {
      session.revision = reply.revision;
      session.saved = new Map(reply.notes.map((note) => [note.id, note]));
    }
    session.notes = new Map(session.saved);
    for (const [id, mutation] of session.pending) {
      if (mutation.action === "remove")
        session.notes.delete(id);
      else
        session.notes.set(id, mutation.note);
    }
    applyAnnotationSession(session);
  }
  async function annotationRequest(session, action, extra = {}) {
    if (!session.key)
      throw new Error("Open a saved conversation to save these notes.");
    const runtime = annotationRuntime();
    if (!runtime?.sendMessage)
      throw new Error("Extension storage is unavailable. Keep this tab open and retry saving.");
    const reply = await runtime.sendMessage({ type: ANNOTATION_MESSAGE_TYPE, key: session.key, action, ...extra });
    if (!reply?.ok || !Array.isArray(reply.notes) || typeof reply.revision !== "number")
      throw new Error(reply?.error || "The save was not confirmed. Keep this tab open and retry saving.");
    return { notes: reply.notes, revision: reply.revision };
  }
  function annotationFailure(session, error) {
    session.error = `Notes not saved: ${error instanceof Error ? error.message : String(error)}`;
    applyAnnotationSession(session);
  }
  async function loadAnnotationSession(session) {
    if (!session.key) {
      let raw = null;
      session.migrationError = "";
      try {
        raw = window.localStorage.getItem(session.route);
        if (raw) {
          const legacy = JSON.parse(raw);
          if (!Array.isArray(legacy) || !legacy.every(isPersistedNoteItem))
            throw new Error("The original notes could not be read.");
          for (const note of legacy) {
            if (!session.notes.has(note.id) && !session.pending.has(note.id))
              session.notes.set(note.id, note);
          }
        }
      } catch {
        if (raw)
          session.migrationError = "Existing notes could not be read. Their original copy has been kept.";
      }
      session.error = session.notes.size || session.pending.size ? "This chat is not saved. These notes are not saved in extension storage; keep this tab open." : "";
      applyAnnotationSession(session);
      return;
    }
    if (session.loading)
      return session.loading;
    session.loading = Promise.resolve().then(async () => {
      try {
        let raw = null;
        let legacy = [];
        session.migrationError = "";
        try {
          raw = window.localStorage.getItem(session.route);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || !parsed.every(isPersistedNoteItem))
              throw new Error("The original notes could not be read.");
            legacy = parsed;
            for (const note of legacy)
              if (!session.notes.has(note.id))
                session.notes.set(note.id, note);
            applyAnnotationSession(session);
          }
        } catch (error) {
          raw = null;
          session.migrationError = `Legacy notes were kept but could not be imported: ${error instanceof Error ? error.message : String(error)}`;
        }
        const reply = await annotationRequest(session, raw ? "import" : "read", raw ? { notes: legacy } : {});
        acceptAnnotationSnapshot(session, reply);
        if (raw && window.localStorage.getItem(session.route) === raw)
          window.localStorage.removeItem(session.route);
        session.loaded = true;
        session.error = "";
      } catch (error) {
        annotationFailure(session, error);
      }
    }).finally(() => {
      session.loading = null;
      applyAnnotationSession(session);
    });
    return session.loading;
  }
  async function refreshAnnotationSession(session) {
    if (!session.loaded) {
      await loadAnnotationSession(session);
      return;
    }
    try {
      acceptAnnotationSnapshot(session, await annotationRequest(session, "read"));
    } catch (error) {
      annotationFailure(session, error);
    }
  }
  function queueAnnotationMutation(mutation, immediate = false) {
    const session = currentAnnotationSession();
    const id = mutation.action === "remove" ? mutation.id : mutation.note.id;
    session.pending.set(id, mutation);
    if (mutation.action === "remove")
      session.notes.delete(id);
    else
      session.notes.set(id, mutation.note);
    session.error = "";
    if (immediate)
      flushAnnotationSession(session);
    else
      schedulePersistedConversationState();
  }
  async function flushAnnotationSession(session) {
    if (session.flushing)
      return session.flushing;
    session.flushing = (async () => {
      if (!session.loaded)
        await loadAnnotationSession(session);
      if (!session.loaded)
        return;
      try {
        while (session.pending.size) {
          const action = session.pending.values().next().value.action;
          const batch = Array.from(session.pending.entries()).filter(([, mutation]) => mutation.action === action);
          const extra = action === "remove" ? { ids: batch.map(([id]) => id) } : { notes: batch.map(([, mutation]) => mutation.note) };
          const reply = await annotationRequest(session, action, extra);
          for (const [id, mutation] of batch)
            if (session.pending.get(id) === mutation)
              session.pending.delete(id);
          acceptAnnotationSnapshot(session, reply);
          session.error = "";
        }
      } catch (error) {
        annotationFailure(session, error);
      }
    })().finally(() => {
      session.flushing = null;
      applyAnnotationSession(session);
    });
    return session.flushing;
  }
  async function retryAnnotationSave() {
    if (!ensureAnnotationRoute())
      return;
    const session = currentAnnotationSession();
    session.error = "";
    await loadAnnotationSession(session);
    await flushAnnotationSession(session);
    applyAnnotationSession(session);
  }
  function findComposer() {
    return findQueueComposer();
  }
  function getComposerText(element) {
    return readComposer(element);
  }
  function setComposerText(element, value) {
    const inserted = writeComposer(element, value);
    if (inserted)
      element.focus();
    return inserted;
  }
  function jumpToNote(noteId, ui) {
    const note = state.notes.find((entry) => entry.id === noteId);
    if (!note)
      return;
    state.activeNoteId = noteId;
    state.notesMenuOpen = false;
    suppressActiveScrollClearUntil = Date.now() + 900;
    render(ui);
    scrollNoteIntoView(note);
  }
  function scrollNoteIntoView(note) {
    const range = toLiveRange(note.range);
    if (!range)
      return;
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height) {
      const targetY = rect.top - window.innerHeight * 0.35;
      window.scrollBy({
        top: targetY,
        behavior: "smooth"
      });
      return;
    }
    const container = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    container?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function handleViewportScroll(ui) {
    if (state.activeNoteId && Date.now() > suppressActiveScrollClearUntil) {
      state.activeNoteId = null;
    }
    scheduleRender(ui);
  }
  function clearActiveNoteFromUserScroll(ui) {
    if (!state.activeNoteId)
      return;
    state.activeNoteId = null;
    suppressActiveScrollClearUntil = 0;
    scheduleRender(ui);
  }
  function renderHighlights() {
    const cssHighlights = CSS.highlights;
    if (!cssHighlights)
      return;
    const activeNote = state.notes.find((note) => note.id === state.activeNoteId);
    const baseRanges = state.notes.filter((note) => note.id !== activeNote?.id).map((note) => note.range);
    cssHighlights.set(HIGHLIGHT_NAME, new Highlight(...baseRanges));
    cssHighlights.set(ACTIVE_HIGHLIGHT_NAME, activeNote ? new Highlight(activeNote.range) : new Highlight);
  }
  function pickSide(rect) {
    const spaceLeft = rect.left;
    const spaceRight = window.innerWidth - rect.right;
    return spaceRight >= spaceLeft ? "right" : "left";
  }
  function getPopoverLeft(side, rect) {
    if (side === "right") {
      return clamp(rect.right + POPOVER_GAP, 12, window.innerWidth - POPOVER_WIDTH - 12);
    }
    return clamp(rect.left - POPOVER_WIDTH - POPOVER_GAP, 12, window.innerWidth - POPOVER_WIDTH - 12);
  }
  function getDraftTriggerX(rect, side) {
    if (side === "right") {
      return clamp(rect.right + POPOVER_GAP, 12, window.innerWidth - 24 - 12);
    }
    return clamp(rect.left - 24 - POPOVER_GAP, 12, window.innerWidth - 24 - 12);
  }
  function getRangeRect(rangeLike) {
    const range = toLiveRange(rangeLike);
    if (!range)
      return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height)
      return null;
    return rect;
  }
  function getSelectionTailRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
    return rects.at(-1) ?? null;
  }
  function toLiveRange(rangeLike) {
    if (rangeLike instanceof Range) {
      return rangeLike.cloneRange();
    }
    try {
      const range = document.createRange();
      range.setStart(rangeLike.startContainer, rangeLike.startOffset);
      range.setEnd(rangeLike.endContainer, rangeLike.endOffset);
      return range;
    } catch {
      return null;
    }
  }
  function cancelDraftFocus() {
    draftFocusVersion += 1;
    if (!draftFocusFrame)
      return;
    window.cancelAnimationFrame(draftFocusFrame);
    draftFocusFrame = 0;
  }
  function focusDraftField(ui, draftKey, field) {
    cancelDraftFocus();
    const version = draftFocusVersion;
    draftFocusFrame = window.requestAnimationFrame(() => {
      draftFocusFrame = 0;
      if (version !== draftFocusVersion)
        return;
      const draft = state.selectionDraft;
      if (!draft || !state.draftEditorOpen || getSelectionDraftKey(draft) !== draftKey) {
        return;
      }
      const currentField = ui.popoverLayer.querySelector("textarea[data-field='draft']");
      if (currentField !== field || !field.isConnected)
        return;
      autosizeNoteField(field);
      field.focus({ preventScroll: true });
      const caret = field.value.length;
      field.setSelectionRange(caret, caret);
    });
  }
  function autosizeNoteField(field) {
    if (!(field instanceof HTMLTextAreaElement))
      return;
    const computed = window.getComputedStyle(field);
    const lineHeight = parseFloat(computed.lineHeight) || 18;
    const padding = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);
    const border = parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
    const maxHeight = lineHeight * NOTE_MAX_ROWS + padding + border;
    field.style.height = "0px";
    const nextHeight = Math.min(field.scrollHeight, maxHeight);
    field.style.height = `${nextHeight}px`;
    field.style.overflowY = field.scrollHeight > maxHeight ? "auto" : "hidden";
  }
  function scheduleRender(ui) {
    if (renderFrame)
      return;
    renderFrame = window.requestAnimationFrame(() => {
      renderFrame = 0;
      render(ui);
    });
  }
  function clearSelectionDraft(forgetStored = true) {
    if (forgetStored)
      currentAnnotationSession().draft = null;
    cancelDraftFocus();
    selectionVersion += 1;
    if (selectionSettleTimer) {
      clearTimeout(selectionSettleTimer);
      selectionSettleTimer = null;
    }
    state.selectionDraft = null;
    state.draftEditorOpen = false;
    state.draftText = "";
    const selection = document.getSelection();
    selection?.removeAllRanges();
  }
  function getOrderedNotes() {
    return [...state.notes].sort((a, b) => a.createdAt - b.createdAt);
  }
  function findAssistantMessage(node) {
    return findAssistantMessageElement(node);
  }
  function ensureMessageId(message) {
    let id = message.getAttribute(MESSAGE_ID_ATTR);
    if (!id) {
      id = buildStableMessageId(message);
      message.setAttribute(MESSAGE_ID_ATTR, id);
    }
    return id;
  }
  function buildStableMessageId(message) {
    const provided = getAssistantMessageId(message);
    if (provided)
      return provided;
    const assistantMessages = getAssistantMessages();
    const index = assistantMessages.indexOf(message);
    const excerpt = collapseWhitespace(getNodeText(message)).slice(0, 96);
    return `assistant-${index}-${hashText(excerpt)}`;
  }
  function getAssistantMessages() {
    return getAssistantMessageElements();
  }
  function isInsideRoot(node) {
    const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
    if (!element)
      return false;
    return Boolean(element.closest(`#${ROOT_ID}`));
  }
  function createStableRange(range) {
    try {
      return new StaticRange({
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset
      });
    } catch {
      return range.cloneRange();
    }
  }
  function getOffsetsWithin(container, range) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let start = 0;
    let end = 0;
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const textLength = textNode.textContent?.length ?? 0;
      if (textNode === range.startContainer) {
        start = offset + range.startOffset;
      }
      if (textNode === range.endContainer) {
        end = offset + range.endOffset;
        break;
      }
      offset += textLength;
    }
    if (end < start) {
      end = start + range.toString().length;
    }
    return { start, end };
  }
  function getNodeText(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let text = "";
    while (walker.nextNode()) {
      text += walker.currentNode.textContent ?? "";
    }
    return text;
  }
  function collapseWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }
  function truncateInline(value, maxLength) {
    const trimmed = collapseWhitespace(value);
    if (trimmed.length <= maxLength)
      return trimmed;
    return `${trimmed.slice(0, maxLength - 1)}...`;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function isDraftInputFocused(ui) {
    const active = ui.shadow.activeElement;
    return (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && active.dataset.field === "draft";
  }
  function getConversationStorageKey() {
    return `${STORAGE_KEY_PREFIX}${window.location.origin}${window.location.pathname}`;
  }
  function isPersistedNoteItem(value) {
    if (!value || typeof value !== "object")
      return false;
    const candidate = value;
    return typeof candidate.id === "string" && typeof candidate.messageId === "string" && typeof candidate.messageExcerpt === "string" && typeof candidate.quote === "string" && typeof candidate.comment === "string" && typeof candidate.contextBefore === "string" && typeof candidate.contextAfter === "string" && (candidate.startOffset === undefined || typeof candidate.startOffset === "number") && (candidate.endOffset === undefined || typeof candidate.endOffset === "number") && typeof candidate.createdAt === "number";
  }
  function serializeNote(note) {
    return {
      id: note.id,
      messageId: note.messageId,
      messageExcerpt: note.messageExcerpt,
      quote: note.quote,
      comment: note.comment,
      contextBefore: note.contextBefore,
      contextAfter: note.contextAfter,
      startOffset: note.startOffset,
      endOffset: note.endOffset,
      createdAt: note.createdAt
    };
  }
  function scheduleRestorePendingNotes(ui) {
    if (restoreFrame)
      return;
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = 0;
      restorePendingNotes(ui);
    });
  }
  function restorePendingNotes(ui) {
    if (pendingRestoreNotes.length === 0) {
      stopRestoreObserver();
      render(ui);
      return;
    }
    const nextNotes = new Map(state.notes.map((note) => [note.id, note]));
    const unresolved = [];
    let upgradedPersistedState = false;
    for (const persisted of pendingRestoreNotes) {
      if (nextNotes.has(persisted.id))
        continue;
      const restored = restorePersistedNote(persisted);
      if (!restored) {
        unresolved.push(persisted);
        continue;
      }
      nextNotes.set(restored.id, restored);
      if (!hasStoredOffsets(persisted) || restored.quote !== persisted.quote) {
        upgradedPersistedState = true;
      }
    }
    state.notes = Array.from(nextNotes.values()).sort((a, b) => a.createdAt - b.createdAt);
    pendingRestoreNotes = unresolved;
    render(ui);
    if (pendingRestoreNotes.length > 0) {
      ensureRestoreObserver(ui);
    } else {
      stopRestoreObserver();
    }
  }
  function ensureRestoreObserver(ui) {
    if (restoreObserver || !document.body)
      return;
    restoreObserver = new MutationObserver(() => {
      scheduleRestorePendingNotes(ui);
    });
    restoreObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  function stopRestoreObserver() {
    if (restoreFrame) {
      window.cancelAnimationFrame(restoreFrame);
      restoreFrame = 0;
    }
    restoreObserver?.disconnect();
    restoreObserver = null;
  }
  function restorePersistedNote(persisted) {
    const message = findMessageForPersistedNote(persisted);
    if (!message)
      return null;
    const restored = findPersistedSelectionInMessage(message, persisted);
    if (!restored)
      return null;
    return {
      ...persisted,
      messageId: ensureMessageId(message),
      quote: restored.quote,
      startOffset: restored.startOffset,
      endOffset: restored.endOffset,
      range: createStableRange(restored.range)
    };
  }
  function findMessageForPersistedNote(note) {
    const direct = findAssistantMessageById(note.messageId);
    if (direct)
      return direct;
    const noteExcerpt = collapseWhitespace(note.messageExcerpt);
    let bestMatch = null;
    let bestScore = -1;
    for (const message of getAssistantMessages()) {
      const text = collapseWhitespace(getNodeText(message));
      let score = 0;
      if (noteExcerpt && text.includes(noteExcerpt))
        score += noteExcerpt.length * 2;
      if (note.quote && text.includes(collapseWhitespace(note.quote))) {
        score += Math.min(collapseWhitespace(note.quote).length, 240);
      }
      if (note.contextBefore && text.includes(collapseWhitespace(note.contextBefore))) {
        score += note.contextBefore.length;
      }
      if (note.contextAfter && text.includes(collapseWhitespace(note.contextAfter))) {
        score += note.contextAfter.length;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = message;
      }
    }
    return bestMatch;
  }
  function findAssistantMessageById(messageId2) {
    for (const message of getAssistantMessages()) {
      if (ensureMessageId(message) === messageId2) {
        return message;
      }
    }
    return null;
  }
  function findPersistedSelectionInMessage(message, note) {
    const text = getNodeText(message);
    if (!text)
      return null;
    if (hasStoredOffsets(note)) {
      const range2 = createRangeFromOffsets(message, note.startOffset, note.endOffset);
      if (range2 && isRecoveredRangeMatch(range2, note.quote)) {
        return {
          range: range2,
          quote: collapseWhitespace(range2.toString()) || note.quote,
          startOffset: note.startOffset,
          endOffset: note.endOffset
        };
      }
    }
    const offsets = findPersistedOffsets(text, note);
    if (!offsets)
      return null;
    const range = createRangeFromOffsets(message, offsets.start, offsets.end);
    if (!range)
      return null;
    return {
      range,
      quote: collapseWhitespace(range.toString()) || note.quote,
      startOffset: offsets.start,
      endOffset: offsets.end
    };
  }
  function isRecoveredRangeMatch(range, quote) {
    const recovered = stripWhitespace(range.toString());
    const expected = stripWhitespace(quote);
    return Boolean(recovered) && recovered === expected;
  }
  function findPersistedOffsets(rawText, note) {
    const normalizedQuote = collapseWhitespace(note.quote);
    if (!normalizedQuote)
      return null;
    const normalizedTokens = normalizedQuote.split(" ").filter(Boolean);
    const index = buildNormalizedTextIndex(rawText);
    if (!index.text)
      return null;
    const collapsedNote = {
      contextBefore: collapseWhitespace(note.contextBefore),
      contextAfter: collapseWhitespace(note.contextAfter)
    };
    const collapsedBest = findBestPersistedOffsetCandidate(index.text, normalizedQuote, normalizedTokens, collapsedNote, " ");
    if (collapsedBest) {
      return toRawOffsets(index, rawText.length, collapsedBest.start, collapsedBest.end);
    }
    const compactIndex = buildWhitespaceFreeTextIndex(rawText);
    const compactQuote = stripWhitespace(note.quote);
    if (!compactIndex.text || !compactQuote)
      return null;
    const compactBest = findBestPersistedOffsetCandidate(compactIndex.text, compactQuote, normalizedTokens, {
      contextBefore: stripWhitespace(note.contextBefore),
      contextAfter: stripWhitespace(note.contextAfter)
    }, "");
    if (!compactBest)
      return null;
    return toRawOffsets(compactIndex, rawText.length, compactBest.start, compactBest.end);
  }
  function findBestPersistedOffsetCandidate(normalizedText, normalizedQuote, quoteTokens, note, fragmentJoiner) {
    let best = null;
    let searchFrom = 0;
    while (searchFrom < normalizedText.length) {
      const start = normalizedText.indexOf(normalizedQuote, searchFrom);
      if (start === -1)
        break;
      const end = start + normalizedQuote.length;
      const score = scorePersistedOffsetCandidate(normalizedText, start, end, note);
      if (!best || score > best.score) {
        best = { start, end, score };
      }
      searchFrom = start + Math.max(1, normalizedQuote.length);
    }
    if (best)
      return best;
    return findPersistedOffsetsFromQuoteFragments(normalizedText, quoteTokens, note, fragmentJoiner);
  }
  function scorePersistedOffsetCandidate(normalizedText, start, end, note) {
    const before = collapseWhitespace(note.contextBefore);
    const after = collapseWhitespace(note.contextAfter);
    const beforeWindow = normalizedText.slice(Math.max(0, start - before.length), start);
    const afterWindow = normalizedText.slice(end, end + after.length);
    return countMatchingSuffix(beforeWindow, before) * 2 + countMatchingPrefix(afterWindow, after) * 2;
  }
  function findPersistedOffsetsFromQuoteFragments(normalizedText, quoteTokens, note, joiner) {
    if (quoteTokens.length === 0)
      return null;
    const maxWindow = Math.min(quoteTokens.length, 14);
    const minWindow = Math.min(maxWindow, 3);
    let best = null;
    for (let windowSize = maxWindow;windowSize >= minWindow; windowSize -= 1) {
      for (let tokenStart = 0;tokenStart + windowSize <= quoteTokens.length; tokenStart += 1) {
        const fragment = quoteTokens.slice(tokenStart, tokenStart + windowSize).join(joiner);
        let searchFrom = 0;
        while (searchFrom < normalizedText.length) {
          const start = normalizedText.indexOf(fragment, searchFrom);
          if (start === -1)
            break;
          const end = start + fragment.length;
          const score = scorePersistedOffsetCandidate(normalizedText, start, end, note) + fragment.length * 4 - tokenStart;
          if (!best || score > best.score) {
            best = { start, end, score };
          }
          searchFrom = start + Math.max(1, fragment.length);
        }
      }
      if (best) {
        return best;
      }
    }
    return null;
  }
  function countMatchingSuffix(actual, expected) {
    let matched = 0;
    let actualIndex = actual.length - 1;
    let expectedIndex = expected.length - 1;
    while (actualIndex >= 0 && expectedIndex >= 0) {
      if (actual[actualIndex] !== expected[expectedIndex])
        break;
      matched += 1;
      actualIndex -= 1;
      expectedIndex -= 1;
    }
    return matched;
  }
  function countMatchingPrefix(actual, expected) {
    let matched = 0;
    const length = Math.min(actual.length, expected.length);
    while (matched < length) {
      if (actual[matched] !== expected[matched])
        break;
      matched += 1;
    }
    return matched;
  }
  function buildNormalizedTextIndex(rawText) {
    let text = "";
    const rawByNormalized = [];
    let wroteNonWhitespace = false;
    let previousWasWhitespace = false;
    for (let index = 0;index < rawText.length; index += 1) {
      const character = rawText[index];
      if (/\s/.test(character)) {
        if (!wroteNonWhitespace || previousWasWhitespace)
          continue;
        text += " ";
        rawByNormalized.push(index);
        previousWasWhitespace = true;
        continue;
      }
      text += character;
      rawByNormalized.push(index);
      wroteNonWhitespace = true;
      previousWasWhitespace = false;
    }
    if (text.endsWith(" ")) {
      text = text.slice(0, -1);
      rawByNormalized.pop();
    }
    return { text, rawByNormalized };
  }
  function buildWhitespaceFreeTextIndex(rawText) {
    let text = "";
    const rawByNormalized = [];
    for (let index = 0;index < rawText.length; index += 1) {
      const character = rawText[index];
      if (/\s/.test(character)) {
        continue;
      }
      text += character;
      rawByNormalized.push(index);
    }
    return { text, rawByNormalized };
  }
  function toRawOffsets(index, rawTextLength, normalizedStart, normalizedEnd) {
    const rawStart = index.rawByNormalized[normalizedStart];
    const rawEnd = normalizedEnd < index.rawByNormalized.length ? index.rawByNormalized[normalizedEnd] : rawTextLength;
    if (typeof rawStart !== "number")
      return null;
    return {
      start: rawStart,
      end: Math.max(rawStart + 1, rawEnd)
    };
  }
  function createRangeFromOffsets(container, start, end) {
    if (end <= start)
      return null;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let totalOffset = 0;
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    let lastTextNode = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length ?? 0;
      const nextOffset = totalOffset + length;
      lastTextNode = node;
      if (!startNode && start <= nextOffset) {
        startNode = node;
        startOffset = clamp(start - totalOffset, 0, length);
      }
      if (!endNode && end <= nextOffset) {
        endNode = node;
        endOffset = clamp(end - totalOffset, 0, length);
        break;
      }
      totalOffset = nextOffset;
    }
    if (!startNode)
      return null;
    if (!endNode) {
      if (!lastTextNode)
        return null;
      endNode = lastTextNode;
      endOffset = lastTextNode.textContent?.length ?? 0;
    }
    if (startNode === endNode && endOffset <= startOffset) {
      return null;
    }
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range.collapsed ? null : range;
  }
  function hasStoredOffsets(note) {
    return typeof note.startOffset === "number" && typeof note.endOffset === "number" && note.endOffset > note.startOffset;
  }
  function formatPromptValue(value) {
    return JSON.stringify(collapseWhitespace(value));
  }
  function stripWhitespace(value) {
    return value.replace(/\s+/g, "");
  }
  function hashText(value) {
    let hash2 = 5381;
    for (let index = 0;index < value.length; index += 1) {
      hash2 = (hash2 << 5) + hash2 ^ value.charCodeAt(index);
    }
    return Math.abs(hash2).toString(36);
  }
  function setDevReloadState(value) {
    if (false)
      ;
    const host = document.getElementById(ROOT_ID);
    if (host) {
      host.dataset.reloadState = value;
    }
  }
  function clearActionFeedback() {
    state.actionFeedback = "idle";
    if (actionFeedbackTimer) {
      clearTimeout(actionFeedbackTimer);
      actionFeedbackTimer = null;
    }
  }
  function showInsertSuccess(ui) {
    clearActionFeedback();
    state.actionFeedback = "inserted";
    actionFeedbackTimer = window.setTimeout(() => {
      state.actionFeedback = "idle";
      actionFeedbackTimer = null;
      render(ui);
    }, ACTION_SUCCESS_MS);
  }
  function nextPaint() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }
})();

//# debugId=3EE48CBB83888C1364756E2164756E21
//# sourceMappingURL=content.js.map
