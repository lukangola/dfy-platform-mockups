/**
 * Cross-origin-safe file download. The `<a download>` attribute is ignored
 * by browsers when the href is cross-origin (e.g. fal.ai CDN), so the anchor
 * navigates instead of downloading. Fetching into a Blob and clicking a local
 * object URL bypasses that.
 */
export async function downloadViaBlob(url: string, filename: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}
