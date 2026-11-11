// The HTTP contract: a POST answers with its entry, and an open event stream receives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp, check } from '../src/server.ts';
import { createHistory } from '../src/history.ts';

test('a posted snippet is answered with its entry and pushed to open streams', async () => {
  const server = createApp(createHistory(check), { html: '', js: () => '' }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const ac = new AbortController();
  try {
    const stream = await fetch(base + '/events', { signal: ac.signal });
    const reader = stream.body!.getReader();
    await reader.read(); // the initial history event
    const posted = await fetch(base + '/eval', { method: 'POST', body: '<p>{"n " + count}</p>' });
    assert.equal(posted.status, 201);
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /^event: entry\ndata: \{"id":1,/);
    const refused = await fetch(base + '/eval', { method: 'POST', body: '<p>{"" + secret}</p>' });
    assert.equal(refused.status, 422);
  } finally {
    ac.abort();
    server.closeAllConnections();
    server.close();
  }
});
