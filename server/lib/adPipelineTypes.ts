/** The fields of a CreativeBrief that the pipeline reads. Mirrors adConsoleBrief.ts. */
export type AdConsoleCreativeBriefLike = {
  feedItemId: string;
  sourceType: "ad" | "organic";
  format: string;
  referenceMediaUrls: string[];
  thumbnailUrl: string | null;
  transcript: string | null;
  sourceCopy: string | null;
  sourceUrl: string | null;
  niche: string | null;
  advertiserName: string | null;
};
