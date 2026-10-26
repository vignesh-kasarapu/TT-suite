// Display formatting shared by every view (theme.md §5: dates DD MMM YYYY, time zone named).
import type { IconName } from "../views/components/Icon";
import type { ClaimStatus, Level } from "./types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : inr.format(n));

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
});
export const date = (s: string | null | undefined) => (s ? dateFmt.format(new Date(s.length === 10 ? `${s}T00:00:00+05:30` : s)) : "—");
export const dateTime = (s: string | null | undefined) => (s ? `${dateTimeFmt.format(new Date(s))} IST` : "—");

export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const monthIso = () => todayIso().slice(0, 7);

export const LEVEL: Record<Level, string> = { L1: "Level 1", L2: "Level 2", FINANCE: "Finance" };

export type Tone = "muted" | "accent" | "ok" | "warn" | "bad" | "solid" | "strong";
/** [label, tone, icon] - the icon is a small line symbol in front of the label. */
export type Badge = [string, Tone, IconName];
export const STATUS: Record<ClaimStatus, Badge> = {
  PENDING_APPROVAL: ["Under review", "muted", "clock"],
  PENDING_FINANCE: ["With finance", "muted", "search"],
  READY_FOR_PAYROLL: ["Approved", "muted", "check"],
  SENT_TO_PAYROLL: ["Approved", "muted", "check"],
  PAID: ["Paid", "solid", "wallet"],
  PAYMENT_FAILED: ["Payment failed", "bad", "warn"],
  REJECTED: ["Rejected", "bad", "x"],
  SENT_BACK: ["Returned", "strong", "undo"],
  WITHDRAWN: ["Withdrawn", "strong", "undo"],
};

/** Admin "Stage" pill (wireframe All claims). */
export const STAGE: Record<string, [Tone, IconName]> = {
  "Manager approval": ["muted", "clock"], "Second approval": ["muted", "clock"], "Finance review": ["muted", "search"],
  "Approved for payment": ["muted", "check"], Paid: ["solid", "wallet"], Returned: ["strong", "undo"], Withdrawn: ["strong", "undo"],
  Rejected: ["bad", "x"], "Payment failed": ["bad", "warn"],
};

export const LINE_STATUS: Record<string, Badge> = {
  PENDING: ["Pending", "accent", "clock"],
  APPROVED: ["Approved", "muted", "check"],
  REJECTED: ["Rejected", "bad", "x"],
};

export const STEP_STATUS: Record<string, Badge> = {
  PENDING: ["Waiting", "accent", "clock"],
  APPROVED: ["Approved", "ok", "check"],
  REJECTED: ["Rejected", "bad", "x"],
  SKIPPED: ["Skipped", "muted", "chev"],
  SENT_BACK: ["Sent back", "warn", "undo"],
  CANCELLED: ["Cancelled", "muted", "ban"],
};

export const ADVANCE_STATUS: Record<string, Badge> = {
  OPEN: ["Open", "accent", "wallet"],
  SETTLED: ["Settled", "ok", "check"],
  RECOVERY_REQUESTED: ["Recovery in next payroll", "warn", "clock"],
  RECOVERED: ["Recovered", "ok", "check"],
};

/** Policy result on an expense line: Block stops it, Flag needs a reason, Warn is a note. */
export const FLAG: Record<string, [string, IconName]> = { BLOCK: ["Blocked", "ban"], FLAG: ["Over limit", "flag"], WARN: ["Note", "warn"] };

/** Notifications carry no type, so the icon is read from the message wording. */
export function notificationIcon(message: string): IconName {
  const m = message.toLowerCase();
  if (m.includes("commented")) return "chat";
  if (m.includes("failed")) return "warn";
  if (m.includes("paid") || m.includes("payroll")) return "wallet";
  if (m.includes("rejected")) return "x";
  if (m.includes("returned") || m.includes("sent back") || m.includes("withdrawn")) return "undo";
  if (m.includes("waiting") || m.includes("assigned") || m.includes("moved to you") || m.includes("ready for")) return "inbox";
  if (m.includes("approved")) return "check";
  return "bell";
}

export const ROLE_NAMES: Record<string, string> = { APPROVER: "Manager", FINANCE: "Finance Reviewer", ADMIN: "Administrator" };
