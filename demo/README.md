# Demo data

A generated mailbox and calendar for the hosted demo. Nothing in them is real:
the people, companies and messages are made up, and every address is on a
reserved domain (`*.example`, `*.test`, `example.com`; RFC 2606/6761).

| File | Contents |
|---|---|
| `Email/sample.mbox` | 801 messages, October 2024 – September 2026, owner `you@example.com` |
| `Calendar/sample.ics` | 34 one-off meetings and 3 recurring series |

Imported with the owner `you@example.com`, they give 78 contacts, 61 of them
on the graph and 17 filtered as spam (automated senders and one-way
contacts), 9 domain groups, 33 message groups and 29 event groups.

The files are fixed: the demo replays the same data on every deploy.

## Calendar dates

`fill_events` keeps only the events of the last 730 days and expands
recurring events up to now. For this calendar to give the same result every
year, run it with `FILL_EVENTS_NOW=2026-10-01`, the day after the data ends:

```bash
FILL_EVENTS_NOW=2026-10-01 fill_events demo/Calendar --db contacts.db --user-email you@example.com
```

Not to be confused with `gmail-mbox-parser/tests/fixtures/sample.mbox`, the
parser test fixture, which tests assert exactly.
