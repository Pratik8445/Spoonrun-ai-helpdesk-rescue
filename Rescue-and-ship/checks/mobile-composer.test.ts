import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('mobile styles keep the reply composer in document flow', () => {
    const css = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');
    const mobile = css.split('@media (max-width: 700px)')[1] ?? '';

    assert.match(mobile, /composer/);
    assert.doesNotMatch(mobile, /\.composer\s*\{[^}]*position:\s*fixed/);
});

test('conversation pane only auto-scrolls on open or new messages near the bottom', () => {
    const source = readFileSync(new URL('../web/src/components/ConversationPane.tsx', import.meta.url), 'utf8');

    assert.match(source, /function nearBottom/);
    assert.match(source, /opened \|\| \(grew && nearBottom\(element\)\)/);
});

test('desk does not remount panes on every poll version bump', () => {
    const source = readFileSync(new URL('../web/src/components/Desk.tsx', import.meta.url), 'utf8');

    assert.doesNotMatch(source, /key=\{version\}/);
});
