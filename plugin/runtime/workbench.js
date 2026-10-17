"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserWorkbench = void 0;
const path = __importStar(require("node:path"));
const browser_1 = require("./browser");
const browser_open_1 = require("./browser-open");
class BrowserWorkbench {
    options;
    owned;
    queue = Promise.resolve();
    disposed = false;
    disposal;
    requests = new Set();
    constructor(options) {
        this.options = options;
    }
    serial(action) {
        const result = this.queue.then(action);
        this.queue = result.catch(() => { });
        return result;
    }
    async open(workspace, isCurrent = async () => true) {
        if (this.disposed)
            throw Error('Browser workbench is disposed.');
        if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
            throw Error('Explicit absolute workspace required.');
        const request = { workspace: path.resolve(workspace), cancelled: false };
        this.requests.add(request);
        // Check identity at invocation as well as after startup and immediately before opening.
        const initial = Promise.resolve().then(isCurrent).then(Boolean, () => false);
        try {
            return await this.serial(async () => {
                const valid = async () => !this.disposed && !request.cancelled && await isCurrent();
                if (!await initial || !await valid())
                    throw Error('Browser workbench request is no longer current.');
                const root = await (0, browser_1.workspacePath)(workspace);
                if (this.owned?.closed) {
                    await this.owned.close();
                    this.owned = undefined;
                }
                if (this.owned && this.owned.workspace !== root) {
                    await this.owned.close();
                    this.owned = undefined;
                }
                let app = this.owned;
                try {
                    if (!await valid())
                        throw Error('Not current');
                    if (!app) {
                        app = await (this.options.startServer || browser_1.startBrowserConsole)({ workspace: root, assetRoot: this.options.assetRoot, webAssetsRoot: this.options.webAssetsRoot, managed: true, lease: this.options.lease });
                        this.owned = app;
                    }
                    if (app.closed || !await valid())
                        throw Error('Not current');
                    // This last check includes close/dispose during an asynchronous identity lookup.
                    if (!await valid() || this.disposed || request.cancelled)
                        throw Error('Not current');
                    await (this.options.openExternal || browser_open_1.openBrowser)(app.url);
                    if (this.disposed || request.cancelled || !await valid())
                        throw Error('Not current');
                    return { workspace: app.workspace, origin: app.origin, opened: true };
                }
                catch {
                    if (app) {
                        await app.close();
                        if (this.owned === app)
                            this.owned = undefined;
                    }
                    throw Error('Unable to open browser workbench.');
                }
            });
        }
        catch {
            // Never propagate injected opener/server/identity errors containing private links.
            throw Error('Unable to open browser workbench.');
        }
        finally {
            this.requests.delete(request);
        }
    }
    status() {
        const app = this.owned;
        if (!app || app.closed)
            return { workspace: null, origin: null, open: false };
        return { workspace: app.workspace, origin: app.origin, open: true };
    }
    async close(workspace) {
        if (workspace !== undefined && (typeof workspace !== 'string' || !path.isAbsolute(workspace)))
            return { closed: false };
        const root = workspace === undefined ? undefined : path.resolve(workspace);
        // Invalidate immediately, not when this action eventually reaches the queue.
        for (const request of this.requests)
            if (root === undefined || request.workspace === root)
                request.cancelled = true;
        const current = this.owned;
        const closing = current && (root === undefined || current.workspace === root) ? current.close() : undefined;
        return this.serial(async () => {
            if (closing)
                await closing;
            const app = this.owned;
            if (!app || (root !== undefined && app.workspace !== root))
                return { closed: !!closing };
            await app.close();
            this.owned = undefined;
            return { closed: true };
        });
    }
    dispose() {
        if (this.disposal)
            return this.disposal;
        this.disposed = true;
        this.disposal = this.close().then(() => { });
        return this.disposal;
    }
}
exports.BrowserWorkbench = BrowserWorkbench;
