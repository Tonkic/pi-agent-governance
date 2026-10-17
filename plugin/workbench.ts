import * as path from 'node:path';
import { startBrowserConsole, workspacePath, BrowserOptions, BrowserConsole } from './browser';
import { openBrowser } from './browser-open';
interface WorkbenchOptions {
  assetRoot: string;
  webAssetsRoot: string;
  openExternal?: (privateUrl: string) => Promise<void>;
  lease?: BrowserOptions['lease'];
  // Trusted in-process lifecycle test seam; never exposed to protocol callers.
  startServer?: typeof startBrowserConsole;
}
export class BrowserWorkbench {
  private owned: BrowserConsole | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private disposal: Promise<void> | undefined;
  private requests = new Set<{ workspace: string; cancelled: boolean }>();
  constructor(private readonly options: WorkbenchOptions) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async open(workspace: string, isCurrent: () => Promise<boolean> = async () => true): Promise<{ workspace: string; origin: string; opened: true }> {
    if (this.disposed) throw Error('Browser workbench is disposed.');
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw Error('Explicit absolute workspace required.');
    const request = { workspace: path.resolve(workspace), cancelled: false };
    this.requests.add(request);
    // Check identity at invocation as well as after startup and immediately before opening.
    const initial = Promise.resolve().then(isCurrent).then(Boolean, () => false);
    try {
      return await this.serial(async () => {
        const valid = async () => !this.disposed && !request.cancelled && await isCurrent();
        if (!await initial || !await valid()) throw Error('Browser workbench request is no longer current.');
        const root = await workspacePath(workspace);
        if (this.owned?.closed) { await this.owned.close(); this.owned = undefined; }
        if (this.owned && this.owned.workspace !== root) {
          await this.owned.close(); this.owned = undefined;
        }
        let app = this.owned;
        try {
          if (!await valid()) throw Error('Not current');
          if (!app) {
            app = await (this.options.startServer || startBrowserConsole)({ workspace: root, assetRoot: this.options.assetRoot, webAssetsRoot: this.options.webAssetsRoot, managed: true, lease: this.options.lease });
            this.owned = app;
          }
          if (app.closed || !await valid()) throw Error('Not current');
          // This last check includes close/dispose during an asynchronous identity lookup.
          if (!await valid() || this.disposed || request.cancelled) throw Error('Not current');
          await (this.options.openExternal || openBrowser)(app.url);
          if (this.disposed || request.cancelled || !await valid()) throw Error('Not current');
          return { workspace: app.workspace, origin: app.origin, opened: true as const };
        } catch {
          if (app) { await app.close(); if (this.owned === app) this.owned = undefined; }
          throw Error('Unable to open browser workbench.');
        }
      });
    } catch {
      // Never propagate injected opener/server/identity errors containing private links.
      throw Error('Unable to open browser workbench.');
    } finally { this.requests.delete(request); }
  }
  status(): { workspace: string | null; origin: string | null; open: boolean } {
    const app = this.owned;
    if (!app || app.closed) return { workspace: null, origin: null, open: false };
    return { workspace: app.workspace, origin: app.origin, open: true };
  }
  async close(workspace?: string): Promise<{ closed: boolean }> {
    if (workspace !== undefined && (typeof workspace !== 'string' || !path.isAbsolute(workspace))) return { closed: false };
    const root = workspace === undefined ? undefined : path.resolve(workspace);
    // Invalidate immediately, not when this action eventually reaches the queue.
    for (const request of this.requests) if (root === undefined || request.workspace === root) request.cancelled = true;
    const current = this.owned;
    const closing = current && (root === undefined || current.workspace === root) ? current.close() : undefined;
    return this.serial(async () => {
      if (closing) await closing;
      const app = this.owned;
      if (!app || (root !== undefined && app.workspace !== root)) return { closed: !!closing };
      await app.close(); this.owned = undefined;
      return { closed: true };
    });
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = this.close().then(() => {});
    return this.disposal;
  }
}
