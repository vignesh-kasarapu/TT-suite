// Thin fetch wrapper. Sign-in is the TT Suite session cookie (set by the portal), so requests carry cookies,
// non-GET requests send X-Requested-With: XHR, and error bodies become ApiError with a readable message.
// 401 -> the portal's sign-in page; 403 NO_APP_ACCESS -> the portal dashboard.

// EMS API base behind the portal gateway. Calls are written as "/api/..." and mapped onto it.
const API_BASE = (import.meta.env.VITE_API_URL || "/expense/api").replace(/\/$/, "");
const APP = "expense";

export class ApiError extends Error {
  constructor(message: string, public status: number, public errors: string[] = [], public code?: string) {
    super(message);
  }
}

/** Where a call goes: EMS calls ("/api/...") go to the EMS API; portal calls are absolute and used as is. */
const target = (url: string, portal: boolean) => (portal ? url : url.startsWith("/api/") ? API_BASE + url.slice(4) : url);

export function toSignIn(): void {
  window.location.assign("/login?returnTo=" + encodeURIComponent(window.location.pathname + window.location.search));
}

async function raw(method: string, url: string, body?: unknown, portal = false): Promise<Response> {
  const headers: Record<string, string> = {};
  if (method !== "GET" && method !== "HEAD") headers["X-Requested-With"] = "XHR";
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(target(url, portal), { method, headers, body: payload, credentials: "include" });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    let message = "Something went wrong. Try again.";
    let errors: string[] = [];
    let code: string | undefined;
    try {
      const data = await res.json();
      if (typeof data.message === "string") message = data.message;
      if (typeof data.code === "string") code = data.code;
      if (Array.isArray(data.errors)) errors = data.errors;
      if (Array.isArray(data.detail)) {
        message = "Some fields are not filled in correctly.";
        errors = data.detail.map((d: { loc: string[]; msg: string }) => `${d.loc.slice(1).join(" ")}: ${d.msg}`);
      }
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      message = "Your session has ended. Taking you to sign in.";
      toSignIn();
    } else if (res.status === 403 && code === "NO_APP_ACCESS") {
      window.location.assign(`/?denied=${APP}`);
    }
    throw new ApiError(message, res.status, errors, code);
  }
  return res;
}

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await raw(method, url, body);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** A call to the TT Suite portal API (/api/me, /api/auth/logout...), same cookie and rules. */
export async function portal<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await raw(method, url, body, true);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Fetch a protected file (receipt, Excel export) and hand it to the browser. */
export async function download(url: string, open = false): Promise<void> {
  const res = await raw("GET", url);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  if (open) {
    window.open(href, "_blank", "noopener");
  } else {
    const name = /filename="?([^"]+)"?/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "download";
    const a = Object.assign(document.createElement("a"), { href, download: name });
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
