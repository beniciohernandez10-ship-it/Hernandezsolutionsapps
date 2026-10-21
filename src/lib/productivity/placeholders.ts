/** Saved-reply fill-ins. Pure, so the reply box in the browser can use it too. */
export function fillPlaceholders(body: string, v: { requesterName: string; ticketNumber: number; technicianName: string }) {
  return body
    .replace(/\{\{\s*requester_first_name\s*\}\}/g, v.requesterName.split(/\s+/)[0] ?? "")
    .replace(/\{\{\s*requester_name\s*\}\}/g, v.requesterName)
    .replace(/\{\{\s*ticket_number\s*\}\}/g, `#${v.ticketNumber}`)
    .replace(/\{\{\s*technician_name\s*\}\}/g, v.technicianName);
}
