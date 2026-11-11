import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';

export function loopbackHost(value, name) {
  const host = value ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error(`${name} must be 127.0.0.1 or ::1`);
  }
  return host;
}

export function tcpPort(value, name, fallback) {
  const text = value ?? String(fallback);
  if (!/^[1-9]\d{0,4}$/.test(text) || Number(text) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return Number(text);
}

export function loopbackOrigin(host, port) {
  return `http://${host === '::1' ? '[::1]' : host}:${port}`;
}

export async function assertPortAvailable(host, port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    throw new Error(`${host}:${port} is unavailable: ${error.message}`, { cause: error });
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

export function startChild(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited };
}

export async function stopChild(entry) {
  if (!entry || entry.child.exitCode !== null || entry.child.signalCode !== null || !entry.child.pid) return;
  const signal = (name) => {
    try {
      process.kill(process.platform === 'win32' ? entry.child.pid : -entry.child.pid, name);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signal('SIGTERM');
  let timeout;
  const stopped = await Promise.race([
    entry.exited.then(() => true, () => true),
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timeout);
  if (!stopped) {
    signal('SIGKILL');
    await entry.exited.catch(() => {});
  }
}

export async function waitForTcp(host, port, signal, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.setTimeout(2_000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(signal.aborted ? 'Startup was interrupted' : `${host}:${port} did not become ready within ${timeoutMs}ms`);
}
