import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { app } from '../api/src/app.js';
import { pool } from '../api/src/db.js';
import {
    conversationOf,
    customerWrites,
    newTeam,
    uniqueId,
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
    // Leave the shared pool open for other files in this `npm test` run; desk.test closes it.
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

test('repeated delivery of the same provider message is stored once', async () => {
    const team = await newTeam();
    const phone = uniquePhone();
    const messageId = uniqueId();

    const first = await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Dedupe Tester',
        text: 'I was charged twice',
        messageId,
    });
    const second = await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Dedupe Tester',
        text: 'I was charged twice',
        messageId,
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const conversationId = await conversationOf(team.id, phone);
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM messages
         WHERE conversation_id = $1 AND direction = 'in' AND provider_message_id = $2`,
        [conversationId, messageId],
    );

    assert.equal(rows[0].count, 1);
});

test('concurrent repeated deliveries still store the provider message once', async () => {
    const team = await newTeam();
    const phone = uniquePhone();
    const messageId = uniqueId();
    const payload = {
        channel: team.channel,
        phone,
        name: 'Concurrent Dedupe',
        text: 'Where is my order?',
        messageId,
    };

    const results = await Promise.all([
        customerWrites(base, payload),
        customerWrites(base, payload),
        customerWrites(base, payload),
    ]);

    assert.deepEqual(
        results.map(result => result.status).sort(),
        [200, 200, 200],
    );

    const conversationId = await conversationOf(team.id, phone);
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM messages
         WHERE conversation_id = $1 AND direction = 'in' AND provider_message_id = $2`,
        [conversationId, messageId],
    );

    assert.equal(rows[0].count, 1);
});

function hashOf(text: string): number {
    let hash = 7;

    for (const char of text) {
        hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
    }

    return hash;
}

/** Phones where the orders service intentionally waits over a second. */
function slowOrderPhone(): string {
    for (let n = 0; n < 10_000; n += 1) {
        const phone = `+351 900 ${String(n).padStart(6, '0')}`;
        const hash = hashOf(phone);

        if (hash % 10 < 4 && hash % 17 !== 0) {
            return phone;
        }
    }

    throw new Error('could not find a slow-order phone');
}

test('webhook acknowledges before the slow orders lookup finishes', async () => {
    const team = await newTeam();
    const phone = slowOrderPhone();
    const messageId = uniqueId();
    const started = Date.now();

    const response = await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Slow Order',
        text: 'Where is my food?',
        messageId,
    });

    const elapsed = Date.now() - started;

    assert.equal(response.status, 200);
    // Provider gives up after 1000ms; we must ack well under that even for slow phones.
    assert.ok(elapsed < 1000, `webhook took ${elapsed}ms`);
});

test('webhook still attaches the order after acknowledging', async () => {
    const team = await newTeam();
    const phone = slowOrderPhone();
    const messageId = uniqueId();

    const response = await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Order Attach',
        text: 'Missing fries',
        messageId,
    });

    assert.equal(response.status, 200);

    const conversationId = await conversationOf(team.id, phone);
    let orderRef: string | null = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
        const { rows } = await pool.query('SELECT order_ref FROM conversations WHERE id = $1', [conversationId]);
        orderRef = rows[0].order_ref;

        if (orderRef) {
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.ok(orderRef, 'expected order_ref to be attached in the background');
});
