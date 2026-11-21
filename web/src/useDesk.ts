import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type DeskData } from './api';

const REFRESH_EVERY_MS = 1500;

/** Cheap change check so a busy desk does not stringify the whole payload every 1.5s. */
function deskFingerprint(desk: DeskData): string {
    const parts = [
        String(desk.badge),
        String(desk.currentTeamId),
        desk.agent.id,
    ];

    for (const team of desk.teams) {
        parts.push(`t${team.id}:${team.waiting.join(',')};${team.mine.join(',')};${team.done.join(',')}`);
    }

    for (const id of Object.keys(desk.conversations)) {
        const conversation = desk.conversations[Number(id)];
        const last = conversation.messages[conversation.messages.length - 1];
        parts.push(
            [
                conversation.id,
                conversation.status,
                conversation.orderRef ?? '',
                conversation.unread ? 1 : 0,
                conversation.assignedAgent?.id ?? '',
                conversation.customer.name,
                conversation.messages.length,
                last?.id ?? '',
                last?.body.length ?? 0,
            ].join(':'),
        );
    }

    return parts.join('|');
}

export function useDesk() {
    const [desk, setDesk] = useState<DeskData | null>(null);
    const [version, setVersion] = useState(0);
    const lastSeen = useRef('');
    const inFlight = useRef(false);

    const refresh = useCallback(async () => {
        if (inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            const next = await api<DeskData>('/desk');
            const fingerprint = deskFingerprint(next);

            if (fingerprint === lastSeen.current) {
                return;
            }

            lastSeen.current = fingerprint;
            setDesk(next);
            setVersion(current => current + 1);
        } catch (err) {
            console.error(err);
        } finally {
            inFlight.current = false;
        }
    }, []);

    useEffect(() => {
        refresh();

        const timer = window.setInterval(refresh, REFRESH_EVERY_MS);

        return () => window.clearInterval(timer);
    }, [refresh]);

    return { desk, version, refresh };
}
