# Approval workflows

Catalog items can need approval in several steps. Set them up under Administration → **Service catalog** → an item → *Approval steps* (tick *Needs the client's approval* to show them). With no steps, an item that needs approval gets one step with the company's usual approvers, as before.

## Steps

- **In order.** A request is approved when its last step is. The technician checklist (and, for hardware, the ordering queue) only starts then.
- **Approvers.** Each step asks one or more of: the company's usual approvers (named approvers, otherwise its client administrators, otherwise Hernandez Solutions), the client's administrators, Hernandez Solutions service managers, or a named person.
- **Any or all.** Approvers on a step decide at the same time. *Any one of them* finishes the step at the first approval; *All of them* waits for each.
- **Conditions.** A step can apply only when a form answer matches: is, is not, contains, more than, less than. "Cost more than 1000" reads `$1,500.00` as 1500. A blank or unreadable answer never satisfies a number comparison. If no steps apply, the request needs no approval.
- **Rejecting.** Any rejection ends the request, with a reason the requester sees.
- **Fixed at submission.** The steps that apply are saved on the request, so editing the item later doesn't change requests in flight.

Service managers can always decide. Someone who could approve their own request skips that step. A named person who has left the company is replaced by the usual approvers.

A named person who is otherwise a plain requester can open the requests they're asked to approve, and reply to them, but not other people's requests.

## Delegation

Approvers can pick a stand-in for a date range under **Settings → Approvals while you're away** (dates are Pacific time). The stand-in is notified, sees the requests, and each decision records who it was made for. A stand-in can't approve their own request, and must belong to the same company.

## Approving by email

Approval emails can be answered when email intake is set up (`docs/email-setup.md`). Otherwise they only link to the request.

- **Approve:** a first line that is only `approve`, `approved`, `yes` or `ok`, or `approve: note`.
- **Reject:** `reject`, `decline` or `deny` first, then the reason. A rejection without a reason isn't accepted.
- **Anything else decides nothing.** "Ok, let me check with finance", a question, a reply from a different address, or a reply after the step is finished goes to Email inbox for a person to review.

Every decision is in the audit log (`ticket.approval`, with the step, who it was for, and whether it came by email); delegations are `approval.delegate` and `approval.delegate_removed`.
