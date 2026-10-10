# Device registry and QR asset labels

Technicians register each PC the IT Center manages. Registering gives the device a name, a primary user, a location and a printable QR label.

## Names

- Workstations are named `WRKSTN-001`, `WRKSTN-002` and so on. Laptops are named `LAPTOP-001`, `LAPTOP-002` and so on.
- Each customer has its own numbering. Numbers come from `app_next_asset_number`, which locks the customer's counter row, so two technicians registering at the same moment never get the same name.
- A retired device keeps its name, and that number is never handed out again.
- Numbers pad to three digits. From 1000 they simply grow (`WRKSTN-1000`). Names stay at or under 15 characters, the Windows computer-name (NetBIOS) limit, so the same name can be used on the PC itself.
- The portal does **not** rename the PC. A technician sets the computer name by hand. Renaming through Intune would need `DeviceManagementManagedDevices.PrivilegedOperations.All`, which is deliberately not requested (see [microsoft-setup.md](microsoft-setup.md)).
- When a PC with the same name reports in from Intune or Atera, the registry shows it as "Reported in" with its compliance state. The match is by name only.

## Primary user

- When the customer's Microsoft tenant has consented to the inventory app, the picker searches that customer's Microsoft directory (Graph `GET /users` with `$search`, `ConsistencyLevel: eventual`). Disabled accounts are hidden.
- On save, the server reads the chosen user again by object ID (`GET /users/{id}`) and only from a tenant that consented for **that** customer. Names typed into the browser are never trusted.
- Without consent, or before Graph is configured, the picker falls back to the customer's portal members and says so.
- "None (shared device)" is allowed.

Requires the `User.Read.All` application permission on the inventory app registration. Each customer must consent again after it is added.

## Location

Free text, up to 120 characters. Examples: "Main office, front desk" or "Exam room 3".

## QR labels

- The QR code holds a short link: `{APP_ORIGIN}/a/{code}`. The code is 10 random characters and contains no names or IDs.
- Opening the link requires signing in, and the device page is shown only to that customer's admins and to Hernandez Solutions staff. Anyone else gets "not found".
- The label also prints the device name in large type and "Scan for IT support".
- **The address printed in the QR code cannot change after a label is printed.** Set `APP_ORIGIN` to the final portal address (`https://portal.thehernandezsolutions.com`) before printing labels for real devices.

### Printing on a Brother PT-D610BT (P-Touch D610BTVP)

Use 24 mm TZe tape. Each label is 64 × 24 mm.

**From a computer (USB):**
1. Open the device page and choose **Print label**, or choose **Print all labels** on the Devices page.
2. In the print dialog choose the Brother PT-D610BT, set the paper to 24 mm tape, margins to none, and scale to 100%.
3. The labels page sets each printed page to exactly 64 × 24 mm, one label per page. Other portal pages keep the normal paper size.

**From a phone (Bluetooth):**
1. On the device page choose **Download PNG**. The image is 360 dpi at 64 × 24 mm.
2. Open it in Brother's P-touch Design&Print 2 app and print on 24 mm tape.

Verified: the printed PDF has one 180.96 × 67.92 pt (64 × 24 mm) page per label, and the QR code decodes from a 180 dpi render, which is the PT-D610BT's print resolution. Not yet tested on a physical printer.

## Permissions

| Action | Requester | Client admin | Technician / service manager |
| --- | --- | --- | --- |
| See registered devices and labels | no | own organization | assigned customers |
| Register, edit, retire | no | no | assigned customers |

Enforced in the service layer and by PostgreSQL row-level security (`assets`, `asset_events`). The counter table is reachable only through `app_next_asset_number`, which checks that the caller is staff for the customer.

Every change is recorded in the device's history and in `audit_events` (`asset.registered`, `asset.user_changed`, `asset.location_changed`, `asset.notes_changed`, `asset.retired`, `asset.reactivated`).
