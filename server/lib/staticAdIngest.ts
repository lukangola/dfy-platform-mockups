/**
 * Scans client/public/static-ads/library/* on boot. For every image file not
 * already in the DB (matched by sourcePath + size:mtime signature), uploads to
 * fal.storage and inserts a row with deconstructionStatus="pending" and
 * niche="unassigned". The user assigns the niche later via PATCH on the API.
 * The deconstruction job is fired separately — this module only handles ingest.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { uploadToFalStorage } from "./fal.js";

const LIBRARY_DIR = path.resolve(process.cwd(), "client/public/static-ads/library");

const SUPPORTED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DEFAULT_NICHE = "unassigned";

function mimeFor(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function humanizeFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

async function listImages(): Promise<{ filename: string; abs: string; ext: string; size: number; mtimeMs: number }[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(LIBRARY_DIR);
  } catch {
    return [];
  }
  const out: { filename: string; abs: string; ext: string; size: number; mtimeMs: number }[] = [];
  for (const filename of entries) {
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;
    const abs = path.join(LIBRARY_DIR, filename);
    const st = await fs.stat(abs);
    if (!st.isFile()) continue;
    out.push({ filename, abs, ext, size: st.size, mtimeMs: st.mtimeMs });
  }
  return out;
}

/**
 * Returns every newly-inserted or changed row (so the caller can fire
 * deconstruction jobs). Files already in the DB with matching signature are
 * skipped.
 */
export async function ingestStaticAdLibrary(): Promise<string[]> {
  const inserted: string[] = [];
  const images = await listImages();
  for (const img of images) {
    const sourcePath = img.filename;
    const signature = `${img.size}:${img.mtimeMs}`;

    const existing = await db
      .select()
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.sourcePath, sourcePath))
      .limit(1);

    if (existing.length > 0 && existing[0].sourceSignature === signature) {
      continue;
    }

    try {
      const buf = await fs.readFile(img.abs);
      const imageUrl = await uploadToFalStorage(buf, mimeFor(img.ext), img.filename);

      if (existing.length > 0) {
        await db
          .update(schema.staticAdReferences)
          .set({
            imageUrl,
            sourceSignature: signature,
            deconstructionStatus: "pending",
            deconstructionError: null,
          })
          .where(eq(schema.staticAdReferences.id, existing[0].id));
        inserted.push(existing[0].id);
        console.log(`[static-ads] re-ingested ${sourcePath}`);
      } else {
        const [row] = await db
          .insert(schema.staticAdReferences)
          .values({
            title: humanizeFilename(img.filename) || img.filename,
            niche: DEFAULT_NICHE,
            imageUrl,
            sourcePath,
            sourceSignature: signature,
            deconstructionStatus: "pending",
          })
          .returning({ id: schema.staticAdReferences.id });
        if (row) {
          inserted.push(row.id);
          console.log(`[static-ads] ingested ${sourcePath} → ${row.id}`);
        }
      }
    } catch (err) {
      console.error(`[static-ads] failed to ingest ${sourcePath}:`, err);
    }
  }
  return inserted;
}
