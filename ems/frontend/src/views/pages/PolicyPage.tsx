// Categories & policy (wireframe 9): one table, a heading row per group.
import { Fragment } from "react";
import { useResource } from "../../controllers/useAsync";
import { lookupsApi } from "../../models/api";
import { money } from "../../models/format";
import { Empty, ErrorAlert, PageHead, Skeleton } from "../components/ui";

export function PolicyPage() {
  const { data, error, loading, reload } = useResource(["lookups", "policy"], lookupsApi.policy);
  const groups = [...new Set((data?.categories ?? []).map((c) => c.group))];

  return (
    <>
      <PageHead title="Categories & policy"
        sub={`${data ? `Expenses above ${money(data.level2_above)} also need the second approver.` : ""}${data?.late_submission_days ? ` Claim expenses within ${data.late_submission_days} days.` : ""}`} />
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? <Skeleton rows={6} /> : !groups.length ? (
        <div className="list-wrap"><Empty icon="shield" title="No categories yet">The Admin has not added any categories.</Empty></div>
      ) : (
        <div className="list-wrap rl-scroll">
          <table className="plain">
            <thead><tr><th>Category</th><th>Limit</th><th>Receipt</th><th>Over limit</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr className="group"><td colSpan={4}>{g}</td></tr>
                  {data!.categories.filter((c) => c.group === g).map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}{c.description && <span className="sub"> · {c.description}</span>}</td>
                      <td>{c.limits.length ? c.limits.map((l) => <div key={l.text + l.applies_to}>{l.text}{l.applies_to !== "Everyone" && <span className="sub"> · {l.applies_to}</span>}</div>) : "No limit"}</td>
                      <td className="muted">{c.receipt}{c.extra_field && `, with ${c.extra_field.toLowerCase()}`}</td>
                      <td className="muted">{[...new Set(c.limits.map((l) => l.over_limit))].join(", ") || "—"}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
