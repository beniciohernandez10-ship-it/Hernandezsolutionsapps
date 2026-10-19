"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  side?: "right" | "left";
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col border border-border bg-surface shadow-xl focus:outline-none",
          side === "left"
            ? "inset-y-0 left-0 w-72 max-w-[85vw]"
            : side === "right"
              ? "inset-y-0 right-0 w-[min(520px,100vw)]"
              : "left-1/2 top-1/2 max-h-[90vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-lg",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
