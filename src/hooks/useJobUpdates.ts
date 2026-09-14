/** Mirrors Rust-side background job progress into the UI store (section 53). */

import { useEffect } from "react";
import { backend } from "@/services/backend";
import { useUIStore } from "@/store/uiStore";

export function useJobUpdates(): void {
  useEffect(() => {
    const unsubscribe = backend().onJobUpdate((job) => {
      useUIStore.getState().upsertJob(job);
    });
    void backend()
      .listJobs()
      .then((jobs) => useUIStore.getState().setJobs(jobs))
      .catch(() => {
        /* the mock backend has no jobs */
      });
    return unsubscribe;
  }, []);
}
