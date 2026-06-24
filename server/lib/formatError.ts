/**
 * `formatError(err)` — coerce ANY thrown value into a useful, human-readable
 * string. Specifically defends against the `String({})` → `"[object Object]"`
 * trap that silently swallows useful info in the UI.
 *
 * We see four kinds of throwables in this codebase:
 *
 *   1. Native Error / subclasses (most code we wrote). `.message` is the
 *      right thing to display.
 *
 *   2. Plain objects from third-party SDKs — most notably `@fal-ai/client`,
 *      which rejects with shapes like
 *        { status: 422, body: { detail: "..." } }
 *        { status: 500, body: "raw text" }
 *        { message: "...", code: "..." }
 *      `err instanceof Error` is false, so any code path that does
 *      `err instanceof Error ? err.message : String(err)` ends up rendering
 *      "[object Object]" to the user. We unwrap the common nested fields.
 *
 *   3. Strings (rare, but possible from older `throw "..."` code).
 *
 *   4. Anything else — falls back to JSON.stringify so at least we see
 *      SOMETHING actionable in logs / responses.
 *
 * The output is capped so a runaway nested object doesn't blow up the
 * client's error UI. If you need the full raw value, log `err` itself
 * server-side first.
 */
const MAX_MESSAGE_LENGTH = 600;

function trunc(s: string): string {
  if (s.length <= MAX_MESSAGE_LENGTH) return s;
  return s.slice(0, MAX_MESSAGE_LENGTH - 1) + "…";
}

/**
 * Probes the most common nested error-payload shapes used by HTTP clients
 * (fal.ai, fetch wrappers, etc.). Returns the first truthy string we find,
 * or null. Order matters: we prefer the most specific field first.
 */
function pickMessageFromObject(o: Record<string, unknown>): string | null {
  // fal.ai content-safety: body.detail
  const body = o.body;
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const bo = body as Record<string, unknown>;
    if (typeof bo.detail === "string" && bo.detail.trim()) return bo.detail.trim();
    // fal validation errors put a `detail[]` array here, each entry
    // `{ loc: [...], msg, type }`. This is the field-level reason (e.g.
    // "prompt: Could not generate images with the given prompts and
    // images"). Without this branch the array fell through to the generic
    // status text and the actual cause was lost.
    if (Array.isArray(bo.detail) && bo.detail.length > 0) {
      const parts = bo.detail
        .map((d) => {
          if (typeof d === "string") return d;
          if (d && typeof d === "object") {
            const dd = d as Record<string, unknown>;
            const loc = Array.isArray(dd.loc) ? dd.loc.filter((x) => x !== "body").join(".") : "";
            const m =
              typeof dd.msg === "string" ? dd.msg : typeof dd.message === "string" ? dd.message : "";
            return loc && m ? `${loc}: ${m}` : m || loc;
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" | ");
    }
    if (typeof bo.error === "string" && bo.error.trim()) return bo.error.trim();
    if (typeof bo.message === "string" && bo.message.trim()) return bo.message.trim();
  }
  // Common top-level shapes
  if (typeof o.detail === "string" && o.detail.trim()) return o.detail.trim();
  if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
  if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
  if (typeof o.statusText === "string" && o.statusText.trim()) return o.statusText.trim();
  // fal-style validation errors: body.errors[0].msg, body.detail[0].msg, etc.
  const errs =
    (body && typeof body === "object" && (body as Record<string, unknown>).errors) ??
    o.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    const first = errs[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const fo = first as Record<string, unknown>;
      if (typeof fo.msg === "string") return fo.msg;
      if (typeof fo.message === "string") return fo.message;
    }
  }
  return null;
}

export function formatError(err: unknown): string {
  if (err == null) return "Unknown error (no value thrown)";

  if (typeof err === "string") return trunc(err.trim() || "Unknown error (empty string)");

  if (err instanceof Error) {
    // Some Error subclasses (DOMException, certain fetch errors) decorate
    // themselves with extra fields we want to surface alongside .message.
    const extra = (err as unknown as Record<string, unknown>);
    const nested = pickMessageFromObject(extra);
    if (err.message && nested && err.message !== nested) {
      return trunc(`${err.message} — ${nested}`);
    }
    return trunc(err.message || nested || err.name || "Unknown Error");
  }

  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const picked = pickMessageFromObject(o);
    const status = typeof o.status === "number" ? o.status : undefined;
    if (picked) {
      return trunc(status ? `HTTP ${status}: ${picked}` : picked);
    }
    // Last resort — JSON.stringify so SOMETHING shows up. Catches
    // toString-throwing objects so we don't error inside the formatter.
    try {
      const s = JSON.stringify(o);
      if (s && s !== "{}") return trunc(status ? `HTTP ${status}: ${s}` : s);
    } catch {
      /* fallthrough */
    }
    return status ? `HTTP ${status}` : "Unknown error (opaque object)";
  }

  return trunc(String(err));
}
