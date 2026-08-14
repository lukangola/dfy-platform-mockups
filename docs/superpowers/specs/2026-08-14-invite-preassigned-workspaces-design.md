# Pre-assigned Workspaces on Team Invites — Design

**Date:** 2026-08-14
**Status:** Approved (Approach A)

## Problem

Inviting a teammate takes three separate steps: create the invite, wait for
the person to register, then return to Settings and grant workspaces via
"Manage workspaces". The final step is easy to forget — the invitee lands in
an empty workspace list until an admin comes back.

## Goal

The admin picks workspaces at invite time. When the invitee registers, the
grants are applied automatically. No follow-up step.

## Decisions

- **Storage:** `invites.brand_ids jsonb` (nullable array of brand UUIDs) on
  the existing `invites` table. No join table — invites are short-lived
  (~13-day TTL) and consumed once; validation at create plus a filter at
  accept covers integrity. Null/absent = no pre-assignment, which is also the
  state of every existing invite row, so no backfill.
- **Picker scope:** shown for `member` and `manager` invites. Hidden for
  `admin` invites — admins see every workspace via the role short-circuit in
  `canSeeBrand`, so a selection would be meaningless.
- **Default state:** no workspaces preselected. Access grants are explicit.
- **Editing a pending invite's workspaces:** revoke + re-invite, matching the
  existing pattern for role changes. No new edit UI.

## Server changes

### Migration `drizzle/0030_*.sql`

```sql
ALTER TABLE "invites" ADD COLUMN "brand_ids" jsonb;
```

Plus the matching `brandIds: jsonb("brand_ids")` field on `invites` in
`server/db/schema.ts`.

### `POST /api/team/invites` (`server/routes/team.ts`)

- Accept optional `brandIds: string[]` in the body.
- Ignore it entirely when `role === "admin"` (store null).
- Validate: every id must be a brand on the caller's team — reject the whole
  request with 400 listing the foreign ids (same defense as
  `PUT /api/team/members/:userId/brands`). Dedupe before storing.
- `shapeInvite` gains `brandIds: string[] | null` so the client can render
  pending invites' workspace lists.

### `POST /api/auth/register` — invite branch (`server/routes/auth.ts`)

After the `team_members` insert, when the invite carries `brandIds` and the
role is not admin:

1. Filter the ids to brands that still exist on the invite's team (a
   workspace may have been deleted during the invite's lifetime — skip
   silently).
2. `grantBrandsToUser({ userId, brandIds, createdBy: invite.invitedByUserId })`
   — already idempotent via ON CONFLICT.
3. Grant failure must NOT fail registration: the account is the primary
   artifact. Wrap in try/catch, log, continue — the admin can still grant
   manually, which is exactly today's behaviour.

In passing: fix the type-only narrowing `invite.role as "admin" | "member"`
to use `Role` — `manager` already passes through correctly at runtime; the
annotation just lies about it.

## Client changes (`client/src/pages/workspace/SettingsPage.tsx`)

- `InviteForm`: when role is `member` or `manager`, render a "Workspaces"
  checkbox list of the team's brands (name + checkbox; brands are already
  loaded on this page). Switching role to `admin` hides the list and clears
  the selection. Submit sends `brandIds`.
- Pending-invites list: show the pre-assigned workspace names on the invite
  row (truncate gracefully — e.g. first two names + "+N more"). Requires
  mapping ids → names from the loaded brands; ids whose brand has since been
  deleted render nothing.
- `client/src/lib/api.ts`: `createTeamInvite` gains optional `brandIds`;
  the invite type gains `brandIds: string[] | null`.

## Error handling summary

| Case | Behaviour |
| --- | --- |
| `brandIds` contains a foreign/unknown brand at create | 400, invite not created, ids listed |
| `brandIds` on an admin invite | ignored, stored as null |
| Brand deleted between invite and accept | skipped silently at accept |
| `grantBrandsToUser` throws at accept | logged; registration still succeeds |
| Empty/absent `brandIds` | invite behaves exactly as today |

## Testing

- Unit (vitest, mirroring existing route-test patterns): create-path
  validation (foreign id → 400, dedupe, admin → null) and accept-path
  behaviour (grants created, deleted brand skipped, grant failure doesn't
  fail registration).
- Manual on dev DB: invite a member with two workspaces → register via the
  link → verify `brand_members` rows and that the new user sees exactly
  those workspaces.

## Out of scope

- Email delivery of invites (piece B — separate design).
- Manager permission to invite or assign workspaces (invites stay
  admin-only).
- Changes to the existing "Manage workspaces" modal.
