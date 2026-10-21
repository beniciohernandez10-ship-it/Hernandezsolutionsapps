# AI assistant (Claude)

The IT Center can use Claude (Anthropic) to help technicians and requesters. Everything it produces is a suggestion: nothing is sent to a customer or changed on a ticket until a person presses a button.

## What it does

| Where | Who | What |
| --- | --- | --- |
| Ticket → reply box → **Draft with AI** | Technicians | Drafts the next public reply from the request, the public conversation and matching help articles. The draft lands in the reply box to edit; it is never sent automatically. The articles it relied on are listed under the box. |
| Ticket → **AI assistant** card → **Summarize and suggest** | Technicians | A short summary, a suggested category and priority, and up to four next steps. **Use priority** applies the suggested priority (a normal, audited ticket update). |
| New request → **Get steps from the assistant** | Everyone in the organization | Appears only when published help articles match what they typed. Claude answers **only from those articles** and links them; if they don't cover the problem it says so, and the person submits the request as usual. |

## What is sent to Anthropic, and what is not

Sent, only when someone presses one of the buttons above:

- the request's title, description (or catalog answers), status, priority and category, and the requester's name;
- the **public** conversation (most recent 20 messages);
- up to three published help articles meant for all clients or for that client.

Never sent: private notes, technician-only articles, other clients' articles, attachments, device or license data, email addresses.

Text written by customers is wrapped in delimiters and Claude is told to treat it as information, not instructions. Output is shown as plain text (never HTML), and drafts always pass through a technician.

The `ai_requests` table records each call (customer, user, feature, ticket, model, outcome, token counts) for cost tracking. It stores no prompt or response text and is readable only by the server.

## Turning it on

1. Create an API key in the Anthropic Console (console.anthropic.com → API keys). Set a monthly spend limit there.
2. In Vercel → `hernandez-solutions-portal` → Settings → Environment Variables, add `ANTHROPIC_API_KEY` for Production (and Preview if wanted). Don't paste the key into chat, tickets or the repo.
3. Redeploy.
4. In the portal, **Administration** → the customer → **Turn on AI assistant**. It is off for every customer by default, because turning it on means that customer's ticket text goes to Anthropic when the assistant is used. Consider telling the client before you turn it on.

Without `ANTHROPIC_API_KEY` the assistant is hidden everywhere, even for customers where it is turned on.

Optional: `AI_MODEL` overrides the model (default `claude-opus-5-5`).

## Behaviour and limits

- Model: Claude Opus 5.5 with structured JSON output, validated again in the app. Triage and self-help run at low effort; drafts at medium.
- If Claude declines a request, the API retries it on Anthropic's recommended fallback model (`fallbacks: "default"`); if that also declines, the person sees "The assistant can't help with this one."
- Rate limits: technicians 60 assistant calls per hour; requesters 10 self-help answers per hour (plus the per-route limits).
- Errors: a rejected API key shows "The AI assistant's API key was rejected"; other upstream failures ask the person to try again. Nothing is retried automatically beyond one SDK retry.
- AI output can be wrong. Technicians should read every draft before sending.
