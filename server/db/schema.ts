import { sql } from "drizzle-orm";
import { integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  // Author / creator. Auto-captured from req.auth on insert. Nullable so legacy
  // rows (and any future system-generated assets) don't need backfilling.
  userId: uuid("user_id"),
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

/**
 * Per-user × per-brand access grants.
 *
 * One row per (user, brand) pair = "this user can see this brand in their
 * workspace switcher and use it on every brand-scoped endpoint." Admins are
 * NOT represented here — they implicitly see every brand on their team. We
 * only persist rows for non-admin members so admin-bypass logic stays a
 * single role check rather than a brand-count query.
 *
 * Created when:
 *   - A new brand is created → the creator (if non-admin) gets a row.
 *     Admins get implicit access via role; other teammates get no rows
 *     by default — admin opens "Manage workspaces" to grant access.
 *   - An admin uses the SettingsPage "Manage workspaces" UI to flip a
 *     checkbox on for a specific member.
 *   - Boot-time backfill (one-shot) when this table is first created:
 *     grants every existing non-admin member access to every brand on
 *     their team, so ship doesn't silently lock anyone out.
 *
 * Deleted when:
 *   - Admin un-checks a brand in the modal.
 *   - The brand is deleted (cascade — handled in DELETE /api/brands/:id).
 *   - The user leaves the team (cascade — handled in DELETE team/members).
 */
export const brandMembers = pgTable("brand_members", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  brandId: uuid("brand_id").notNull(),
  userId: uuid("user_id").notNull(),
  createdBy: uuid("created_by"), // admin who granted access; null = system backfill
}, (t) => ({
  uniqBrandUser: uniqueIndex("brand_members_brand_user_uniq").on(t.brandId, t.userId),
}));

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
export type BrandMember = typeof brandMembers.$inferSelect;
export type NewBrandMember = typeof brandMembers.$inferInsert;
export type Role = "admin" | "member";

// ──────────────────────────────────────────────────────────────────────────
// LISTICLE BUILDER
//
// Two tables. A `listicle` row holds the draft + its publish state through
// every step of the builder: copy generation → image generation → HTML
// rendering → LanderLab deploy. The `listicle_images` rows are per-section
// (one image per numbered reason in the listicle) with the same approve /
// regen / feedback lifecycle the b-roll apps use.
//
// State machine on listicles.status:
//   drafting   — copy step in progress (or just saved)
//   images     — copy approved, image generation in progress / under review
//   rendering  — HTML render in progress
//   ready      — HTML rendered, user reviewing preview, hasn't deployed yet
//   deployed   — pushed to LanderLab; landerlab_lander_id, landerlab_variant_id
//                and the URL fields are populated
//   failed     — terminal error somewhere; see `error` field for details
// ──────────────────────────────────────────────────────────────────────────

export const listicles = pgTable("listicles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  brandId: uuid("brand_id").notNull(),
  productId: uuid("product_id").notNull(),
  /** "generate" (Copy Engine), "paste" (user-supplied), "winning_ad" (analyzed from uploaded ad) */
  source: text("source").notNull(),
  status: text("status").notNull().default("drafting"), // drafting | analyzing | images | rendering | ready | deployed | failed
  angleName: text("angle_name"),
  language: text("language").notNull().default("en"),
  /** The user's destination URL — the offer/checkout page. Used for CTA_URL + offer extraction. */
  destinationUrl: text("destination_url"),
  /** Structured offer fields extracted from destinationUrl via the offer_extract prompt */
  offerExtract: jsonb("offer_extract"),
  /** The listicle markdown — either generated or pasted */
  copyMarkdown: text("copy_markdown"),
  /** Free-form guidance the user provided alongside the copy generation request */
  guidance: text("guidance"),
  /** Winning ad workflow: fal.storage URL of the uploaded ad (video .mp4/.mov or static .jpg/.png). Null for other sources. */
  winningAdUrl: text("winning_ad_url"),
  /** Winning ad workflow: "video" | "static" */
  winningAdType: text("winning_ad_type"),
  /** Winning ad workflow: full audio transcript from fal whisper. Null for static ads or other sources. */
  winningAdTranscript: text("winning_ad_transcript"),
  /** Winning ad workflow: structured angle JSON extracted by ad_extract_angle prompt. Shape: { primary_angle_name, hook, mechanism, target_pain, key_claims[], tone, creative_format, summary } */
  winningAdAnalysis: jsonb("winning_ad_analysis"),
  /** The fully-rendered HTML page (output of listicle_lander_html prompt). Stored verbatim. */
  renderedHtml: text("rendered_html"),
  /** User feedback when regenerating the HTML render */
  htmlFeedback: text("html_feedback"),
  /** LanderLab identifiers — populated when status >= 'deployed' */
  landerlabLanderId: text("landerlab_lander_id"),
  landerlabVariantId: text("landerlab_variant_id"),
  landerlabEncryptedVariantId: text("landerlab_encrypted_variant_id"),
  landerlabDomainId: text("landerlab_domain_id"),
  publishedUrl: text("published_url"),
  previewUrl: text("preview_url"),
  editorUrl: text("editor_url"),
  error: text("error"),
});

export const listicleImages = pgTable("listicle_images", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  listicleId: uuid("listicle_id").notNull(),
  /** Section number (1-based), matching the listicle's numbered sections */
  sectionIdx: integer("section_idx").notNull(),
  /** Headline of the section this image illustrates */
  sectionHeadline: text("section_headline"),
  /** The image-generation prompt produced by listicle_image_prompts */
  imagePrompt: text("image_prompt"),
  /** fal.ai output URL once generated */
  imageUrl: text("image_url"),
  imageStatus: text("image_status").notNull().default("idle"), // idle | generating | ready | failed
  imageApproval: text("image_approval").notNull().default("pending"), // pending | approved | rejected
  imageFeedback: text("image_feedback"),
  imageError: text("image_error"),
});

export type Listicle = typeof listicles.$inferSelect;
export type NewListicle = typeof listicles.$inferInsert;
export type ListicleImage = typeof listicleImages.$inferSelect;
export type NewListicleImage = typeof listicleImages.$inferInsert;
