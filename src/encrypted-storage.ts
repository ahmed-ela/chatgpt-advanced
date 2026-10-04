/**
 * Extension-owned encrypted records. CryptoKey persistence protects against
 * casual plaintext inspection, not code executing as this extension/profile.
 * WebCrypto never runs inside an active IndexedDB transaction: strict-durable
 * compare-and-swap commits serialize competing service-worker/tab connections.
 */
const RECORDS = "encrypted-records";
const KEYS = "encryption-keys";
const KEY_ID = "record-key";
const FORMAT = 1;
const MAX_CONFLICTS = 128;

interface KeyRecord { id: typeof KEY_ID; token: string; key: CryptoKey }
interface Envelope { id: string; format: 1; keyToken: string; iv: Uint8Array; ciphertext: ArrayBuffer }
interface Snapshot { key: KeyRecord; record?: Envelope; legacy?: unknown }
interface Mutation<T, R> { value: T; result: R; changed: boolean }

/** Only thrown before a transaction exists, so no write can have committed. */
class ClosedBeforeTransaction extends Error {
  constructor(readonly database: IDBDatabase, cause: unknown) {
    super("The storage connection closed before its transaction began.", { cause });
  }
}

export class EncryptedRecordStore<T extends { key: string }> {
  private connection?: Promise<IDBDatabase>;
  private connectedDatabase?: IDBDatabase;

  constructor(private readonly factory: IDBFactory, private readonly name: string, private readonly legacyTable: string) {}

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.connectedDatabase = undefined;
    if (connection) (await connection).close();
  }

  async apply<R>(key: string, initial: () => T, mutate: (value: T) => Mutation<T, R>): Promise<R> {
    const id = await this.lookupId(key);
    for (let reopen = 0; ; reopen++) {
      try {
        const database = await this.database();
        for (let attempt = 0; attempt < MAX_CONFLICTS; attempt++) {
          const snapshot = await this.snapshot(database, id);
          const value = snapshot.record ? await this.decrypt(snapshot.record, snapshot.key, key) : initial();
          const mutation = mutate(value);
          if (!mutation.changed) return mutation.result;
          const next = await this.encrypt(id, snapshot.key, mutation.value);
          if (await this.compareAndSwap(database, id, snapshot, next)) return mutation.result;
        }
        throw new Error("Storage is busy in another tab. Keep this tab open and retry.");
      } catch (error) {
        if (!(error instanceof ClosedBeforeTransaction)) throw error;
        this.forgetConnection(error.database);
        error.database.close();
        if (reopen >= 1) throw error.cause;
        // Re-read and authenticate a fresh snapshot after reopening. Never
        // replay an aborted transaction or an uncertain committed mutation.
      }
    }
  }

  private forgetConnection(database: IDBDatabase): void {
    // A delayed event/error from an old handle must not evict its replacement.
    if (this.connectedDatabase !== database) return;
    this.connection = undefined;
    this.connectedDatabase = undefined;
  }

  private database(): Promise<IDBDatabase> {
    if (!this.connection) {
      const opening = this.open().then(async database => {
        if (this.connection === opening) this.connectedDatabase = database;
        database.onclose = () => this.forgetConnection(database);
        database.onversionchange = () => { this.forgetConnection(database); database.close(); };
        try {
          await this.initializeKey(database);
          await this.migrate(database);
          return database;
        } catch (error) { database.close(); throw error; }
      });
      this.connection = opening;
      void opening.catch(() => {
        if (this.connection === opening) { this.connection = undefined; this.connectedDatabase = undefined; }
      });
    }
    return this.connection;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 2);
      let failed = false;
      const fail = (error: Error) => { failed = true; reject(error); };
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.legacyTable)) database.createObjectStore(this.legacyTable, { keyPath: "key" });
        if (!database.objectStoreNames.contains(RECORDS)) database.createObjectStore(RECORDS, { keyPath: "id" });
        if (!database.objectStoreNames.contains(KEYS)) database.createObjectStore(KEYS, { keyPath: "id" });
      };
      request.onerror = () => fail(request.error ?? new Error("Could not open encrypted storage"));
      request.onblocked = () => fail(new Error("Storage is busy; close older extension pages and retry"));
      request.onsuccess = () => {
        const database = request.result;
        if (failed) { database.close(); return; }
        resolve(database);
      };
    });
  }

  private async initializeKey(database: IDBDatabase): Promise<void> {
    const existing = await transaction<KeyRecord | undefined>(database, [KEYS, RECORDS], "readonly", (tx, finish) => {
      const read = tx.objectStore(KEYS).get(KEY_ID);
      read.onsuccess = () => finish(read.result);
    });
    if (existing) { validateKey(existing); return; }
    // Generation can be slow and yields: it happens before the atomic get/add.
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const candidate: KeyRecord = { id: KEY_ID, token: crypto.randomUUID(), key };
    await transaction<void>(database, [KEYS, RECORDS], "readwrite", (tx, finish, fail) => {
      const read = tx.objectStore(KEYS).get(KEY_ID);
      read.onsuccess = () => {
        try {
          if (read.result) { validateKey(read.result); finish(); return; }
          const count = tx.objectStore(RECORDS).count();
          count.onsuccess = () => {
            try {
              if (count.result !== 0) { fail(new Error("The encryption key is missing. Existing data has been preserved; do not reset extension storage.")); return; }
              tx.objectStore(KEYS).add(candidate);
              finish();
            } catch (error) { fail(error); }
          };
        } catch (error) { fail(error); }
      };
    });
  }

  private async lookupId(key: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", encode(JSON.stringify([this.name, this.legacyTable, key])));
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
  }

  private authenticatedData(id: string, token: string): Uint8Array<ArrayBuffer> {
    return encode(JSON.stringify([FORMAT, this.name, this.legacyTable, id, token]));
  }

  private async encrypt(id: string, key: KeyRecord, value: T): Promise<Envelope> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.authenticatedData(id, key.token) }, key.key, encode(JSON.stringify(value)));
    return { id, format: FORMAT, keyToken: key.token, iv, ciphertext };
  }

  private async decrypt(record: Envelope, key: KeyRecord, expectedKey: string): Promise<T> {
    try {
      if (record.format !== FORMAT || record.keyToken !== key.token || !(record.iv instanceof Uint8Array) || record.iv.byteLength !== 12 || !(record.ciphertext instanceof ArrayBuffer)) throw new Error();
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: this.authenticatedData(record.id, key.token) }, key.key, record.ciphertext);
      const value: T = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
      if (!value || value.key !== expectedKey) throw new Error();
      return value;
    } catch {
      throw new Error("Stored data could not be decrypted or verified. It has been preserved; do not reset extension storage.");
    }
  }

  private snapshot(database: IDBDatabase, id: string, legacyKey?: string): Promise<Snapshot> {
    const tables = [KEYS, RECORDS, ...(legacyKey === undefined ? [] : [this.legacyTable])];
    return transaction<Snapshot>(database, tables, "readonly", (tx, finish, fail) => {
      const key = tx.objectStore(KEYS).get(KEY_ID);
      const record = tx.objectStore(RECORDS).get(id);
      const legacy = legacyKey === undefined ? undefined : tx.objectStore(this.legacyTable).get(legacyKey);
      const last = legacy ?? record;
      last.onsuccess = () => {
        try { validateKey(key.result); finish({ key: key.result, record: record.result, legacy: legacy?.result }); }
        catch (error) { fail(error); }
      };
    });
  }

  private compareAndSwap(database: IDBDatabase, id: string, before: Snapshot, next?: Envelope, legacyKey?: string, deleteLegacy = false): Promise<boolean> {
    const tables = [KEYS, RECORDS, ...(legacyKey === undefined ? [] : [this.legacyTable])];
    return transaction<boolean>(database, tables, "readwrite", (tx, finish, fail) => {
      const key = tx.objectStore(KEYS).get(KEY_ID);
      const record = tx.objectStore(RECORDS).get(id);
      const legacy = legacyKey === undefined ? undefined : tx.objectStore(this.legacyTable).get(legacyKey);
      (legacy ?? record).onsuccess = () => {
        try {
          validateKey(key.result);
          if (key.result.token !== before.key.token) throw new Error("The encryption key changed. Keep this tab open and retry.");
          if (!sameEnvelope(record.result, before.record) || (legacy && JSON.stringify(legacy.result) !== JSON.stringify(before.legacy))) { finish(false); return; }
          if (next) tx.objectStore(RECORDS).put(next);
          if (deleteLegacy) tx.objectStore(this.legacyTable).delete(legacyKey!);
          finish(true);
        } catch (error) { fail(error); }
      };
    });
  }

  private async migrate(database: IDBDatabase): Promise<void> {
    for (;;) {
      const legacyKey = await transaction<IDBValidKey | undefined>(database, [this.legacyTable], "readonly", (tx, finish) => {
        const read = tx.objectStore(this.legacyTable).openKeyCursor();
        read.onsuccess = () => finish(read.result?.key);
      });
      if (legacyKey === undefined) return;
      if (typeof legacyKey !== "string") throw new Error("Legacy storage could not be verified. Its original data has been preserved.");
      const id = await this.lookupId(legacyKey);
      let finished = false;
      for (let attempt = 0; attempt < MAX_CONFLICTS; attempt++) {
        const snapshot = await this.snapshot(database, id, legacyKey);
        if (snapshot.legacy === undefined) { finished = true; break; }
        const legacy = snapshot.legacy as T;
        if (!legacy || legacy.key !== legacyKey) throw new Error("Legacy storage could not be verified. Its original data has been preserved.");
        if (snapshot.record) {
          const verified = await this.decrypt(snapshot.record, snapshot.key, legacyKey);
          if (JSON.stringify(verified) !== JSON.stringify(legacy)) throw new Error("Legacy and encrypted records differ. Both copies have been preserved.");
          // The encrypted copy is already strictly committed and authenticated.
          // A separate strict transaction removes only the unchanged source.
          if (await this.compareAndSwap(database, id, snapshot, undefined, legacyKey, true)) { finished = true; break; }
        } else {
          const encrypted = await this.encrypt(id, snapshot.key, legacy);
          await this.compareAndSwap(database, id, snapshot, encrypted, legacyKey);
        }
      }
      if (!finished) throw new Error("Storage migration is busy. Original data is preserved; retry.");
    }
  }
}

function encode(text: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(text); }

function validateKey(value: KeyRecord | undefined): asserts value is KeyRecord {
  if (!value || value.id !== KEY_ID || typeof value.token !== "string" || !value.token || !value.key || value.key.type !== "secret" || value.key.extractable || value.key.algorithm?.name !== "AES-GCM" || (value.key.algorithm as AesKeyAlgorithm).length !== 256 || !Array.isArray(value.key.usages) || !value.key.usages.includes("encrypt") || !value.key.usages.includes("decrypt")) {
    throw new Error("The encryption key is missing or invalid. Existing data has been preserved; do not reset extension storage.");
  }
}

function sameEnvelope(a?: Envelope, b?: Envelope): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.format === b.format && a.keyToken === b.keyToken && equalBytes(a.iv, b.iv) && equalBytes(a.ciphertext, b.ciphertext);
}

function equalBytes(a: Uint8Array | ArrayBuffer, b: Uint8Array | ArrayBuffer): boolean {
  const left = new Uint8Array(a instanceof Uint8Array ? a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) : a);
  const right = new Uint8Array(b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Only synchronous IndexedDB requests/callbacks belong inside this helper. */
function transaction<R>(database: IDBDatabase, tables: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, finish: (result: R) => void, fail: (error: unknown) => void) => void): Promise<R> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = database.transaction(tables, mode, { durability: "strict" }); }
    catch (error) {
      reject(error && typeof error === "object" && "name" in error && error.name === "InvalidStateError"
        ? new ClosedBeforeTransaction(database, error) : error);
      return;
    }
    let result: R;
    let finished = false;
    let failure: unknown;
    const fail = (error: unknown) => { failure = error; tx.abort(); };
    tx.oncomplete = () => finished ? resolve(result!) : reject(new Error("Storage returned no result"));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Storage transaction failed. Keep this tab open and retry."));
    tx.onerror = () => { failure ??= tx.error; };
    try { run(tx, value => { result = value; finished = true; }, fail); }
    catch (error) { fail(error); }
  });
}
