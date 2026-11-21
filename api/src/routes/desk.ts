import { Router } from 'express';

import { requireAgent } from '../auth.js';
import { pool } from '../db.js';
import { conversationDetails, type ConversationDetail, countUnread, listDone, listMine, listWaiting } from '../queries.js';

export const deskRouter = Router();

interface TeamLists {
    id: number;
    name: string;
    waiting: number[];
    mine: number[];
    done: number[];
}

/** Everything the desk screen shows, in one answer. */
deskRouter.get('/desk', requireAgent, async (req, res) => {
    const agent = req.agent!;

    const { rows: sessions } = await pool.query(
        'SELECT current_team_id AS "currentTeamId" FROM sessions WHERE token = $1',
        [req.sessionToken],
    );

    const { rows: teamRows } = await pool.query(
        `SELECT teams.id, teams.name FROM teams
         JOIN memberships ON memberships.team_id = teams.id
         WHERE memberships.agent_id = $1
         ORDER BY teams.id`,
        [agent.id],
    );

    const teams: TeamLists[] = [];
    const allIds: number[] = [];

    for (const team of teamRows) {
        const lists: TeamLists = { id: team.id, name: team.name, waiting: [], mine: [], done: [] };

        for (const summary of await listWaiting(team.id)) {
            lists.waiting.push(summary.id);
        }

        for (const summary of await listMine(agent.id, team.id)) {
            lists.mine.push(summary.id);
        }

        for (const summary of await listDone(team.id)) {
            lists.done.push(summary.id);
        }

        allIds.push(...lists.waiting, ...lists.mine, ...lists.done);
        teams.push(lists);
    }

    const conversations: Record<number, ConversationDetail> = await conversationDetails(agent.id, allIds);

    res.json({
        agent,
        currentTeamId: sessions[0].currentTeamId,
        badge: await countUnread(agent.id),
        teams,
        conversations,
    });
});

deskRouter.get('/badge', requireAgent, async (req, res) => {
    res.json({ unread: await countUnread(req.agent!.id) });
});
