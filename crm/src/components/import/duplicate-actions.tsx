"use client";

import { Combine, CopyPlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { resolveDuplicateAction } from "@/app/(app)/import/actions";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";

export function DuplicateActions({ id }: { id: string }) {
  const router = useRouter();
  const { run, pending } = useServerAction(resolveDuplicateAction);
  const go = async (d: "MERGED" | "KEPT_SEPARATE" | "DISCARDED") => { const r = await run(id, d); if (r?.ok) router.refresh(); };
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="primary" disabled={pending} onClick={() => go("MERGED")}><Combine /> Same business: fill in blanks</Button>
      <Button disabled={pending} onClick={() => go("KEPT_SEPARATE")}><CopyPlus /> Different business: add it</Button>
      <Button variant="danger-ghost" disabled={pending} onClick={() => go("DISCARDED")}><Trash2 /> Discard incoming</Button>
      <p className="w-full text-xs text-muted">Merging only fills empty fields and adds new contacts; it never overwrites the existing prospect.</p>
    </div>
  );
}
