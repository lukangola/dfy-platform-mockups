/**
 * Resolves the hard-wired product reference template image at
 * client/public/templates/product-reference-sheet.{png,jpg,webp} to a fal.storage
 * URL so nano-banana-pro/edit can consume it. Uploaded once and cached.
 */
import { promises as fs } from "fs";
import path from "path";
import { uploadToFalStorage } from "./fal.js";

const TEMPLATE_DIR = path.resolve(process.cwd(), "client/public/templates");
const TEMPLATE_BASENAME = "product-reference-sheet";
const CACHE_PATH = path.resolve(process.cwd(), "server/data/product-reference-template.json");

type CacheEntry = {
  url: string;
  sourceHash: string;
  uploadedAt: string;
};

async function findTemplateFile(): Promise<{ absPath: string; mime: string; filename: string } | null> {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const p = path.join(TEMPLATE_DIR, `${TEMPLATE_BASENAME}.${ext}`);
    try {
      await fs.access(p);
      const mime =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return { absPath: p, mime, filename: `${TEMPLATE_BASENAME}.${ext}` };
    } catch {
      // try next
    }
  }
  return null;
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(entry, null, 2), "utf8");
}

async function fileSignature(p: string): Promise<string | null> {
  try {
    const st = await fs.stat(p);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

/**
 * Returns the fal.storage URL for the product reference template. Uploads on
 * first call (or whenever the file on disk changes), caches in server/data/.
 * Returns null if the template file is missing on disk.
 */
export async function getProductReferenceTemplateUrl(): Promise<string | null> {
  const found = await findTemplateFile();
  if (!found) return null;

  const sig = await fileSignature(found.absPath);
  if (!sig) return null;

  const cached = await readCache();
  if (cached && cached.sourceHash === sig) return cached.url;

  const buf = await fs.readFile(found.absPath);
  const url = await uploadToFalStorage(buf, found.mime, found.filename);
  await writeCache({ url, sourceHash: sig, uploadedAt: new Date().toISOString() });
  return url;
}
