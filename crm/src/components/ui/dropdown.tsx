"use client";

import { DropdownMenu as M } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ className, align = "end", ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-lg", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn("flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted", className)}
      {...props}
    />
  );
}

export const DropdownSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
export const DropdownLabel = ({ children }: { children: React.ReactNode }) => <M.Label className="px-2 py-1 text-xs text-subtle">{children}</M.Label>;
