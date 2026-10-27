# Hardware requests and approvers

A request for new equipment goes through five steps, shown to everyone on the request as a progress bar:

1. **Approval.** The requester submits **New hardware** (or any request type marked *Hardware order*). Nothing happens until it's approved. The approvers are:
   - the company's **named approvers** (Administration → Approvers), for example its office manager;
   - otherwise its **client administrators**;
   - otherwise Hernandez Solutions.

   Service managers can always approve. Approvers are notified, see the request on their Overview and can approve or decline it there. A declined request is closed and its order cancelled.
2. **Ordering.** Once approved, the request goes to the **ordering queue** (default: *Procurement*), unassigned. Whoever orders records the supplier, order number and expected delivery date and presses **Mark as ordered**. The requester gets a message with the expected date. They don't see the supplier or order number.
3. **Ordered.** While it's on its way, the order details can still be edited.
4. **Arrived.** When the box arrives, open the request and, for each item, pick its type and **scan or type the serial number**. Optionally add the manufacturer and model.
   - **Scanning:** in Chrome or Edge on Android, use **Scan** (camera). A USB barcode scanner works everywhere. On an iPhone, use the keyboard's **Scan Text**.
   - **Delivery:** choose whether a technician delivers and sets it up, or delivers it for the user to set up. **Computers (laptops and workstations) are always set up by a technician.**
   - **Receive and register:**
     - registers every item as an asset owned by the requester, with its own tag (LAPTOP-, WRKSTN-, MON-, PHONE-, TABLET-, DOCK-, PRINTER-, ACC-, HW-) and the serial number;
     - links the asset to the request;
     - moves the request to the **delivery queue** (default: *Technicians*), unassigned, so a technician can take it from Queues;
     - tells the requester it has arrived.

     A serial number that's already registered at that company is refused.
5. **Delivered.** The technician presses **Delivered and set up** (or **Delivered**), with an optional note. This resolves the request with a record of exactly what was handed over. It then closes automatically like any resolved request.

Asset labels for the received items print from the request ("Print asset labels"). Each asset's page shows the request it arrived through.

## Settings

- **Approvers:** Administration → Approvers. Pick people per company; they must be active members of it. Approvers only see requests that go through approval, not the rest of their company's tickets.
- **Queues:** Administration → Queues → *Hardware requests* sets the ordering and delivery queues.
- **Request types:** Administration → Service catalog. Tick **Hardware order** on any request type to use this flow; it also turns on approval.

Every step is recorded in the request's history and in the audit log (`approver.add`, `approver.remove`, `hardware.ordered`, `hardware.received`, `hardware.delivered`, `hardware.settings`).
