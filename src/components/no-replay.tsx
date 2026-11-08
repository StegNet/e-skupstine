"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Stops Sentry Session Replay while this page is open, and resumes it in the same mode on leaving.
 * Used on the ballot and committee pages: masking hides text, but the recorded cursor and clicks would still show
 * which option someone picked. */
export function NoReplay() {
  useEffect(() => {
    const replay = Sentry.getReplay();
    const mode = replay?.getRecordingMode();
    if (!replay || !mode) return;
    void replay.stop();
    return () => (mode === "buffer" ? replay.startBuffering() : replay.start());
  }, []);
  return null;
}
