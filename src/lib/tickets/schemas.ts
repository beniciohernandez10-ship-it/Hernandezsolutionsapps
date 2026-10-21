import { z } from "zod";

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const CATEGORIES = ["general", "account_access", "hardware", "software", "network", "email", "security", "other"] as const;
export const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
};
export const CATEGORY_LABEL: Record<Category, string> = {
  general: "General question",
  account_access: "Account or sign-in",
  hardware: "Hardware",
  software: "Software",
  network: "Network or Wi-Fi",
  email: "Email",
  security: "Security",
  other: "Other",
};

const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(min, { error: `${label} must be at least ${min} characters.` })
        .max(max, { error: `${label} must be at most ${max} characters.` })
        // Control characters other than tab/newline are never legitimate in ticket text.
        .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), { error: `${label} contains invalid characters.` }),
    );

export const createTicketSchema = z.object({
  title: text(3, 200, "Title"),
  description: text(1, 20000, "Description"),
  priority: z.enum(PRIORITIES, { error: "Choose a priority." }),
  category: z.enum(CATEGORIES, { error: "Choose a category." }),
  customerId: z.uuid().optional(),
  deviceId: z.uuid().optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const addMessageSchema = z.object({
  body: text(1, 20000, "Message"),
  visibility: z.enum(["public", "internal"]).default("public"),
});

export const updateTicketSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeUserId: z.uuid().nullable().optional(),
    queueId: z.uuid().nullable().optional(),
    /** What fixed it. Required when a technician resolves; an optional comment when the requester confirms. */
    resolution: z
      .string()
      .transform((s) => s.replace(/\r\n/g, "\n").trim())
      .pipe(z.string().max(5000, { error: "Resolution details must be at most 5000 characters." }))
      .optional(),
  })
  .refine((v) => v.status || v.priority || v.assigneeUserId !== undefined || v.queueId !== undefined, {
    error: "Nothing to update.",
  });
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const listTicketsSchema = z.object({
  customerId: z.uuid().optional(),
  status: z.enum([...STATUSES, "active"]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(200).optional(),
  assigned: z.enum(["me", "unassigned"]).optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTicketsInput = z.infer<typeof listTicketsSchema>;

export const linkDeviceSchema = z.object({ deviceId: z.uuid() });
