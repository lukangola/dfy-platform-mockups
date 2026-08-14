/**
 * Pre-assigned workspaces on team invites — pure logic.
 *
 * An admin can attach brand ids to an invite; the grants are applied when
 * the invitee registers. Validation (create path) and filtering (accept
 * path) live here as pure functions so they're unit-testable — routes do
 * the DB reads and pass in the team's brand-id set.
 */

export type NormalizeResult =
  | { ok: true; brandIds: string[] | null }
  | { ok: false; error: string };

/**
 * Create path. Admin invites never store brand ids (admins see every brand
 * via the role short-circuit). Empty/absent input stores null — "no
 * pre-assignment", identical to every pre-feature invite row. Any id not on
 * the caller's team rejects the whole request so the admin sees a clear
 * error instead of a silent drop (same defense as PUT member brands).
 */
export function normalizeInviteBrandIds(
  input: unknown,
  role: string,
  teamBrandIds: ReadonlySet<string>,
): NormalizeResult {
  if (role === "admin") return { ok: true, brandIds: null };
  if (input === undefined || input === null) return { ok: true, brandIds: null };
  if (!Array.isArray(input)) return { ok: false, error: "brandIds must be an array of brand ids" };

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const id = raw.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { ok: true, brandIds: null };

  const foreign = ids.filter((id) => !teamBrandIds.has(id));
  if (foreign.length > 0) {
    return { ok: false, error: `Some brandIds don't belong to your team: ${foreign.join(", ")}` };
  }
  return { ok: true, brandIds: ids };
}

/**
 * Accept path. The stored jsonb is untrusted (written by an older code
 * version, or a brand was deleted during the invite's ~13-day lifetime).
 * Returns only ids that still exist on the team; everything else is
 * silently skipped per the spec.
 */
export function filterGrantableBrandIds(
  stored: unknown,
  teamBrandIds: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((id): id is string => typeof id === "string" && teamBrandIds.has(id));
}
