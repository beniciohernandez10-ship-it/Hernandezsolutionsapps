import { db } from "./db";
import { BUILT_IN_TEMPLATES } from "./templates";

/**
 * Load the built-in templates and the standard sequence. Safe to run on every deploy:
 * templates someone edited are left alone, and the sequence is only added when none exist.
 * Never creates leads, contacts or other sample data.
 */
export async function seedBuiltIns(log: (m: string) => void = () => {}) {
  let created = 0;
  let updated = 0;
  for (const t of BUILT_IN_TEMPLATES) {
    const existing = await db.template.findUnique({ where: { builtInKey: t.key } });
    const data = { name: t.name, channel: t.channel, industries: t.industries, subject: t.subject, body: t.body };
    if (!existing) {
      await db.template.create({ data: { ...data, builtInKey: t.key, builtIn: true } });
      created++;
    } else if (!existing.edited && (existing.body !== t.body || existing.subject !== t.subject || existing.name !== t.name || existing.industries.join() !== t.industries.join())) {
      await db.template.update({ where: { id: existing.id }, data });
      updated++;
    }
  }
  log(`Templates: ${created} added, ${updated} updated.`);
  if ((await db.sequence.count()) === 0) {
    await db.sequence.create({
      data: {
        name: "Standard 4-email sequence",
        description: "Industry first email, then three short follow-ups in the same thread. Every email waits for approval.",
        steps: {
          create: [
            { order: 1, delayDays: 0, sameThread: false },
            { order: 2, delayDays: 3, sameThread: true },
            { order: 3, delayDays: 5, sameThread: true },
            { order: 4, delayDays: 7, sameThread: true },
          ],
        },
      },
    });
    log("Added the standard 4-email sequence.");
  }
}
