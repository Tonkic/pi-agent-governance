import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
const FAILURE = 'Unable to open the local browser workbench.';
export async function openBrowser(url: string): Promise<void> {
  // Match the raw string too: URL parsing alone normalizes paths, ports and whitespace.
  const match = typeof url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/panel\/#[a-f0-9]{64}$/.exec(url);
  if (!match || Number(match[1]) > 65535) throw Error(FAILURE);
  const env = process.env;
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.REMOTE_CONTAINERS || env.CODESPACES || /microsoft|wsl/i.test(os.release())) throw Error(FAILURE);
  let command: string;
  let args: string[];
  if (process.platform === 'win32') {
    // Use the OS directory, not PATH lookup or a caller-supplied executable.
    const windows = env.SystemRoot;
    if (!windows || !path.win32.isAbsolute(windows)) throw Error(FAILURE);
    command = path.win32.join(windows, 'System32', 'rundll32.exe');
    args = ['url.dll,FileProtocolHandler', url];
  } else if (process.platform === 'darwin') { command = '/usr/bin/open'; args = [url]; }
  else if (process.platform === 'linux') { command = '/usr/bin/xdg-open'; args = [url]; }
  else throw Error(FAILURE);
  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command, args, { shell: false, stdio: 'ignore', windowsHide: true }); }
    catch { reject(Error(FAILURE)); return; }
    let done = false;
    const finish = (success: boolean) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (success) resolve(); else reject(Error(FAILURE));
    };
    const timer = setTimeout(() => {
      // Kill only our short-lived opener, never a browser process or a process tree.
      finish(false);
      try { child.kill(); } catch { /* Error remains generic. */ }
    }, 4500);
    child.once('error', () => finish(false));
    child.once('exit', (code, signal) => finish(code === 0 && !signal));
  });
}
