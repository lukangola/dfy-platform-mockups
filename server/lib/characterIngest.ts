/**
 * Scans client/public/characters/library/* on boot. For every image file not
 * already in the DB (matched by sourcePath + size:mtime signature), uploads to
 * fal.storage and inserts a row with `brandId = NULL` (default / shared
 * library — every brand sees these).
 *
 * Brand-private characters are uploaded via the API (`POST /api/characters`)
 * and never touch this folder.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db.js";
import { uploadToFalStorage } from "./fal.js";

const LIBRARY_DIR = path.resolve(process.cwd(), "client/public/characters/library");

const SUPPORTED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

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
 * Returns every newly-inserted or changed row id. Files already in the DB with
 * matching signature are skipped. Lookup is scoped to default-library rows
 * (`brandId IS NULL`) so a brand-private upload sharing a filename never
 * collides with the seed.
 */
export async function ingestCharacterLibrary(): Promise<string[]> {
  const inserted: string[] = [];
  const images = await listImages();
  for (const img of images) {
    const sourcePath = img.filename;
    const signature = `${img.size}:${img.mtimeMs}`;

    const existing = await db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.sourcePath, sourcePath),
          isNull(schema.characters.brandId),
        ),
      )
      .limit(1);

    if (existing.length > 0 && existing[0].sourceSignature === signature) {
      continue;
    }

    try {
      const buf = await fs.readFile(img.abs);
      const imageUrl = await uploadToFalStorage(buf, mimeFor(img.ext), img.filename);

      if (existing.length > 0) {
        await db
          .update(schema.characters)
          .set({ imageUrl, sourceSignature: signature })
          .where(eq(schema.characters.id, existing[0].id));
        inserted.push(existing[0].id);
        console.log(`[characters] re-ingested ${sourcePath}`);
      } else {
        const [row] = await db
          .insert(schema.characters)
          .values({
            brandId: null,
            title: humanizeFilename(img.filename) || img.filename,
            imageUrl,
            sourcePath,
            sourceSignature: signature,
          })
          .returning({ id: schema.characters.id });
        if (row) {
          inserted.push(row.id);
          console.log(`[characters] ingested ${sourcePath} → ${row.id}`);
        }
      }
    } catch (err) {
      console.error(`[characters] failed to ingest ${sourcePath}:`, err);
    }
  }
  return inserted;
}
