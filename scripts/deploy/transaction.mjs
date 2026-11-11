import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, readlink, rename, symlink, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o644);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  await syncDirectory(dirname(path));
}

function assertRelease(root, path) {
  if (typeof path !== 'string' || resolve(path) !== path || dirname(path) !== join(root, 'releases')) throw new Error('Invalid release path');
}

export async function currentRelease(root) {
  const current = join(root, 'current');
  const stat = await lstat(current);
  if (!stat.isSymbolicLink()) throw new Error('Current release must be a symlink');
  const path = resolve(root, await readlink(current));
  assertRelease(root, path);
  return path;
}

export async function switchCurrent(root, release) {
  assertRelease(root, release);
  const temporary = join(root, `.current-${randomUUID()}`);
  try {
    await symlink(release, temporary);
    await rename(temporary, join(root, 'current'));
    await syncDirectory(root);
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function activeReceipt(root) {
  let pointer;
  try { pointer = await readFile(join(root, 'deployments', 'current-receipt'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const path = pointer.trim();
  if (dirname(path) !== join(root, 'deployments')) throw new Error('Unsafe receipt path');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  assertRelease(root, receipt.currentRelease);
  assertRelease(root, receipt.previousRelease);
  if (receipt.version !== 1) throw new Error('Invalid receipt version');
  return receipt;
}

async function recordReceipt(root, receipt) {
  const path = join(root, 'deployments', `${basename(receipt.currentRelease)}-${randomUUID()}.json`);
  await durableWrite(path, `${JSON.stringify(receipt, null, 2)}\n`);
  await durableWrite(join(root, 'deployments', 'current-receipt'), `${path}\n`);
  return { ...receipt, receiptPath: path };
}

async function clearJournal(root) {
  await unlink(join(root, 'deployments', 'pending.json'));
  await syncDirectory(join(root, 'deployments'));
}

// Called with the launcher's flock held. Unknown pointer drift is never overwritten.
export async function recoverPending({ root, restart, verify }) {
  let journal;
  try { journal = JSON.parse(await readFile(join(root, 'deployments', 'pending.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assertRelease(root, journal.previousRelease);
  assertRelease(root, journal.currentRelease);
  if (journal.version !== 1 || typeof journal.transactionId !== 'string') throw new Error('Invalid pending transaction');
  const current = await currentRelease(root);
  if (![journal.previousRelease, journal.currentRelease].includes(current)) throw new Error('Pending transaction current drift; recovery refused');
  const receipt = await activeReceipt(root);
  const committed = receipt?.transactionId === journal.transactionId && receipt.currentRelease === current;
  const target = committed ? current : journal.previousRelease;
  if (target !== current) await switchCurrent(root, target);
  await restart();
  const identity = await verify(target);
  if (!committed) {
    await recordReceipt(root, { ...identity, version: 1, action: 'recovery', createdAt: new Date().toISOString(),
      transactionId: journal.transactionId, currentRelease: target,
      previousRelease: journal.previousReceipt?.previousRelease ?? target });
  }
  await clearJournal(root);
  return { recovered: true, committed, currentRelease: target };
}

export async function activateRelease({ root, release, restart, verify, receiptData = {}, reason = 'upgrade' }) {
  await recoverPending({ root, restart, verify });
  assertRelease(root, release);
  const previous = await currentRelease(root);
  const previousReceipt = await activeReceipt(root);
  if (previousReceipt && previousReceipt.currentRelease !== previous) throw new Error('Receipt does not match the active release');
  const transactionId = randomUUID();
  const journal = { version: 1, transactionId, previousRelease: previous, currentRelease: release, previousReceipt };
  await durableWrite(join(root, 'deployments', 'pending.json'), `${JSON.stringify(journal)}\n`);
  let receipt;
  try {
    await switchCurrent(root, release);
    await restart();
    const identity = await verify(release);
    receipt = await recordReceipt(root, { ...receiptData, ...identity, version: 1, transactionId,
      action: reason, createdAt: new Date().toISOString(), currentRelease: release,
      previousRelease: release === previous ? previousReceipt?.previousRelease ?? previous : previous });
  } catch (error) {
    let recovery;
    try { recovery = await recoverPending({ root, restart, verify }); }
    catch (restoreError) {
      throw new AggregateError([error, restoreError], `Release failed and rollback failed: ${error.message}; ${restoreError.message}`);
    }
    const outcome = recovery?.committed ? 'committed release recovered' : 'previous release restored';
    throw new Error(`Release failed; ${outcome}: ${error.message}`, { cause: error });
  }
  await clearJournal(root);
  return receipt;
}

export async function rollbackRelease({ root, restart, verify }) {
  await recoverPending({ root, restart, verify });
  const current = await currentRelease(root);
  const receipt = await activeReceipt(root);
  if (!receipt || receipt.currentRelease !== current) throw new Error('Receipt does not match the active release');
  return activateRelease({ root, release: receipt.previousRelease, restart, verify, reason: 'rollback' });
}
