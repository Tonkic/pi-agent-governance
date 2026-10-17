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
exports.openBrowser = openBrowser;
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const FAILURE = 'Unable to open the local browser workbench.';
async function openBrowser(url) {
    // Match the raw string too: URL parsing alone normalizes paths, ports and whitespace.
    const match = typeof url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/panel\/#[a-f0-9]{64}$/.exec(url);
    if (!match || Number(match[1]) > 65535)
        throw Error(FAILURE);
    const env = process.env;
    if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.REMOTE_CONTAINERS || env.CODESPACES || /microsoft|wsl/i.test(os.release()))
        throw Error(FAILURE);
    let command;
    let args;
    if (process.platform === 'win32') {
        // Use the OS directory, not PATH lookup or a caller-supplied executable.
        const windows = env.SystemRoot;
        if (!windows || !path.win32.isAbsolute(windows))
            throw Error(FAILURE);
        command = path.win32.join(windows, 'System32', 'rundll32.exe');
        args = ['url.dll,FileProtocolHandler', url];
    }
    else if (process.platform === 'darwin') {
        command = '/usr/bin/open';
        args = [url];
    }
    else if (process.platform === 'linux') {
        command = '/usr/bin/xdg-open';
        args = [url];
    }
    else
        throw Error(FAILURE);
    await new Promise((resolve, reject) => {
        let child;
        try {
            child = (0, node_child_process_1.spawn)(command, args, { shell: false, stdio: 'ignore', windowsHide: true });
        }
        catch {
            reject(Error(FAILURE));
            return;
        }
        let done = false;
        const finish = (success) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            if (success)
                resolve();
            else
                reject(Error(FAILURE));
        };
        const timer = setTimeout(() => {
            // Kill only our short-lived opener, never a browser process or a process tree.
            finish(false);
            try {
                child.kill();
            }
            catch { /* Error remains generic. */ }
        }, 4500);
        child.once('error', () => finish(false));
        child.once('exit', (code, signal) => finish(code === 0 && !signal));
    });
}
