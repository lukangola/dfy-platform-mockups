/**
 * LanderLab integration — REST API + MCP for what REST doesn't expose.
 *
 * Their API surface is split: most operations work via REST under
 * `/api/v2/...` with action-style URLs (POST /workspaces/{id}/landers/create
 * etc.), but a few things — notably *listing* domains — are only available
 * through their MCP server at `/api/v2/mcp` over JSON-RPC.
 *
 * The deploy lifecycle for one listicle:
 *   1. createLander(name)
 *        → returns { landerId, masterVariantId, encryptedVariantId, previewUrl }
 *   2. saveVariantHtml(variantId, html)
 *        → 200; variant is now editable + previewable in LanderLab
 *   3. publishLander(landerId, domainId, slug)
 *        → returns { publishedUrl }; retries with new slug on 400 if path is taken
 *
 * Plus one one-off per workspace, cached aggressively:
 *   listDomains() → calls the MCP `domains_list` tool, returns workspace
 *                   domains. We pick the one with default=true.
 *
 * Required env:
 *   LANDERLAB_API_KEY     — `ll_live_...`
 *   LANDERLAB_WORKSPACE_ID — numeric workspace id (e.g. 10041)
 *   LANDERLAB_MCP_URL     — defaults to https://api.landerlab.dev/api/v2/mcp
 *   LANDERLAB_REST_BASE   — defaults to https://api.landerlab.dev/api/v2
 *   LANDERLAB_APP_BASE    — defaults to https://app.landerlab.io
 *                           (used to construct editorUrl)
 */
import { env } from "./env.js";

const REST_BASE = process.env.LANDERLAB_REST_BASE ?? "https://api.landerlab.dev/api/v2";
const MCP_URL = process.env.LANDERLAB_MCP_URL ?? "https://api.landerlab.dev/api/v2/mcp";
const APP_BASE = process.env.LANDERLAB_APP_BASE ?? "https://app.landerlab.io";

function requireConfig(): { apiKey: string; workspaceId: string } {
  const apiKey = process.env.LANDERLAB_API_KEY ?? "";
  const workspaceId = process.env.LANDERLAB_WORKSPACE_ID ?? "";
  if (!apiKey) throw new Error("LANDERLAB_API_KEY is not set");
  if (!workspaceId) throw new Error("LANDERLAB_WORKSPACE_ID is not set");
  return { apiKey, workspaceId };
}

// ── REST helpers ───────────────────────────────────────────────────

type CreateLanderResult = {
  landerId: number;
  masterVariantId: number;
  encryptedVariantId: string;
  previewUrl: string;
};

export async function createLander(name: string): Promise<CreateLanderResult> {
  const { apiKey, workspaceId } = requireConfig();
  const res = await fetch(`${REST_BASE}/workspaces/${workspaceId}/landers/create`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`LanderLab create failed (${res.status}): ${JSON.stringify(body)}`);
  }
  const l = body.lander as {
    id: number;
    masterVariantId: number;
    masterVariant: { id: number; encryptedId: string; previewURL: string };
  };
  return {
    landerId: l.id,
    masterVariantId: l.masterVariant.id,
    encryptedVariantId: l.masterVariant.encryptedId,
    previewUrl: l.masterVariant.previewURL,
  };
}

/**
 * The save endpoint is multipart/form-data with two fields: `fileName` and
 * `html`. Anything else (settings, images, etc.) is optional. We use the
 * default fileName "index.html" since we always render a single page.
 */
export async function saveVariantHtml(variantId: number, html: string): Promise<void> {
  const { apiKey, workspaceId } = requireConfig();
  const fd = new FormData();
  fd.append("fileName", "index.html");
  fd.append("html", html);

  const res = await fetch(
    `${REST_BASE}/workspaces/${workspaceId}/editors/${variantId}/save`,
    { method: "POST", headers: { "X-API-Key": apiKey }, body: fd },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`LanderLab saveHtml failed (${res.status}): ${JSON.stringify(body)}`);
  }
}

type PublishResult = { publishedUrl: string };

/**
 * Publish the lander to the given domainId at the given path. On a 400
 * response that mentions "path is taken", retries up to `maxRetries` times
 * with a new short random suffix appended to the slug. Returns the final
 * (possibly suffixed) path that succeeded.
 */
export async function publishLander(args: {
  landerId: number;
  domainId: number;
  domainName: string;
  slug: string;
  maxRetries?: number;
}): Promise<PublishResult & { finalSlug: string }> {
  const { apiKey, workspaceId } = requireConfig();
  const maxRetries = args.maxRetries ?? 4;
  let slug = args.slug;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const path = slug.startsWith("/") ? slug : `/${slug}`;
    const res = await fetch(
      `${REST_BASE}/workspaces/${workspaceId}/landers/${args.landerId}/publish`,
      {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: args.domainId, path }),
      },
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      return {
        publishedUrl: `https://${args.domainName}${path}`,
        finalSlug: path,
      };
    }
    const message = JSON.stringify(body);
    const isPathTaken = /path.*taken|already.*used|duplicate/i.test(message);
    if (!isPathTaken || attempt === maxRetries) {
      throw new Error(`LanderLab publish failed (${res.status}): ${message}`);
    }
    // Append a 4-char random suffix and retry.
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${args.slug}-${suffix}`;
  }
  throw new Error("LanderLab publish: unreachable");
}

// ── MCP — used only for domains_list ───────────────────────────────

type LanderLabDomain = {
  id: number;
  name: string;
  status: string;
  default: boolean;
};

/**
 * Calls LanderLab MCP server `domains_list` tool. The MCP transport is
 * HTTP/SSE per their docs but a single non-streaming JSON-RPC POST works
 * fine for simple tool calls — the server replies with a single SSE
 * `data:` line in the response body. We parse the JSON out of that.
 *
 * Cached in-memory for the lifetime of the process. Domains change rarely
 * (the workspace's connected domains) so a process-lifetime cache is fine.
 */
let domainsCache: LanderLabDomain[] | null = null;

export async function listDomains(force = false): Promise<LanderLabDomain[]> {
  if (!force && domainsCache) return domainsCache;
  const { apiKey, workspaceId } = requireConfig();

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "domains_list",
        arguments: { workspaceId: Number(workspaceId) },
      },
      id: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`LanderLab MCP domains_list failed (${res.status})`);
  }

  // Response is SSE — `event: message\ndata: {json}\n\n`. We just need the
  // last `data:` line (there's only one for a non-streaming tool call).
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data:"));
  if (!dataLine) throw new Error(`LanderLab MCP: no data line in SSE response`);
  const dataJson = JSON.parse(dataLine.slice("data:".length).trim());

  // MCP tool calls wrap their actual result text inside content[0].text as
  // a JSON string. So we double-parse: SSE → JSON-RPC envelope →
  // content[0].text (which is itself JSON).
  const inner = dataJson.result?.content?.[0]?.text;
  if (!inner) throw new Error(`LanderLab MCP: unexpected envelope ${JSON.stringify(dataJson)}`);
  const parsed = JSON.parse(inner) as { domains: LanderLabDomain[] };
  domainsCache = parsed.domains;
  return domainsCache;
}

/**
 * Pick the workspace's "primary" domain — the one marked default=true, or
 * the first active one as a fallback. Throws if no usable domain exists.
 */
export async function pickPrimaryDomain(): Promise<LanderLabDomain> {
  const domains = await listDomains();
  const primary = domains.find((d) => d.default && d.status === "active")
    ?? domains.find((d) => d.status === "active")
    ?? domains[0];
  if (!primary) throw new Error("No LanderLab domains configured on this workspace");
  return primary;
}

// ── URL helpers ────────────────────────────────────────────────────

/**
 * Construct the editor URL for a variant — the LanderLab dashboard route
 * that opens this specific variant for inline editing. Format:
 *   https://app.landerlab.io/{workspaceId}/editor/{variantId}
 */
export function buildEditorUrl(variantId: number | string): string {
  const { workspaceId } = requireConfig();
  return `${APP_BASE}/${workspaceId}/editor/${variantId}`;
}

/**
 * Slugify a string into a URL-safe path segment. Lowercases, strips
 * accents, collapses whitespace into hyphens, drops anything that isn't
 * alphanum-or-hyphen, caps the length, and trims leading/trailing
 * hyphens.
 */
export function slugify(input: string, maxLen = 60): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, ""); // re-trim trailing hyphen if slice cut on one
}

/**
 * Build a reasonable deploy slug from a product + angle name. Example:
 *   ("COLLAFÉ", "Cortisol-Driven Belly Fat") → "collafe-cortisol-driven-belly-fat"
 */
export function buildSlug(productName: string, angleName?: string | null): string {
  const product = slugify(productName, 30);
  const angle = angleName ? slugify(angleName, 30) : "";
  return angle ? `${product}-${angle}` : product;
}

// Re-export env shape so other consumers can sanity-check
export const landerlabConfig = {
  REST_BASE,
  MCP_URL,
  APP_BASE,
  hasApiKey: () => !!process.env.LANDERLAB_API_KEY,
  hasWorkspaceId: () => !!process.env.LANDERLAB_WORKSPACE_ID,
};

// `env` is imported for side-effect of loading .env.local at module load
void env;
