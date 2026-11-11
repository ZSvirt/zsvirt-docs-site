import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { assertPortAvailable, loopbackHost, loopbackOrigin, tcpPort } from '../scripts/local-launcher.mjs';

test('local launchers reject non-loopback hosts and invalid ports', () => {
  assert.equal(loopbackHost(undefined, 'DOC_SITE_HOST'), '127.0.0.1');
  assert.equal(loopbackOrigin('::1', 4322), 'http://[::1]:4322');
  assert.equal(tcpPort(undefined, 'DOC_SITE_PORT', 4322), 4322);
  assert.throws(() => loopbackHost('0.0.0.0', 'DOC_SITE_HOST'), /DOC_SITE_HOST/);
  assert.throws(() => tcpPort('0', 'DOC_SITE_PORT', 4322), /DOC_SITE_PORT/);
});

test('port preflight reports an existing listener without stopping it', async () => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = occupied.address();
    await assert.rejects(assertPortAvailable('127.0.0.1', port), /is unavailable/);
    assert.equal(occupied.listening, true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
