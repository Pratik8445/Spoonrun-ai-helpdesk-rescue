import { pool } from './db.js';

export interface ConversationSummary {
    id: number;
    customerName: string;
    preview: string;
    orderRef: string | null;
    lastCustomerMessageAt: string;
}

const SUMMARY_COLUMNS = `
    c.id,
    customers.name AS "customerName",
    c.order_ref AS "orderRef",
    c.last_customer_message_at AS "lastCustomerMessageAt",
    (SELECT m.body FROM messages m
     WHERE m.conversation_id = c.id AND m.direction = 'in'
     ORDER BY m.created_at DESC LIMIT 1) AS preview`;

/** Customers in a team nobody has taken yet, the ones to answer first on top. */
export async function listWaiting(teamId: number): Promise<ConversationSummary[]> {
    const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS}
         FROM conversations c JOIN customers ON customers.id = c.customer_id
         WHERE c.team_id = $1 AND c.status = 'open' AND c.assigned_agent_id IS NULL
         ORDER BY c.created_at ASC`,
        [teamId],
    );

    return rows;
}

export async function listMine(agentId: number, teamId: number): Promise<ConversationSummary[]> {
    const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS}
         FROM conversations c JOIN customers ON customers.id = c.customer_id
         WHERE c.team_id = $1 AND c.status = 'open' AND c.assigned_agent_id = $2
         ORDER BY c.last_customer_message_at DESC`,
        [teamId, agentId],
    );

    return rows;
}

export async function listDone(teamId: number): Promise<ConversationSummary[]> {
    const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS}
         FROM conversations c JOIN customers ON customers.id = c.customer_id
         WHERE c.team_id = $1 AND c.status = 'closed'
         ORDER BY c.last_customer_message_at DESC`,
        [teamId],
    );

    return rows;
}

/** The red number next to "Mine": conversations with customer messages the agent hasn't read. */
export async function countUnread(agentId: number): Promise<number> {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS unread
         FROM conversations c
         JOIN memberships ON memberships.team_id = c.team_id AND memberships.agent_id = $1
         LEFT JOIN reads ON reads.conversation_id = c.id AND reads.agent_id = $1
         WHERE c.status = 'open'
           AND c.assigned_agent_id = $1
           AND c.last_customer_message_at > COALESCE(reads.read_at, '-infinity'::timestamptz)`,
        [agentId],
    );

    return rows[0].unread;
}

/** The conversation, if it belongs to one of the agent's teams. */
export async function findConversation(agentId: number, conversationId: number) {
    const { rows } = await pool.query(
        `SELECT c.id, c.team_id AS "teamId", c.customer_id AS "customerId", c.status,
                c.assigned_agent_id AS "assignedAgentId", c.order_ref AS "orderRef"
         FROM conversations c
         JOIN memberships ON memberships.team_id = c.team_id AND memberships.agent_id = $1
         WHERE c.id = $2`,
        [agentId, conversationId],
    );

    if (rows.length === 0) {
        return null;
    }

    return rows[0];
}

export interface Message {
    id: number;
    direction: 'in' | 'out' | 'note';
    agentName: string | null;
    body: string;
    createdAt: string;
}

export interface ConversationDetail {
    id: number;
    teamId: number;
    status: 'open' | 'closed';
    assignedAgent: { id: number; name: string } | null;
    orderRef: string | null;
    customer: { id: number; name: string; phone: string };
    messages: Message[];
    unread: boolean;
}

export async function conversationDetail(agentId: number, conversationId: number): Promise<ConversationDetail | null> {
    const details = await conversationDetails(agentId, [conversationId]);
    return details[conversationId] ?? null;
}

/** Load many conversations for the desk in a few queries instead of one round-trip each. */
export async function conversationDetails(
    agentId: number,
    conversationIds: number[],
): Promise<Record<number, ConversationDetail>> {
    const ids = [...new Set(conversationIds.filter(id => Number.isFinite(id)))];

    if (ids.length === 0) {
        return {};
    }

    const { rows: conversations } = await pool.query(
        `SELECT c.id, c.team_id AS "teamId", c.customer_id AS "customerId", c.status,
                c.assigned_agent_id AS "assignedAgentId", c.order_ref AS "orderRef",
                customers.id AS "customerRowId", customers.name AS "customerName", customers.phone AS "customerPhone",
                agents.id AS "agentRowId", agents.name AS "agentName",
                COALESCE(
                    c.assigned_agent_id = $1
                    AND c.last_customer_message_at > COALESCE(reads.read_at, '-infinity'::timestamptz),
                    false
                ) AS unread
         FROM conversations c
         JOIN memberships ON memberships.team_id = c.team_id AND memberships.agent_id = $1
         JOIN customers ON customers.id = c.customer_id
         LEFT JOIN agents ON agents.id = c.assigned_agent_id
         LEFT JOIN reads ON reads.conversation_id = c.id AND reads.agent_id = $1
         WHERE c.id = ANY($2::int[])`,
        [agentId, ids],
    );

    const { rows: messages } = await pool.query(
        `SELECT m.conversation_id AS "conversationId", m.id, m.direction,
                agents.name AS "agentName", m.body, m.created_at AS "createdAt"
         FROM messages m
         LEFT JOIN agents ON agents.id = m.agent_id
         WHERE m.conversation_id = ANY($1::int[])
         ORDER BY m.created_at, m.id`,
        [ids],
    );

    const messagesByConversation = new Map<number, Message[]>();

    for (const message of messages) {
        const list = messagesByConversation.get(message.conversationId) ?? [];
        list.push({
            id: message.id,
            direction: message.direction,
            agentName: message.agentName,
            body: message.body,
            createdAt: message.createdAt,
        });
        messagesByConversation.set(message.conversationId, list);
    }

    const result: Record<number, ConversationDetail> = {};

    for (const conversation of conversations) {
        result[conversation.id] = {
            id: conversation.id,
            teamId: conversation.teamId,
            status: conversation.status,
            assignedAgent: conversation.agentRowId
                ? { id: conversation.agentRowId, name: conversation.agentName }
                : null,
            orderRef: conversation.orderRef,
            customer: {
                id: conversation.customerRowId,
                name: conversation.customerName,
                phone: conversation.customerPhone,
            },
            messages: messagesByConversation.get(conversation.id) ?? [],
            unread: conversation.unread,
        };
    }

    return result;
}
