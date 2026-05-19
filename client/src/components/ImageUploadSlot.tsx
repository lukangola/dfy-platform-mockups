/**
 * Reusable image-upload tile + the lightweight state shape it needs.
 *
 * Extracted from CreateBrandDialog so any dialog that needs the same
 * "click-to-upload → preview → status badge" UX can share it. Currently
 * used by:
 *   - CreateBrandDialog (mandatory front + back shots for a new brand)
 *   - ProductsPage Add Product modal (optional front + back shots when
 *     adding a new product to an existing brand)
 *
 * The slot tracks the local dataUrl (for instant preview), the
 * fal.storage URL once uploaded (the value the parent submits to the
 * API), upload progress, and any error. `handleImageFile` does the
 * read + upload roundtrip; parent owns the slot state via React state
 * and passes both the slot + an updater.
 */
import { useRef } from "react";
import { Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { uploadProductImageRaw } from "@/lib/api";

export type ImageSlot = {
  /** base64 data URL for instant local preview */
  dataUrl: string | null;
  /** fal.storage public URL once the upload completes */
  uploadedUrl: string | null;
  uploading: boolean;
  error: string | null;
};

export function emptyImageSlot(): ImageSlot {
  return { dataUrl: null, uploadedUrl: null, uploading: false, error: null };
}

/**
 * Read the file, set the slot's dataUrl for preview, upload to
 * fal.storage, fill in uploadedUrl. Caller passes an `update` callback
 * that overwrites the slot in their React state.
 */
export async function handleImageFile(
  file: File | null,
  update: (slot: ImageSlot) => void,
): Promise<void> {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    update({ ...emptyImageSlot(), error: "Only image files are supported" });
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    update({ ...emptyImageSlot(), error: "Image exceeds 8MB limit" });
    return;
  }

  const reader = new FileReader();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  update({ dataUrl, uploadedUrl: null, uploading: true, error: null });

  try {
    const { url } = await uploadProductImageRaw(dataUrl, file.name);
    update({ dataUrl, uploadedUrl: url, uploading: false, error: null });
  } catch (err) {
    update({
      dataUrl,
      uploadedUrl: null,
      uploading: false,
      error: err instanceof Error ? err.message : "Upload failed",
    });
  }
}

export function ImageUploadSlot({
  label,
  slot,
  onChange,
  onClear,
  disabled,
  disabledHint,
}: {
  label: string;
  slot: ImageSlot;
  onChange: (file: File | null) => void;
  onClear: () => void;
  /** Visually mute + block clicks (e.g. "back" disabled until "front" filled) */
  disabled?: boolean;
  /** Tooltip / overlay text shown when disabled */
  disabledHint?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">{label}</span>
        {slot.dataUrl && !disabled && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-mono text-white/30 hover:text-red-400 transition"
          >
            Clear
          </button>
        )}
      </div>
      <div
        onClick={() => { if (!disabled) fileInputRef.current?.click(); }}
        className={`aspect-square rounded-lg border border-dashed border-white/[0.12] bg-[#0A0C0F] flex items-center justify-center overflow-hidden relative transition ${
          disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:border-cyan-500/40 cursor-pointer"
        }`}
        title={disabled ? disabledHint : undefined}
      >
        {slot.dataUrl ? (
          <>
            <img src={slot.dataUrl} alt={label} className="w-full h-full object-contain" />
            {slot.uploading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 size={18} className="animate-spin text-cyan-300" />
              </div>
            )}
            {slot.uploadedUrl && !slot.uploading && (
              <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-mono text-emerald-300">
                Uploaded
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-white/25 px-3 text-center">
            <ImageIcon size={20} />
            <div className="flex items-center gap-1 text-[10px] font-mono">
              <Upload size={10} />
              {disabled ? disabledHint ?? "Disabled" : "Click to upload"}
            </div>
          </div>
        )}
      </div>
      {slot.error && (
        <div className="text-[10px] text-red-400 font-mono">{slot.error}</div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
