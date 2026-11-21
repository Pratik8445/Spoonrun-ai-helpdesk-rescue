import { useEffect, useRef, useState } from 'react';

import { api, type Conversation } from '../api';
import { Composer } from './Composer';
import { CustomerHeader } from './CustomerHeader';
import { OrderCard } from './OrderCard';

interface Props {
    conversation: Conversation;
    agentId: number;
    onChanged: () => void;
    onBack: () => void;
}

function time(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stickToBottom(element: HTMLDivElement): void {
    element.scrollTop = element.scrollHeight;
}

function nearBottom(element: HTMLDivElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

export function ConversationPane({ conversation, agentId, onChanged, onBack }: Props) {
    const messagesRef = useRef<HTMLDivElement>(null);
    const previousId = useRef<number | null>(null);
    const previousCount = useRef(0);
    const [error, setError] = useState('');
    const isMine = conversation.assignedAgent?.id === agentId;

    useEffect(() => {
        const element = messagesRef.current;

        if (!element) {
            return;
        }

        const opened = previousId.current !== conversation.id;
        const grew = conversation.messages.length > previousCount.current;

        previousId.current = conversation.id;
        previousCount.current = conversation.messages.length;

        // Scroll on open, or when new messages arrive while already at the bottom.
        // Avoid forcing a jump when the desk refreshes for unrelated reasons.
        if (opened || (grew && nearBottom(element))) {
            stickToBottom(element);
        }
    }, [conversation.id, conversation.messages.length]);

    useEffect(() => {
        if (!isMine || !conversation.unread) {
            return;
        }

        api(`/conversations/${conversation.id}/read`, { method: 'POST' })
            .then(onChanged)
            .catch(err => console.error(err));
    }, [conversation.id, conversation.unread, isMine, onChanged]);

    async function act(action: 'take' | 'close') {
        setError('');

        try {
            await api(`/conversations/${conversation.id}/${action}`, { method: 'POST' });
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'something went wrong');
        }
    }

    let owner = 'Waiting for someone to take it';

    if (conversation.status === 'closed') {
        owner = 'Done';
    } else if (isMine) {
        owner = 'Yours';
    } else if (conversation.assignedAgent) {
        owner = `${conversation.assignedAgent.name} has this`;
    }

    return (
        <section className="conversation">
            <header className="conversation-head">
                <CustomerHeader customer={conversation.customer} onBack={onBack} />
                <div className="actions">
                    <span className="muted">{owner}</span>
                    {conversation.status === 'open' && !isMine && (
                        <button onClick={() => act('take')}>Take</button>
                    )}
                    {conversation.status === 'open' && isMine && (
                        <button className="secondary" onClick={() => act('close')}>
                            Done
                        </button>
                    )}
                </div>
            </header>
            {error && <p className="error">{error}</p>}
            <div className="messages" ref={messagesRef}>
                <OrderCard key={conversation.id} conversationId={conversation.id} />
                {conversation.messages.map(message => (
                    <div key={message.id} className={`message ${message.direction}`}>
                        {message.direction === 'out' && <span className="who">{message.agentName}</span>}
                        <p>{message.body}</p>
                        <span className="muted">{time(message.createdAt)}</span>
                    </div>
                ))}
            </div>
            {isMine && conversation.status === 'open' && (
                <Composer conversationId={conversation.id} onSent={onChanged} />
            )}
        </section>
    );
}
