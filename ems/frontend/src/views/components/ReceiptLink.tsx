// Receipt link for claim lists: one receipt opens in a new tab, several go to the claim, which lists them all.
import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAction } from "../../controllers/useAsync";
import { claimsApi } from "../../models/api";
import { download } from "../../models/http";
import type { ClaimSummary } from "../../models/types";
import { ErrorAlert, Spinner } from "./ui";

export function ReceiptLink({ claim }: { claim: ClaimSummary }) {
  const navigate = useNavigate();
  const viewer = useAction();
  const ids = claim.receipt_line_ids ?? [];
  if (ids.length === 0) return <span className="muted">—</span>;
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (ids.length === 1) viewer.run(() => download(claimsApi.receiptUrl(claim.id, ids[0]), true));
    else navigate(`/claims/${claim.id}`);
  };
  return (
    <>
      <button className="linkbtn" onClick={open} disabled={viewer.busy} aria-busy={viewer.busy || undefined}>
        {viewer.busy ? <><Spinner /> Opening</> : ids.length === 1 ? "View" : `View (${ids.length})`}
      </button>
      {viewer.error && <ErrorAlert error={viewer.error} />}
    </>
  );
}
