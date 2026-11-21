# For Nadia

Keep it short and write it for someone who isn't technical. Bullet points are fine. The judges read
this first.

## Friday lunch: before and after

Paste the `npm run shift` report from before your changes and from your final version.

```
before:

Friday lunch, replayed: 30 customers and 10 restaurants write in over an hour;
Kofi and Ines answer the Customers queue.

Messages
  customer messages shown twice or more        16   ✗
  messages the provider had to send again      32   ✗

Taking customers
  customers answered                           8
  customers taken by Kofi and Ines at once     8   ✗
  customers who got two different answers      8   ✗

Who waited
  top of the queue                             Eva C., waiting 20 min (Ana P.: 60 min)   ✗
  answered before someone who waited longer    8   ✗
  longest wait still unanswered                60 min (Ana P.)

The red number next to "Mine"
  Kofi's badge                                 35 (really 0)   ✗
  Ines's badge                                 35 (really 3)   ✗

The replay took 10.6 s.

after:

Friday lunch, replayed: 30 customers and 10 restaurants write in over an hour;
Kofi and Ines answer the Customers queue.

Messages
  customer messages shown twice or more        0   ✓
  messages the provider had to send again      0   ✓

Taking customers
  customers answered                           16
  customers taken by Kofi and Ines at once     0   ✓
  customers who got two different answers      0   ✓

Who waited
  top of the queue                             Ana P., waiting 60 min   ✓
  answered before someone who waited longer    0   ✓
  longest wait still unanswered                33 min (Sara F.)

The red number next to "Mine"
  Kofi's badge                                 3 (really 3)   ✓
  Ines's badge                                 3 (really 3)   ✓

The replay took 0.8 s.
A good lunch: every message shown once, every customer answered by one person, the longest wait answered first, and badges that tell the truth.
```

## What was wrong

For each problem you found: what the team or the customers saw, what was really going on (in plain
words), and how you found it.

- **Longest waiters lost their place.** Maria waited 38 minutes while people who kept writing
  “hello??” jumped ahead. The waiting list was sorting by “latest message,” so a nudge pushed you
  to the top. Team chat, Maria’s email, and the Friday lunch replay (Eva C. on top while Ana P.
  had waited an hour).
- **The red “Mine” number lied.** Kofi and Ines both saw huge badges with almost nothing new. The
  count included chats that weren’t theirs. Replay: 35 for both when the real numbers were 0 and 3.
- **Two agents could “Take” the same customer.** Lucas got a refund from one person and a voucher
  from another. Kofi and Pablo both clicked Take and both got “Yours.” Replay: 8 double Takes,
  8 customers with two different answers.
- **Customer messages appeared twice (or more).** Pablo saw duplicates; Kofi answered the same
  note twice. The messaging provider resent when we were too slow to confirm, and we stored each
  resend as a new message. Replay: 16 chats with duplicates, and 32 provider resends.
- **Hovering a team name switched teams.** Ines came back from coffee in Restaurants without
  clicking. Moving the mouse over the team tabs changed the active team. That also explains Pablo
  typing a Customers reply after thinking he’d opened Restaurants.
- **Phone (Marta’s weekends) fought her.** The reply box covered the last customer message; the
  keyboard hid what she was typing; opening a chat jumped a second later and she tapped the wrong
  thing.
- **Yuki saw “Sushi Mar” on the wrong chats.** Opening Pizzeria Nonna still showed Sushi Mar. Two
  causes: (1) restaurant messages were being linked to a customer order by the restaurant’s phone
  number — Nonna’s number mapped to an order labelled Sushi Mar; (2) the name at the top of the
  chat didn’t update when switching chats, so the previous restaurant’s name stuck.
- **App review “screen freezing.”** The desk asked the server for every open chat one-by-one every
  1.5 seconds, and the browser could start a new refresh before the last one finished. Under load
  that made the screen feel stuck. Confirmed in the desk code and polling loop; not a separate
  “freeze” feature.

## What I fixed, and why these first

- **Waiting list → longest wait first.** Polite customers stop waiting behind “hello??” nudges.
- **“Mine” badge → only your unread chats.** The team can trust the red number again.
- **Take → only one agent wins.** Stops double refunds/vouchers like Lucas got.
- **Duplicates + slow confirms → store each provider delivery once, and confirm immediately.**
  Looking up the order was delaying our “got it” for over a second on many phones, so the provider
  kept resending. We now confirm first and attach the order right after. Replay: 0 duplicates,
  0 resends.
- **Team switch → click only.** Hover only peeks at the queue; it does not change the team.
- **Mobile chat → reply box under the messages, typing stays visible with the keyboard, no jump
  on open.** Marta can work from her phone without mis-taps.
- **Restaurant order header → do not attach customer orders to restaurant chats; clear any wrong
  link; keep the chat name in sync when switching.** Yuki’s Nonna/Sushi Mar mix-up is gone.
- **Desk refresh → load all open chats in a few queries, skip overlapping polls, and stop
  re-stringifying the whole desk every tick.** Same behaviour, less freezing under lunch load.

These first because they were hurting customers and burning agent time every busy hour.

## What I left, and why

- **Dark mode (Marta).** There is no half-built theme to finish — only a request. Building a new
  theme system now would risk the lunch fixes for comfort that can wait.
- **Finance refund/voucher download (Olu).** There is no export button or report code yet. Olu said
  any time before December is fine, so inventing a full Finance feature mid-rescue would be the
  wrong trade. Deadline unchanged.

## Technical notes (optional, for the next developer)

- Waiting queue: `listWaiting` orders by conversation `created_at ASC`.
- Badge: `countUnread` scopes to the logged-in agent’s open assigned conversations.
- Take: conditional `UPDATE … WHERE assigned_agent_id IS NULL`; loser gets 409; note only on win.
- Webhook: unique `messages.provider_message_id` + `ON CONFLICT DO NOTHING`. Ack after the message
  is stored; attach `order_ref` via background `latestOrderFor` so the provider’s 1s timeout is
  never hit by the slow orders service. **Skip attach (and clear `order_ref`) when
  `channel === 'restaurants'`.** Migration:
  `db/03_messages_provider_message_id_unique.sql` (already applied here).
- Team hover: prefetch `/teams/:id/queue` only; `/open` only on click.
- Mobile: composer in document flow; desk height tracks `visualViewport`; scroll only on open /
  new messages near bottom; removed `key={version}` remount on desk poll.
- Customer header: resync `name` when `customer.id` / `customer.name` changes; OrderCard keyed by
  conversation id.
- Desk: `conversationDetails(agentId, ids)` batches membership-scoped conversations + messages;
  client `useDesk` uses an in-flight guard + fingerprint instead of `JSON.stringify(next)`.
- `dev:api` forces `PORT=3000` so a shell `PORT=5173` cannot steal Vite’s port.
- Extra checks under `checks/`. Do not edit read-only `test/`, `scripts/shift.ts`, or
  `api/src/orders.ts`.
