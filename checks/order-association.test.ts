import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { app } from '../api/src/app.js';
import { pool } from '../api/src/db.js';
import { orderDetails } from '../api/src/orders.js';
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
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

test('restaurant chats do not get a customer order attached by phone', async () => {
    // Pizzeria Nonna's real phone: latestOrderFor maps to an order whose restaurant is Sushi Mar.
    const phone = '+351 213 500 204';
    const messageId = uniqueId();

    const response = await customerWrites(base, {
        channel: 'restaurants',
        phone,
        name: 'Pizzeria Nonna',
        text: 'Can we change Sunday hours?',
        messageId,
    });

    assert.equal(response.status, 200);

    const { rows: teams } = await pool.query(`SELECT id FROM teams WHERE channel = 'restaurants'`);
    const conversationId = await conversationOf(teams[0].id, phone);

    // Give any mistaken background attach time to finish, then assert it stayed clear.
    await new Promise(resolve => setTimeout(resolve, 1800));

    const { rows } = await pool.query('SELECT order_ref FROM conversations WHERE id = $1', [conversationId]);

    assert.equal(rows[0].order_ref, null);

    // Document the wrong association the old code would have shown.
    const wrong = await orderDetails('SR-40676');
    assert.equal(wrong.restaurant, 'Sushi Mar');
});

test('restaurant webhook clears a previously wrong order_ref', async () => {
    const phone = uniquePhone();
    const { rows: teams } = await pool.query(`SELECT id FROM teams WHERE channel = 'restaurants'`);
    const teamId = teams[0].id;

    const { rows: customers } = await pool.query(
        `INSERT INTO customers (phone, name) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [phone, 'Wrong Order Restaurant'],
    );

    const { rows: conversations } = await pool.query(
        `INSERT INTO conversations (team_id, customer_id, order_ref)
         VALUES ($1, $2, 'SR-40676')
         ON CONFLICT (team_id, customer_id) DO UPDATE SET order_ref = 'SR-40676', status = 'open'
         RETURNING id`,
        [teamId, customers[0].id],
    );

    const response = await customerWrites(base, {
        channel: 'restaurants',
        phone,
        name: 'Wrong Order Restaurant',
        text: 'Tablet is down again',
        messageId: uniqueId(),
    });

    assert.equal(response.status, 200);

    await new Promise(resolve => setTimeout(resolve, 200));

    const { rows } = await pool.query('SELECT order_ref FROM conversations WHERE id = $1', [
        conversations[0].id,
    ]);

    assert.equal(rows[0].order_ref, null);
});

test('customer chats still attach the latest order in the background', async () => {
    const team = await newTeam();
    const phone = uniquePhone();

    const response = await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Order Customer',
        text: 'Missing a drink',
        messageId: uniqueId(),
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

    assert.ok(orderRef, 'expected customer conversations to keep order attachment');
});

test('customer header resyncs when the open conversation changes', () => {
    const source = readFileSync(new URL('../web/src/components/CustomerHeader.tsx', import.meta.url), 'utf8');

    assert.match(source, /useEffect\(\(\) => \{[\s\S]*setName\(customer\.name\)/);
    assert.match(source, /\[customer\.id, customer\.name\]/);
});
