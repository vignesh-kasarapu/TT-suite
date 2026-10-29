// Claim detail controller: every action a viewer can take on one claim.
import { useState } from "react";
import { adminApi, approvalsApi, claimsApi } from "../models/api";
import { download } from "../models/http";
import type { ClaimDetail } from "../models/types";
import { useAction, useResource } from "./useAsync";

export function useClaimActions(claimId: number) {
  const res = useResource(["claim", claimId], () => claimsApi.get(claimId));
  const action = useAction();
  const [opening, setOpening] = useState<number | null>(null);

  const apply = async (fn: () => Promise<ClaimDetail | unknown>) => {
    const out = await action.run(fn);
    if (out !== undefined) await res.reload();
    return out !== undefined;
  };

  return {
    ...res,
    busy: action.busy,
    actionError: action.error,
    clearError: () => action.setError(null),
    approve: (stepId: number, amount?: number, comment?: string) => apply(() => approvalsApi.approve(stepId, amount, comment)),
    rejectLine: (stepId: number, reason: string) => apply(() => approvalsApi.rejectLine(stepId, reason)),
    sendBack: (reason: string) => apply(() => approvalsApi.sendBack(claimId, reason)),
    financeApprove: (comment?: string) => apply(() => approvalsApi.financeApprove(claimId, comment)),
    financeReject: (reason: string) => apply(() => approvalsApi.financeReject(claimId, reason)),
    clearDuplicate: (lineId: number, reason: string) => apply(() => approvalsApi.clearDuplicate(claimId, lineId, reason)),
    withdraw: () => apply(() => claimsApi.withdraw(claimId)),
    comment: (body: string) => apply(() => claimsApi.comment(claimId, body)),
    reassign: (stepId: number, approverId: number) => apply(() => adminApi.reassign(stepId, approverId)),
    /** The line whose receipt is being fetched, so only its button shows a spinner. */
    opening,
    openReceipt: async (lineId: number) => {
      setOpening(lineId);
      try { await action.run(() => download(claimsApi.receiptUrl(claimId, lineId), true)); } finally { setOpening(null); }
    },
  };
}
