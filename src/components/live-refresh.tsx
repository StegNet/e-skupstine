"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { heartbeat } from "@/actions/participant";

/** Keeps assembly pages current and marks the viewer present.
 * shortcut: polls every 3 s (heartbeat every 15 s); move to SSE if a session regularly has more than ~300 people. */
export function LiveRefresh({ assemblyId }: { assemblyId: string }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (n++ % 5 === 0) heartbeat(assemblyId).catch(() => {});
      router.refresh();
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [assemblyId, router]);
  return null;
}
