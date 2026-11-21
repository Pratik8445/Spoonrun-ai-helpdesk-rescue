import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { app } from '../api/src/app.js';
import {
    authed,
    customerWrites,
    newTeam,
    signIn,
    uniquePhone,
} from '../test/helpers.js';

let server: Server;
let base: string;

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

test('desk loads conversation details without a per-id loop', () => {
    const source = readFileSync(new URL('../api/src/routes/desk.ts', import.meta.url), 'utf8');

    assert.match(source, /conversationDetails/);
    assert.doesNotMatch(source, /for \(const id of ids\)/);
    assert.doesNotMatch(source, /await conversationDetail\(/);
});

test('desk polling skips overlapping refreshes and avoids full JSON.stringify', () => {
    const source = readFileSync(new URL('../web/src/useDesk.ts', import.meta.url), 'utf8');

    assert.match(source, /inFlight/);
    assert.match(source, /deskFingerprint/);
    assert.doesNotMatch(source, /JSON\.stringify\(next\)/);
});

test('desk endpoint still returns conversations for the signed-in agent', async () => {
    const team = await newTeam();
    const phone = uniquePhone();

    await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Desk Perf',
        text: 'Hello desk',
    });

    const token = await signIn(base, team.agents[0]);
    const started = Date.now();
    const response = await fetch(`${base}/api/desk`, { headers: authed(token) });
    const elapsed = Date.now() - started;
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.teams.some((entry: { id: number }) => entry.id === team.id));
    assert.ok(Object.keys(body.conversations).length >= 1);
    // Batched load should stay snappy even with a few conversations.
    assert.ok(elapsed < 3000, `desk took ${elapsed}ms`);
});
