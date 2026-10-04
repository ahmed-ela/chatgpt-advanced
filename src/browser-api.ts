/** The small WebExtension API surface used by the content scripts and worker. */
export interface ExtensionSender { tab?: { id?: number; url?: string }; url?: string; frameId?: number }
export type ExtensionListener = (message: unknown, sender: ExtensionSender, respond: (reply: unknown) => void) => boolean | void;
interface MessageEvent { addListener(listener: ExtensionListener): void }
export interface ExtensionRuntime {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage?: MessageEvent;
  reload?: () => void;
}
export interface ExtensionTabs {
  query(queryInfo: Record<string, never>): Promise<Array<{ id?: number }>>;
  sendMessage(tabId: number, message: unknown, options?: { frameId: number }): Promise<unknown>;
}
export interface ExtensionApi { runtime: ExtensionRuntime; tabs?: ExtensionTabs }

type Reply = (value: unknown) => void;
interface NativeRuntime {
  sendMessage?: (message: unknown, callback?: Reply) => Promise<unknown> | void;
  onMessage?: MessageEvent;
  reload?: () => void;
  lastError?: { message?: string };
}
interface NativeTabs {
  query?: (queryInfo: Record<string, never>, callback?: Reply) => Promise<unknown> | void;
  sendMessage?: (tabId: number, message: unknown, options: { frameId: number } | undefined, callback?: Reply) => Promise<unknown> | void;
}
interface NativeApi { runtime?: NativeRuntime; tabs?: NativeTabs }
export interface ExtensionGlobals { browser?: NativeApi; chrome?: NativeApi }

/**
 * Read the extension's isolated global, never page-window/wrappedJSObject APIs.
 * Firefox exposes Promise APIs as browser; Chrome's callback API remains a
 * fallback for older versions. A call is made once, never retried as another
 * signature: retrying a message could duplicate a committed queue operation.
 */
export function getExtensionApi(scope: ExtensionGlobals = globalThis as ExtensionGlobals): ExtensionApi | undefined {
  const promiseApi = scope.browser?.runtime;
  const native = promiseApi ? scope.browser : scope.chrome;
  const runtime = native?.runtime;
  if (!runtime) return undefined;
  const call = (invoke: (callback?: Reply) => Promise<unknown> | void): Promise<unknown> => {
    if (promiseApi) {
      try { return Promise.resolve(invoke()); }
      catch (error) { return Promise.reject(error); }
    }
    return new Promise((resolve, reject) => {
      try {
        const returned = invoke(reply => {
          // Chrome lastError is only valid while its callback is executing.
          const error = runtime.lastError;
          if (error) reject(new Error(error.message || "Extension request failed"));
          else resolve(reply);
        });
        // Modern Chrome (and test transports) can return a Promise too. Handle
        // it without issuing another native call or losing a rejection.
        returned?.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  };
  const result: ExtensionApi = { runtime: {
    sendMessage: message => call(callback => {
      if (!runtime.sendMessage) throw new Error("Extension messaging is unavailable");
      return callback ? runtime.sendMessage(message, callback) : runtime.sendMessage(message);
    }),
    // Keep listeners unchanged: return true + sendResponse works on both
    // browsers and lets unrelated queue/annotation/dev listeners decline.
    ...(runtime.onMessage ? { onMessage: runtime.onMessage } : {}),
    ...(runtime.reload ? { reload: runtime.reload.bind(runtime) } : {}),
  } };
  const tabs = native?.tabs;
  if (tabs) result.tabs = {
    query: queryInfo => call(callback => {
      if (!tabs.query) throw new Error("Extension tab queries are unavailable");
      return callback ? tabs.query(queryInfo, callback) : tabs.query(queryInfo);
    }) as Promise<Array<{ id?: number }>>,
    sendMessage: (tabId, message, options) => call(callback => {
      if (!tabs.sendMessage) throw new Error("Extension tab messaging is unavailable");
      return callback ? tabs.sendMessage(tabId, message, options, callback) : tabs.sendMessage(tabId, message, options);
    }),
  };
  return result;
}
