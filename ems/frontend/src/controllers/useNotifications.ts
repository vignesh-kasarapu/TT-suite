import { useEffect, useState } from "react";
import { approvalsApi, notificationsApi } from "../models/api";
import type { Level } from "../models/types";

export interface Badges {
  unread: number;
  /** Claims (not lines) waiting for me, per level. */
  levels: Record<Level, number>;
}

const ZERO: Record<Level, number> = { L1: 0, L2: 0, FINANCE: 0 };

/** Counts for the sidebar and the bell. Polls every 60 s and on "ems:refresh-badges". */
export function useBadges(enabled: boolean, wantsInbox: boolean): Badges {
  const [unread, setUnread] = useState(0);
  const [levels, setLevels] = useState(ZERO);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = () => {
      notificationsApi.unread().then((r) => alive && setUnread(r.count)).catch(() => {});
      if (wantsInbox) {
        approvalsApi.inbox().then((items) => {
          if (!alive) return;
          const seen = { L1: new Set<number>(), L2: new Set<number>(), FINANCE: new Set<number>() };
          items.forEach((i) => seen[i.level].add(i.claim_id));
          setLevels({ L1: seen.L1.size, L2: seen.L2.size, FINANCE: seen.FINANCE.size });
        }).catch(() => {});
      }
    };
    tick();
    const t = setInterval(tick, 60_000);
    window.addEventListener("ems:refresh-badges", tick);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("ems:refresh-badges", tick);
    };
  }, [enabled, wantsInbox]);

  return { unread, levels };
}

export const refreshBadges = () => window.dispatchEvent(new Event("ems:refresh-badges"));
