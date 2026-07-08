/**
 * Shared content-safety error classification for durable-job pages.
 *
 * Single source of truth for detecting Gemini-classifier rejections in
 * job-item error text and for the user-facing help copy shown after the
 * automatic soften-and-retry is exhausted. Previously duplicated verbatim
 * in CharacterBrollAppPage and SingleSceneAppPage — any phrase added to
 * the classifier must land in both flows, so it lives here now.
 */

/**
 * Detect a Gemini-classifier rejection in a job item's error string.
 *
 * The old direct-call flow detected this via ApiCallError{status:422,
 * errorCode:"content_safety_rejected"}; durable-job items only surface the
 * raw fal message text (FalContentSafetyError.message → item.error), so we
 * match the same phrases the server groups under content safety. A 422 that
 * is a genuine validation error carries field-level `detail[]` text instead
 * and won't match — string matching is actually tighter than the old
 * status check here.
 *
 * The alternates mirror fal.ts's isTransientGenerationRefusal phrase set
 * (same source of truth): any of those Gemini-refusal phrasings can land
 * verbatim in item.error once fal's bounded retries are exhausted, and
 * fal.ts promises the client soften-and-retry flow kicks in for them.
 */
export function isContentSafetyErrorText(msg: string): boolean {
  return /did not generate the expected output|could not generate images with the given|try again with different inputs|model did not generate|unsafe content|content policy/i.test(msg);
}

/**
 * Shown when a shot / scene fails the safety classifier even after its one
 * automatic sanitize-retry — the raw fal message is useless to the user;
 * this tells them what actually works.
 */
export const SAFETY_REJECTION_HELP =
  "The image model rejected this prompt as potentially unsafe even after auto-softening the language. Try regenerating with feedback — soften wardrobe terms (e.g. 'bra' → 'fitted top'), avoid describing body parts pressing against clothing, and keep the emotional beat on the face / posture rather than on clothing struggle.";
