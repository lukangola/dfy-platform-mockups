# Pre-assigned Workspaces on Team Invites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin picks workspaces in the invite form; the grants are applied automatically when the invitee registers.

**Architecture:** A nullable `brand_ids` jsonb column on the existing `invites` table (Approach A from the spec). Pure validation/filtering logic lives in a new `server/lib/inviteBrands.ts` so it's unit-testable without DB mocks (the codebase's established test pattern — vitest on pure lib functions only). Routes stay thin: `POST /api/team/invites` validates + stores, the register invite-branch filters + grants via the existing idempotent `grantBrandsToUser`.

**Tech Stack:** Drizzle ORM (postgres), Express routes, vitest, React (SettingsPage).

**Spec:** `docs/superpowers/specs/2026-08-14-invite-preassigned-workspaces-design.md`

**Repo root:** `dfy-platform-mockups/`. All commands run from there. Tests run with `npx vitest run --root . <file>` (the plain invocation resolves to `client/` and finds nothing).

---

### Task 1: Pure validation/filter logic (`inviteBrands.ts`)

**Files:**
- Create: `server/lib/inviteBrands.ts`
- Test: `server/lib/inviteBrands.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
// server/lib/inviteBrands.test.ts
import { describe, it, expect } from "vitest";
import { normalizeInviteBrandIds, filterGrantableBrandIds } from "./inviteBrands.js";

const TEAM = new Set(["b1", "b2", "b3"]);

describe("normalizeInviteBrandIds", () => {
  it("returns null for admin invites regardless of payload", () => {
    expect(normalizeInviteBrandIds(["b1"], "admin", TEAM)).toEqual({ ok: true, brandIds: null });
  });

  it("returns null when brandIds is absent or empty", () => {
    expect(normalizeInviteBrandIds(undefined, "member", TEAM)).toEqual({ ok: true, brandIds: null });
    expect(normalizeInviteBrandIds([], "member", TEAM)).toEqual({ ok: true, brandIds: null });
  });

  it("rejects a non-array payload", () => {
    const r = normalizeInviteBrandIds("b1", "member", TEAM);
    expect(r.ok).toBe(false);
  });

  it("rejects when any id is not a team brand, listing the foreign ids", () => {
    const r = normalizeInviteBrandIds(["b1", "nope", "also-nope"], "member", TEAM);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("nope");
      expect(r.error).toContain("also-nope");
    }
  });

  it("dedupes and drops non-string entries, keeping order", () => {
    const r = normalizeInviteBrandIds(["b2", "b2", 42, "b1"], "manager", TEAM);
    expect(r).toEqual({ ok: true, brandIds: ["b2", "b1"] });
  });
});

describe("filterGrantableBrandIds", () => {
  it("keeps only ids that still exist on the team", () => {
    expect(filterGrantableBrandIds(["b1", "deleted", "b3"], TEAM)).toEqual(["b1", "b3"]);
  });

  it("tolerates malformed stored jsonb (null / non-array / junk entries)", () => {
    expect(filterGrantableBrandIds(null, TEAM)).toEqual([]);
    expect(filterGrantableBrandIds("garbage", TEAM)).toEqual([]);
    expect(filterGrantableBrandIds([1, {}, "b2"], TEAM)).toEqual(["b2"]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root . server/lib/inviteBrands.test.ts`
Expected: FAIL — `Cannot find module './inviteBrands.js'`

- [x] **Step 3: Write the implementation**

```ts
// server/lib/inviteBrands.ts
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
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root . server/lib/inviteBrands.test.ts`
Expected: PASS (7 tests)

- [x] **Step 5: Commit**

```bash
git add server/lib/inviteBrands.ts server/lib/inviteBrands.test.ts
git commit -m "feat(team): pure validation/filter logic for invite pre-assigned workspaces"
```

---

### Task 2: Schema column + migration

**Files:**
- Modify: `server/db/schema.ts` (invites table, ~line 390)
- Generated: `drizzle/0030_*.sql` (via drizzle-kit)

- [x] **Step 1: Add the column to the schema**

In `server/db/schema.ts`, change the `invites` table definition — add `brandIds` after `role`:

```ts
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  teamId: uuid("team_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  /**
   * Pre-assigned workspaces: brand ids granted to the invitee automatically
   * at registration. Shape: string[] (brand UUIDs), validated against the
   * team's brands at create time and re-filtered at accept time (a brand can
   * be deleted during the invite's lifetime). NULL = no pre-assignment —
   * also the state of every invite created before this column existed.
   * Always NULL for admin invites (admins see every brand already).
   */
  brandIds: jsonb("brand_ids"),
  token: text("token").notNull().unique(),
  invitedByUserId: uuid("invited_by_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});
```

(`jsonb` is already imported at the top of schema.ts.)

- [x] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0030_<name>.sql` containing exactly:
```sql
ALTER TABLE "invites" ADD COLUMN "brand_ids" jsonb;
```
Inspect the file — if drizzle-kit generated anything beyond this single ALTER, stop and reconcile (it means schema.ts had drifted; do NOT ship unrelated DDL).

- [x] **Step 3: Apply to the dev database**

Run: `pnpm db:migrate`
Expected: "Migrations complete." Then verify:
```bash
DBURL=$(grep -E '^DATABASE_URL' .env.local | sed 's/^DATABASE_URL=//') NODE_PATH="$(pwd)/node_modules" node -e "
const { Client } = require('pg');
(async () => { const c = new Client({ connectionString: process.env.DBURL }); await c.connect();
const r = await c.query(\"select column_name, data_type from information_schema.columns where table_name='invites' and column_name='brand_ids'\");
console.log(r.rows); await c.end(); })()"
```
Expected: `[ { column_name: 'brand_ids', data_type: 'jsonb' } ]`

Production applies this automatically: `runMigrationsOnBoot()` in `server/index.ts` runs pending migrations at deploy.

- [x] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add server/db/schema.ts drizzle/
git commit -m "feat(team): invites.brand_ids jsonb column for pre-assigned workspaces"
```

---

### Task 3: Create path — accept + validate + store `brandIds`

**Files:**
- Modify: `server/routes/team.ts` — `shapeInvite` (~line 60) and `POST /invites` (~line 117)

- [x] **Step 1: Extend shapeInvite**

```ts
function shapeInvite(row: schema.Invite) {
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    brandIds: (row.brandIds as string[] | null) ?? null,
    token: row.token,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}
```

- [x] **Step 2: Import the new lib at the top of team.ts**

Alongside the existing brandAccess import:

```ts
import { normalizeInviteBrandIds } from "../lib/inviteBrands.js";
```

- [x] **Step 3: Wire validation into POST /invites**

In the handler, extend the body type and, after the `existingInvite` check and before `generateInviteToken()`, add the validation block. The `.values({...})` insert gains `brandIds`:

```ts
    const body = (req.body ?? {}) as { email?: string; role?: string; brandIds?: unknown };
```

```ts
    // Pre-assigned workspaces: validate against THIS team's brands. Foreign
    // ids reject the whole request (clear error beats a silent drop).
    const teamBrands = await db
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(eq(schema.brands.teamId, team.id));
    const normalized = normalizeInviteBrandIds(body.brandIds, role, new Set(teamBrands.map((b) => b.id)));
    if (!normalized.ok) return sendError(res, 400, normalized.error);

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const [created] = await db
      .insert(schema.invites)
      .values({
        teamId: team.id,
        email,
        role,
        brandIds: normalized.brandIds,
        token,
        invitedByUserId: user.id,
        expiresAt,
      })
      .returning();
```

- [x] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add server/routes/team.ts
git commit -m "feat(team): invites accept, validate and store pre-assigned brandIds"
```

---

### Task 4: Accept path — grant on registration

**Files:**
- Modify: `server/routes/auth.ts` — invite branch of `POST /register` (~lines 167-207)

- [x] **Step 1: Add imports at the top of auth.ts**

```ts
import { grantBrandsToUser } from "../lib/brandAccess.js";
import { filterGrantableBrandIds } from "../lib/inviteBrands.js";
import type { Role } from "../lib/auth.js";
```

(Check each against auth.ts's existing imports first — `Role` may already be imported; don't duplicate.)

- [x] **Step 2: Fix the role narrowing and keep the invite row**

The invite branch currently narrows with a type-only cast. Replace:

```ts
      role = (invite.role as "admin" | "member") ?? "member";
```

with:

```ts
      // Runtime value passes through untouched — "manager" invites always
      // worked; the old `as "admin" | "member"` annotation just lied about it.
      role = (invite.role as Role) ?? "member";
```

Also change the surrounding declaration `let role: "admin" | "member";` to `let role: Role;` (the bootstrap branch assigns `"admin"`, which still satisfies `Role`).

- [x] **Step 3: Apply grants after membership insert**

The handler already re-reads the invite only via `body.inviteToken` at the acceptedAt update. Hoist the invite: the invite branch already has the `invite` row in scope — capture it in a variable visible after the insert (declare `let acceptedInvite: typeof invite | null = null;` next to `let teamId` and set `acceptedInvite = invite;` inside the branch). Then, immediately after `await db.insert(schema.teamMembers).values(...)`:

```ts
    // Pre-assigned workspaces: grant what the admin picked at invite time.
    // Best-effort by design — the account is the primary artifact, so a
    // grant failure logs and continues (the admin can still grant manually,
    // which is exactly the pre-feature flow). Ids are re-filtered against
    // the team's CURRENT brands: a workspace deleted during the invite's
    // ~13-day lifetime is silently skipped per the spec.
    if (acceptedInvite && role !== "admin") {
      try {
        const teamBrands = await db
          .select({ id: schema.brands.id })
          .from(schema.brands)
          .where(eq(schema.brands.teamId, teamId));
        const grantable = filterGrantableBrandIds(
          acceptedInvite.brandIds,
          new Set(teamBrands.map((b) => b.id)),
        );
        if (grantable.length > 0) {
          await grantBrandsToUser({
            userId: user.id,
            brandIds: grantable,
            createdBy: acceptedInvite.invitedByUserId,
          });
        }
      } catch (err) {
        console.error("[auth] invite pre-assigned grants failed (registration continues):", err);
      }
    }
```

(`eq` and `schema` are already imported in auth.ts; verify `schema.brands` usage compiles.)

- [x] **Step 4: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run --root .`
Expected: clean, all tests pass (102 = 95 existing + 7 new).

- [x] **Step 5: Commit**

```bash
git add server/routes/auth.ts
git commit -m "feat(auth): apply invite pre-assigned workspace grants at registration"
```

---

### Task 5: Client API types

**Files:**
- Modify: `client/src/lib/api.ts` — `InviteRow` (~line 1064), `createTeamInvite` (~line 1087)

- [x] **Step 1: Extend the type and the call**

```ts
export type InviteRow = {
  id: string;
  email: string;
  role: TeamRole;
  /** Workspaces granted automatically when this invite is accepted. Null = none. */
  brandIds: string[] | null;
  token: string;
  invitedByUserId: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};
```

```ts
export function createTeamInvite(args: {
  email: string;
  role: TeamRole;
  brandIds?: string[];
}): Promise<{ invite: InviteRow }> {
  return post<{ invite: InviteRow }>("/api/team/invites", args);
}
```

- [x] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add client/src/lib/api.ts
git commit -m "feat(team): client API types for invite brandIds"
```

---

### Task 6: Invite form UI + pending-invite display

**Files:**
- Modify: `client/src/pages/workspace/SettingsPage.tsx` — `InviteForm` (~line 767), pending-invites list (~line 215), `TeamSection` invite usage (~line 201)

- [x] **Step 1: Give InviteForm the team's brands**

`TeamSection` renders `<InviteForm onCreated={...} onError={...} />`. Fetch brands once where TeamSection loads its data (it already has a load effect for the team snapshot) using the existing `listBrands` API (admins receive every team brand):

```ts
import { listBrands, type Brand } from "../../lib/api"; // merge into the existing api import list
```

```ts
const [brands, setBrands] = useState<Brand[]>([]);
useEffect(() => {
  listBrands().then(({ brands }) => setBrands(brands)).catch(() => setBrands([]));
}, []);
```

Pass down: `<InviteForm brands={brands} onCreated={...} onError={...} />`.

- [x] **Step 2: Workspace checkboxes in InviteForm**

Extend the signature and state:

```ts
function InviteForm({ brands, onCreated, onError }: { brands: Brand[]; onCreated: () => void; onError: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  // ...existing state unchanged
```

Submit passes the selection (and clears it on success, next to `setEmail("")`):

```ts
const { invite } = await createTeamInvite({
  email: email.trim().toLowerCase(),
  role,
  brandIds: role === "admin" ? undefined : selectedBrandIds,
});
// ...
setSelectedBrandIds([]);
```

Below the existing email+role row (inside the `<form>`, after the flex row), render the picker — hidden for admin invites, which also clears any selection:

```tsx
{role !== "admin" && brands.length > 0 && (
  <div className="mt-3">
    <label className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1.5">
      Workspaces (granted on accept)
    </label>
    <div className="flex flex-wrap gap-1.5">
      {brands.map((b) => {
        const checked = selectedBrandIds.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() =>
              setSelectedBrandIds((prev) =>
                checked ? prev.filter((id) => id !== b.id) : [...prev, b.id],
              )
            }
            className={`px-2.5 py-1.5 rounded border text-[11px] transition-all ${
              checked
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white/75"
            }`}
          >
            {b.name}
          </button>
        );
      })}
    </div>
  </div>
)}
```

And keep the selection consistent with the role: in the role `<select>`'s onChange, after `setRole(...)`, add `if (e.target.value === "admin") setSelectedBrandIds([]);`.

- [x] **Step 3: Show pre-assigned workspaces on pending invites**

`TeamSection` has `brands` from Step 1 — build a lookup and extend the pending-invite row's meta line (line ~221, the "invited as … · expires …" div):

```tsx
const brandNameById = new Map(brands.map((b) => [b.id, b.name]));
```

```tsx
{invite.brandIds && invite.brandIds.length > 0 && (() => {
  const names = invite.brandIds
    .map((id) => brandNameById.get(id))
    .filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;
  const shown = names.slice(0, 2).join(", ");
  const more = names.length > 2 ? ` +${names.length - 2} more` : "";
  return <> · grants <span className="text-white/60">{shown}{more}</span></>;
})()}
```

(Deleted brands drop out via the name lookup — per spec they render nothing.)

- [x] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add client/src/pages/workspace/SettingsPage.tsx
git commit -m "feat(team): workspace picker in invite form + grants shown on pending invites"
```

---

### Task 7: End-to-end verification on dev + gates

**Files:** none (verification only)

- [x] **Step 1: Full gates**

Run: `npx tsc --noEmit && npx vitest run --root .`
Expected: clean typecheck; all tests pass.

- [x] **Step 2: API-level end-to-end against the dev server**

Start the dev server (`pnpm dev`, or the existing preview config). Then, logged in as the dev admin (reuse a browser session or curl with the session cookie):

1. `POST /api/team/invites` with `{ "email": "e2e-invitee@example.com", "role": "member", "brandIds": ["<real dev brand id>"] }` → 201/200, response invite has `brandIds`.
2. Negative: same call with `brandIds: ["00000000-0000-0000-0000-000000000000"]` → 400 listing the id.
3. `POST /api/auth/register` with `{ "email": "e2e-invitee@example.com", "password": "<valid>", "name": "E2E Invitee", "inviteToken": "<token from step 1>" }` → 200.
4. Verify grants in the dev DB:
```bash
DBURL=$(grep -E '^DATABASE_URL' .env.local | sed 's/^DATABASE_URL=//') NODE_PATH="$(pwd)/node_modules" node -e "
const { Client } = require('pg');
(async () => { const c = new Client({ connectionString: process.env.DBURL }); await c.connect();
const r = await c.query(\"select bm.brand_id from brand_members bm join users u on u.id=bm.user_id where u.email='e2e-invitee@example.com'\");
console.log('grants:', r.rows); await c.end(); })()"
```
Expected: exactly the brand id from step 1.
5. Clean up the test user + grants + invite row from the dev DB.

- [x] **Step 3: Visual check**

In the browser preview on Settings: workspace chips appear for member/manager, disappear (and clear) when switching to admin; pending invite row shows "grants <name>".

- [x] **Step 4: Final commit (if any fixups) — then hold for push**

Do NOT push to main yet — deployment goes through the user's normal flow (push deploys production via Railway). Report completion and ask.

---

## Self-review notes

- Spec coverage: migration (T2), create validation + shapeInvite (T3), accept grants + role-cast fix (T4), UI picker + pending display (T5/T6), error table covered by T1 tests + T4 try/catch, manual e2e (T7). Out-of-scope items untouched.
- Types: `brandIds` is `string[] | null` end-to-end; `normalizeInviteBrandIds` takes `unknown`; `Role` import fixes the cast.
- The 102-test expectation in T4 assumes no other session adds tests concurrently — treat "all pass" as the real gate.
