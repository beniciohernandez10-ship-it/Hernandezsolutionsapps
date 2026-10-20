"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/client-api";

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn"
      disabled={busy || pending}
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch("/api/notifications/read", { method: "POST", body: { all: true } });
          start(() => router.refresh());
        } finally {
          setBusy(false);
        }
      }}
    >
      Mark all as read
    </button>
  );
}
