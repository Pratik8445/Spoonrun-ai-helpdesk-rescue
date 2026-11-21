import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { app } from '../api/src/app.js';
import {
    authed,
    conversationOf,
    customerWrites,
    newTeam,
    signIn,
    uniquePhone,
} from './helpers.js';

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

test('waiting queue puts the customer who wrote first at the top', async () => {
    const team = await newTeam();
    const earlyPhone = uniquePhone();
    const latePhone = uniquePhone();
    const now = Date.now();

    await customerWrites(base, {
        channel: team.channel,
        phone: earlyPhone,
        name: 'Early Writer',
        text: 'My order is late.',
        sentAt: new Date(now - 40 * 60_000),
    });
    await customerWrites(base, {
        channel: team.channel,
        phone: latePhone,
        name: 'Late Writer',
        text: 'hello??',
        sentAt: new Date(now - 5 * 60_000),
    });
    // A follow-up must not bump the later customer above the older wait.
    await customerWrites(base, {
        channel: team.channel,
        phone: latePhone,
        name: 'Late Writer',
        text: 'hello???',
        sentAt: new Date(now - 1 * 60_000),
    });

    const token = await signIn(base, team.agents[0]);
    const queue = await (await fetch(`${base}/api/teams/${team.id}/queue`, { headers: authed(token) })).json();

    assert.equal(queue.length, 2);
    assert.equal(queue[0].customerName, 'Early Writer');
    assert.equal(queue[1].customerName, 'Late Writer');
});

test('Mine badge counts only unread conversations assigned to the agent', async () => {
    const team = await newTeam();
    const waitingPhone = uniquePhone();
    const minePhone = uniquePhone();
    const otherPhone = uniquePhone();

    await customerWrites(base, {
        channel: team.channel,
        phone: waitingPhone,
        name: 'Still Waiting',
        text: 'Anyone there?',
    });
    await customerWrites(base, {
        channel: team.channel,
        phone: minePhone,
        name: 'Mine Customer',
        text: 'Need help',
    });
    await customerWrites(base, {
        channel: team.channel,
        phone: otherPhone,
        name: 'Other Agent Customer',
        text: 'Also need help',
    });

    const mineId = await conversationOf(team.id, minePhone);
    const otherId = await conversationOf(team.id, otherPhone);
    const tokenA = await signIn(base, team.agents[0]);
    const tokenB = await signIn(base, team.agents[1]);

    assert.equal(
        (await fetch(`${base}/api/conversations/${mineId}/take`, { method: 'POST', headers: authed(tokenA) })).status,
        200,
    );
    assert.equal(
        (await fetch(`${base}/api/conversations/${otherId}/take`, { method: 'POST', headers: authed(tokenB) })).status,
        200,
    );

    assert.equal(
        (await fetch(`${base}/api/conversations/${mineId}/read`, { method: 'POST', headers: authed(tokenA) })).status,
        200,
    );

    const badgeAfterRead = await (await fetch(`${base}/api/badge`, { headers: authed(tokenA) })).json();

    assert.equal(badgeAfterRead.unread, 0);

    await customerWrites(base, {
        channel: team.channel,
        phone: minePhone,
        name: 'Mine Customer',
        text: 'Any news?',
    });
    await customerWrites(base, {
        channel: team.channel,
        phone: waitingPhone,
        name: 'Still Waiting',
        text: 'hello??',
    });

    const badgeAfterReply = await (await fetch(`${base}/api/badge`, { headers: authed(tokenA) })).json();

    assert.equal(badgeAfterReply.unread, 1);
});

test('only one agent wins when two take the same conversation at once', async () => {
    const team = await newTeam();
    const phone = uniquePhone();

    await customerWrites(base, {
        channel: team.channel,
        phone,
        name: 'Double Take',
        text: 'Cold pizza',
    });

    const id = await conversationOf(team.id, phone);
    const tokenA = await signIn(base, team.agents[0]);
    const tokenB = await signIn(base, team.agents[1]);

    const [resultA, resultB] = await Promise.all([
        fetch(`${base}/api/conversations/${id}/take`, { method: 'POST', headers: authed(tokenA) }),
        fetch(`${base}/api/conversations/${id}/take`, { method: 'POST', headers: authed(tokenB) }),
    ]);

    const statuses = [resultA.status, resultB.status].sort();

    assert.deepEqual(statuses, [200, 409]);

    const winnerToken = resultA.status === 200 ? tokenA : tokenB;
    const detail = await (await fetch(`${base}/api/conversations/${id}`, { headers: authed(winnerToken) })).json();
    const takeNotes = detail.messages.filter(
        (message: { direction: string; body: string }) =>
            message.direction === 'note' && message.body.endsWith('took this conversation'),
    );

    assert.equal(takeNotes.length, 1);
    assert.ok(detail.assignedAgent);
});
