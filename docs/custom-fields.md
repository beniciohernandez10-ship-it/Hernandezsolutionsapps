# Custom ticket fields

Extra questions on regular requests, set up under Administration → **Ticket fields** (platform operators).

- **Scope:** a field applies to one client or all of them, and to one category or all of them. The new-request form shows the fields for the chosen organization and category.
- **Types:** short text, paragraph, number, date, choice list (2–50 choices), yes/no.
- **Required** fields must be answered on the portal form. Requests that arrive by email skip them (nobody could answer), and catalog requests use their own forms instead.
- **Technicians only** fields are for your own notes (warranty claim number, vendor case). They're never shown to the client; the database enforces this too.
- **On the ticket:** answers show under *More details*. Technicians can change them (clearing an answer removes it). If a request moves to another category, answers to fields that no longer apply are kept and still shown.
- **Turning a field off** hides it from new requests and keeps existing answers. **Deleting** it removes every answer, so the portal asks first.

Changes to fields and to answers are in the audit log (`field.*`, `ticket.fields`).
