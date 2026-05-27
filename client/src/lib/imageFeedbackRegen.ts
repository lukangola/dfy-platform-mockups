/**
 * Shared client helper: regenerate a generated image with user feedback.
 *
 * Why this exists: Character B-Roll, Single Scene, and Product B-Roll all
 * need "user types feedback, model edits the existing image" UX. Without
 * a shared helper they'd each maintain their own slightly-different
 * implementation — which is exactly what we had until now, and the
 * Product B-Roll version diverged into a weaker pattern (append the
 * feedback as a free-form tail of the original long prompt, which the
 * model under-weights compared to the rest of the prompt).
 *
 * The strong pattern, lifted from Character B-Roll: route through a
 * SHORT, directive "feedback rework" prompt that explicitly tells the
 * image model:
 *   - the FIRST attached image is the source to edit
 *   - the feedback IS the directive (not an afterthought at the tail of
 *     a 1500-character scene description)
 *   - everything else from the source frame must be preserved
 *
 * The model (`nano-banana-pro/edit`) treats the first image_url as the
 * canvas and the rest as identity / product / style anchors. The caller
 * is responsible for ordering `extraRefs` correctly — typically:
 *   character apps: [character portrait, product front, product back, …]
 *   product apps:   [product front, product back, content image, ref sheet]
 */
import { generateImage } from "./api";

export type ImageFeedbackRegenArgs = {
  /** Free-text user feedback. Must be non-empty (callers usually trim()). */
  feedback: string;
  /** The current image URL to edit. Becomes image_urls[0] for the model. */
  sourceImageUrl: string;
  /** Additional reference URLs (identity / product / style anchors). */
  extraRefs?: string[];
  /**
   * Prompt file that drives the rework. Defaults to the character variant
   * because that's the proven one — Product B-Roll passes its own variant
   * (`broll_image_feedback`) which drops character-specific rules.
   */
  action?: string;
  /** fal model id. Defaults to nano-banana-pro/edit. */
  model?: string;
  /** Aspect ratio. Defaults to 9:16 (the standard b-roll / UGC shape). */
  aspectRatio?: string;
};

export async function regenImageWithFeedback(args: ImageFeedbackRegenArgs): Promise<string> {
  const refs: string[] = [args.sourceImageUrl];
  // De-dupe so the source image isn't accidentally listed twice when a
  // caller passes it back via extraRefs (rare, but happens in product apps
  // where the source image and a product ref can coincide for hero shots).
  for (const u of args.extraRefs ?? []) {
    if (u && !refs.includes(u)) refs.push(u);
  }
  const res = await generateImage(args.action ?? "character_broll_image_feedback", {
    vars: { feedback: args.feedback },
    input: {
      image_urls: refs,
      aspect_ratio: args.aspectRatio ?? "9:16",
      num_images: 1,
      output_format: "jpeg",
    },
    model: args.model ?? "fal-ai/nano-banana-pro/edit",
  });
  const url = res.urls[0];
  if (!url) throw new Error("Feedback regen returned no image URL");
  return url;
}
