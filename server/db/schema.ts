import { sql } from "drizzle-orm";
import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  action: text("action").notNull(),
  kind: text("kind").notNull(), // "text" | "image" | "video"
  inputs: jsonb("inputs").notNull(),
  output: jsonb("output"),
  model: text("model"),
  promptVersion: text("prompt_version"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  durationMs: integer("duration_ms"),
  error: text("error"),
});

/**
 * A brand is the top-level data-scoping unit. Every product and brand asset
 * belongs to exactly one brand. `research` is the JSON returned by the
 * `brand_extract` master prompt — same shape the client-side BrandIdentity
 * used to persist to localStorage, but now server-backed.
 */
export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  name: text("name").notNull(),
  brandUrl: text("brand_url"),
  logoUrl: text("logo_url"),
  research: jsonb("research"),
  researchStatus: text("research_status").notNull().default("pending"), // pending | researching | complete | failed
  researchError: text("research_error"),
  /**
   * Future-proofing for multi-team. Today the platform runs as a single
   * team; every brand is owned by the bootstrap "Default Team". Migrating
   * to true multi-team later means filtering existing endpoints by
   * `team_id` — no schema change needed at that point. NULL is tolerated
   * during the migration window for legacy rows that predate teams; the
   * boot-time backfill assigns them to the first team.
   */
  teamId: uuid("team_id"),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  brandId: uuid("brand_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Uncategorized"),
  productUrl: text("product_url"),
  factSheet: text("fact_sheet"),
  productImageUrl: text("product_image_url"),
  productBackImageUrl: text("product_back_image_url"),
  contentImageUrl: text("content_image_url"),
  research: jsonb("research"),
  researchStatus: text("research_status").notNull().default("pending"), // pending | researching | complete | failed
  researchError: text("research_error"),
});

/**
 * Approved generated assets that the user has promoted to the shared Brand
 * Assets library. Every app (B-roll, Message Testing, Static Ads, ...) writes
 * here when the user clicks "Save to Brand Assets"; AssetsPage reads here to
 * render the library.
 *
 * `url` points at the fal.ai CDN output (already persistent). We never re-host
 * the bytes — the entry is a pointer + metadata only.
 */
export const brandAssets = pgTable("brand_assets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  brandId: uuid("brand_id").notNull(),
  kind: text("kind").notNull(), // "image" | "video"
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  title: text("title").notNull(),
  sourceApp: text("source_app").notNull(), // "broll" | "message_testing" | "static_ads" | ...
  productId: uuid("product_id"), // soft reference to products.id
  metadata: jsonb("metadata"),
});

/**
 * Static ad reference library. Each row is a single reference ad image,
 * ingested either from `client/public/static-ads/library/<niche>/` on boot or
 * uploaded manually via the API. On creation we fire a background job that
 * runs the `static_ad_deconstruct` master prompt against the image and stores
 * the JSON result in `deconstruction`.
 */
export const staticAdReferences = pgTable("static_ad_references", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  title: text("title").notNull(),
  niche: text("niche").notNull(), // "skincare" | "supplements" | "hair-care" | "other" | ...
  imageUrl: text("image_url").notNull(), // fal.storage URL
  thumbnailUrl: text("thumbnail_url"),
  sourcePath: text("source_path"), // relative path for folder-ingested files, e.g. "skincare/foo.png"
  sourceSignature: text("source_signature"), // `${size}:${mtime}` for ingest dedup
  deconstruction: jsonb("deconstruction"),
  deconstructionStatus: text("deconstruction_status").notNull().default("pending"), // pending | running | complete | failed
  deconstructionError: text("deconstruction_error"),
  deconstructionGeneratedAt: timestamp("deconstruction_generated_at", { withTimezone: true }),
  promptVersion: text("prompt_version"),
  model: text("model"),
});

export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type BrandAsset = typeof brandAssets.$inferSelect;
export type NewBrandAsset = typeof brandAssets.$inferInsert;
export type StaticAdReference = typeof staticAdReferences.$inferSelect;
export type NewStaticAdReference = typeof staticAdReferences.$inferInsert;

/**
 * Character library — reference photos of on-camera subjects for the Character
 * B-roll app. Two-tier ownership:
 *
 *   - `brandId IS NULL`  → default / shared library (every brand sees it).
 *                          Ingested from `client/public/characters/library/*`
 *                          on boot via `characterIngest.ts`.
 *   - `brandId = <uuid>` → brand-private library (only that brand sees it).
 *                          Created via the UI Upload button.
 *
 * The Character B-roll picker reads `?brandId=<id>` and merges both tiers,
 * showing default characters first and brand-private ones second.
 */
export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  brandId: uuid("brand_id"), // NULL = default/shared, set = brand-private
  title: text("title").notNull(),
  imageUrl: text("image_url").notNull(), // fal.storage URL — original (used as input to image-gen pipeline; also the source for Seedance prep)
  thumbnailUrl: text("thumbnail_url"),
  sourcePath: text("source_path"), // relative path for folder-ingested files
  sourceSignature: text("source_signature"), // `${size}:${mtime}` for ingest dedup

  /**
   * Seedance 2.0 ref-to-video flags realistic photos as "likeness of real
   * people" and refuses to process them. The fix is a 2-step Nano-Banana-Pro
   * preprocessing pipeline that converts the raw character photo into a
   * fully synthetic, AI-styled portrait that passes Seedance's likeness
   * detector while preserving the character's identity.
   *
   *   Step 1 → turnaround / reference sheet (multi-view, neutral wardrobe).
   *            Stored in `seedanceSheetUrl` so we can re-derive the close-up
   *            later or use the sheet itself as a richer reference.
   *   Step 2 → close-up portrait of the face on white background. Stored in
   *            `seedancePortraitUrl`. THIS is the URL we pass to Seedance as
   *            the character reference (`@Image2`).
   *
   * `seedancePrepStatus` covers the whole 2-step pipeline:
   *   pending  — never run
   *   running  — in flight
   *   complete — both URLs populated
   *   failed   — at least one step errored; see seedancePrepError
   *
   * The original `imageUrl` is still used as the character reference for
   * Nano-Banana-Pro image generation (NBP accepts realistic photos fine).
   * Only Seedance gets the synthetic version.
   */
  seedanceSheetUrl: text("seedance_sheet_url"),
  seedancePortraitUrl: text("seedance_portrait_url"),
  seedancePrepStatus: text("seedance_prep_status").notNull().default("pending"),
  seedancePrepError: text("seedance_prep_error"),
});

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

// ──────────────────────────────────────────────────────────────────────────
// AUTH + TEAM
//
// Five tables form the auth + team-management foundation:
//
//   users         — one row per human; canonical login record (email +
//                   bcrypt hash). One user can belong to many teams via
//                   `team_members` (today: just one).
//   sessions      — one row per active login; the random `token` lives in
//                   the user's `dfy_session` httpOnly cookie. Expired or
//                   revoked rows are pruned lazily on validation.
//   teams         — the workspace boundary. v1 ships with exactly one
//                   "Default Team" created on first registration; the
//                   shape is multi-team-ready so future expansion is a
//                   non-breaking change.
//   team_members  — the (team, user) join table with a role per user.
//                   Role is `admin` (full access — can invite, change
//                   roles, remove members) or `member` (read/use access
//                   only).
//   invites       — pending invitations. Admins create one with `email`
//                   + `role`; the row generates a random `token` that
//                   embeds in the invite URL. Accepting consumes the
//                   row (sets `accepted_at`) and creates the user +
//                   team_members rows. Expired invites stay in the
//                   table for audit; pruning is lazy.
// ──────────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  userId: uuid("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  name: text("name").notNull(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull().default("member"), // admin | member
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  teamId: uuid("team_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  invitedByUserId: uuid("invited_by_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type Role = "admin" | "member";
