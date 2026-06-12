import { generateText } from "./anthropic.js";
import { loadPrompt } from "./prompts.js";
import { schema } from "./db.js";

/**
 * Text artifacts that can be revised from client feedback. Angle `block`
 * (strategy) stays manual-edit only and `statements` are web-mined, so neither
 * is revisable through this targeted-edit path.
 */
export type RevisableKind = "messages" | "adCopy";

/** Minimal angle shape this module needs — name + elaborated strategy block. */
export type RevisableAngle = {
  name: string;
  block: string;
};

export type ArtifactRevision = {
  content: string;
  model: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
};

/**
 * Short product descriptor handed to the copy/ad-copy prompts as the
 * `{{product}}` variable — enough to ground the product's identity without
 * the full research markdown.
 */
export function productDescriptor(row: typeof schema.products.$inferSelect): string {
  const parts = [row.name || "(unknown product)"];
  if (row.category) parts.push(`Category: ${row.category}`);
  if (row.productUrl) parts.push(`URL: ${row.productUrl}`);
  return parts.join("\n");
}

/**
 * The primary_ad_copy prompt always emits the Angle Name as the ad's first line
 * (it's a separator in the multi-ad report flow). For a single-angle ad that's
 * redundant — the angle title is already shown above the copy — so drop the
 * leading line when it restates the angle name. We match by TOKEN OVERLAP rather
 * than exact/prefix compare, because the model freely rewords the title (e.g.
 * inserts "The", reorders words): if ≥50% of the angle name's significant words
 * appear in the first line, it's a restatement → strip it. A real hook (which
 * shares few of the angle's distinctive nouns) stays intact.
 */
export function stripLeadingAngleName(text: string, angleName: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return text.trim();

  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const stop = new Set(["the", "a", "an", "and", "of", "to", "for", "your", "you", "but", "with"]);
  const firstToks = new Set(tokenize(lines[i]));
  const nameToks = tokenize(angleName).filter((t) => t.length >= 3 && !stop.has(t));
  if (nameToks.length === 0) return text.trim();
  const overlap = nameToks.filter((t) => firstToks.has(t)).length / nameToks.length;

  if (overlap >= 0.5) {
    lines.splice(0, i + 1);
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines.join("\n").trim();
  }
  return text.trim();
}

/**
 * Apply one piece of client feedback to one text artifact and return the revised
 * copy WITHOUT persisting it (the caller stashes it on the feedback row pending
 * accept/decline). A single short LLM call via `dfy_artifact_revise`, a
 * targeted-edit prompt told to do exactly what the feedback asks and preserve
 * everything else. Post-processing mirrors `runAngleArtifact` so the revision has
 * the same shape as the original (≤10 raw message lines / stripped ad copy).
 *
 * Lives in lib (not the products route) so BOTH the authed operator route and
 * the public client-facing share route can call it.
 */
export async function generateArtifactRevision(params: {
  product: typeof schema.products.$inferSelect;
  angle: RevisableAngle;
  kind: RevisableKind;
  original: string;
  feedback: string;
}): Promise<ArtifactRevision> {
  const { product, angle, kind, original, feedback } = params;
  const angleContext = `**${angle.name}**\n\n${angle.block}`;

  const sectionLabel =
    kind === "messages" ? "rewritten first-person messages" : "primary ad copy";

  const formatRules =
    kind === "messages"
      ? [
          "Output up to 10 first-person messages, ONE per line.",
          "No numbering, no bullets, no blank lines, no labels, no code fences — just the raw message lines.",
        ].join("\n")
      : [
          "Output one complete primary ad in plain text:",
          "- a hook line",
          "- a one-line solution",
          "- roughly 5 benefit bullets",
          "- a single closing call-to-action",
          "No code fences, no surrounding commentary, and do not restate the angle name as a title.",
        ].join("\n");

  const prompt = loadPrompt("dfy_artifact_revise", {
    product: productDescriptor(product),
    angle: angleContext,
    section_label: sectionLabel,
    original,
    feedback,
    format_rules: formatRules,
  });

  const result = await generateText({
    systemPrompt: prompt.rendered,
    userMessage:
      "Apply the client feedback to the copy above. Output only the revised copy, ready to paste.",
    model: prompt.config.model,
    maxTokens: prompt.config.maxTokens,
    thinking: prompt.config.thinking,
  });

  let content = result.text.trim();
  if (kind === "messages") {
    content = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^\s*(angle\s*:|```)/i.test(l))
      .slice(0, 10)
      .join("\n");
  } else {
    content = stripLeadingAngleName(content, angle.name);
  }
  if (!content) throw new Error(`${kind} revision returned empty output`);

  return {
    content,
    model: result.model,
    promptVersion: prompt.version,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
  };
}
