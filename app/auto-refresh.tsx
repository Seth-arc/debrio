"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// shortcut: polls the server-rendered page every few seconds; replace with
// private Realtime hints (architecture D3 note) when live updates are built.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      // A refresh must not interrupt a command's pending server-action response.
      if (!document.querySelector('[data-pending="true"]')) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
