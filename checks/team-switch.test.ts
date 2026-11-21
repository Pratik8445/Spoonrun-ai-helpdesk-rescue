import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { app } from '../api/src/app.js';
import { pool } from '../api/src/db.js';
import { authed, newTeam, signIn } from '../test/helpers.js';

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

async function currentTeamId(token: string): Promise<number> {
    const me = await (await fetch(`${base}/api/me`, { headers: authed(token) })).json();

    return me.currentTeamId;
}

test('reading a team queue does not change the active team session', async () => {
    const teamA = await newTeam();
    const teamB = await newTeam();
    // Put the same agent on both teams so both queues are visible.
    const { rows: agents } = await pool.query('SELECT id FROM agents WHERE email = $1', [teamA.agents[0]]);
    await pool.query('INSERT INTO memberships (agent_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        agents[0].id,
        teamB.id,
    ]);

    const token = await signIn(base, teamA.agents[0]);

    await fetch(`${base}/api/teams/${teamA.id}/open`, { headers: authed(token) });
    assert.equal(await currentTeamId(token), teamA.id);

    const queue = await fetch(`${base}/api/teams/${teamB.id}/queue`, { headers: authed(token) });

    assert.equal(queue.status, 200);
    assert.equal(await currentTeamId(token), teamA.id);
});

test('opening a team changes the active team only via /open', async () => {
    const teamA = await newTeam();
    const teamB = await newTeam();
    const { rows: agents } = await pool.query('SELECT id FROM agents WHERE email = $1', [teamA.agents[0]]);
    await pool.query('INSERT INTO memberships (agent_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        agents[0].id,
        teamB.id,
    ]);

    const token = await signIn(base, teamA.agents[0]);

    await fetch(`${base}/api/teams/${teamA.id}/open`, { headers: authed(token) });
    assert.equal(await currentTeamId(token), teamA.id);

    const opened = await fetch(`${base}/api/teams/${teamB.id}/open`, { headers: authed(token) });

    assert.equal(opened.status, 200);
    assert.equal(await currentTeamId(token), teamB.id);
});
