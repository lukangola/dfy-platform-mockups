export interface ProcessStep {
  id: number;
  title: string;
  shortTitle: string;
  icon: string;
  inputs: InputField[];
  aiActions: string[];
  outputs: OutputItem[];
  status: 'pending' | 'active' | 'review' | 'approved';
}

export interface InputField {
  id: string;
  label: string;
  type: 'text' | 'url' | 'file' | 'textarea' | 'select';
  placeholder: string;
  required: boolean;
  fromPrevious?: boolean;
  previousStepId?: number;
}

export interface OutputItem {
  id: string;
  label: string;
  type: 'document' | 'list' | 'data' | 'creative' | 'link';
  description: string;
  sampleContent?: string;
}

export const processSteps: ProcessStep[] = [
  {
    id: 0,
    title: "Set Up Infrastructure & Optimize Status Quo",
    shortTitle: "Infrastructure",
    icon: "⚙️",
    status: "active",
    inputs: [
      { id: "brand_name", label: "Brand Name", type: "text", placeholder: "Enter brand name...", required: true },
      { id: "product_url", label: "Product URL", type: "url", placeholder: "https://...", required: true },
      { id: "onboarding_data", label: "Onboarding Form Data", type: "textarea", placeholder: "Paste onboarding form submission...", required: true },
    ],
    aiActions: [
      "Create Google Drive folder structure",
      "Duplicate Copywriting Master Sheet",
      "Duplicate Testing Master Sheet",
      "Duplicate Creative Pipeline Trello Board",
      "Create Claude Project for Brand",
      "Create Slack Channel for Brand",
      "Setup Testing & Evergreen Campaigns",
      "Analyze status quo & identify quick wins",
      "Generate 6-week roadmap",
    ],
    outputs: [
      { id: "drive_folder", label: "Google Drive Folder", type: "link", description: "Client folder with all templates" },
      { id: "copywriting_sheet", label: "Copywriting Master Sheet", type: "document", description: "Duplicated and branded template" },
      { id: "testing_sheet", label: "Testing Master Sheet", type: "document", description: "Ready for message testing data" },
      { id: "roadmap", label: "6-Week Roadmap", type: "document", description: "Strategic execution plan", sampleContent: "Week 1-2: Infrastructure & Research\nWeek 2-3: Message Testing\nWeek 3-4: Creative Production\nWeek 4-5: Listicle & Launch\nWeek 5-6: Analysis & Optimization" },
      { id: "quick_wins", label: "Quick Wins Report", type: "data", description: "Identified optimizations for current setup" },
    ],
  },
  {
    id: 1,
    title: "Conduct Research & Brief B-Roll",
    shortTitle: "Research",
    icon: "🔍",
    status: "pending",
    inputs: [
      { id: "product_url_1", label: "Front End Offer URL(s)", type: "url", placeholder: "https://product-page.com/offer", required: true, fromPrevious: true, previousStepId: 0 },
      { id: "product_reviews", label: "Product Reviews", type: "textarea", placeholder: "Paste product reviews (optional)...", required: false },
      { id: "product_image", label: "Product Image (White BG)", type: "file", placeholder: "Upload product image...", required: true },
      { id: "competitor_brands", label: "Competitor Brands", type: "textarea", placeholder: "List competitor brands...", required: false },
    ],
    aiActions: [
      "Execute AI Master Prompt for product research",
      "Deep research on product & market",
      "Identify top angles from competitor analysis",
      "Generate creative type recommendations",
      "Create B-Roll content brief from product analysis",
      "Compile angle research document",
    ],
    outputs: [
      { id: "research_doc", label: "Full Research Document", type: "document", description: "Comprehensive product & market research", sampleContent: "## Product Analysis\n\n**Core Benefits:** Reduces inflammation, improves joint mobility\n**Target Audience:** Adults 40-65 with chronic joint pain\n**Unique Mechanism:** Patented collagen peptide complex\n\n## Competitor Landscape\n- Brand A: Focuses on athletic recovery\n- Brand B: Targets elderly demographic\n- Brand C: Premium positioning with clinical studies\n\n## Recommended Angles\n1. \"The Hidden Root Cause\" - Problem-aware\n2. \"Why Nothing Else Worked\" - Solution-aware\n3. \"Doctor's Secret\" - Authority angle" },
      { id: "angles_list", label: "Angles & Creative Types", type: "list", description: "Ranked angles with creative recommendations" },
      { id: "broll_brief", label: "B-Roll Content Brief", type: "document", description: "Shot list and content requirements for B-Roll" },
    ],
  },
  {
    id: 2,
    title: "Conduct Message Testing & Determine Winning Angle",
    shortTitle: "Message Testing",
    icon: "💬",
    status: "pending",
    inputs: [
      { id: "angle_research", label: "Angle Research", type: "textarea", placeholder: "Auto-populated from research...", required: true, fromPrevious: true, previousStepId: 1 },
      { id: "product_url_2", label: "Product Page URL", type: "url", placeholder: "https://...", required: true, fromPrevious: true, previousStepId: 0 },
      { id: "product_images_2", label: "Product Images", type: "file", placeholder: "Upload product images...", required: true },
    ],
    aiActions: [
      "Generate messages for each angle",
      "Create angle-specific ad copy variations",
      "Generate message testing creative templates",
      "Prepare ad creatives via Weavy",
      "Configure testing campaign structure",
      "Set up LVRG_ABO_Testing_Traffic campaign",
    ],
    outputs: [
      { id: "message_copy", label: "Message & Angle Copy", type: "document", description: "Generated messages for all angles", sampleContent: "## Angle 1: The Hidden Root Cause\n**Message A:** \"Your joint pain isn't from aging — it's from a protein deficiency 93% of doctors miss.\"\n**Message B:** \"The real reason your joints hurt has nothing to do with cartilage wear.\"\n**Message C:** \"Scientists discovered the #1 cause of joint pain — and it's not what you think.\"\n\n## Angle 2: Why Nothing Else Worked\n**Message A:** \"Glucosamine failed you. Here's what actually repairs damaged joints.\"\n**Message B:** \"If joint supplements haven't worked, you've been targeting the wrong problem.\"" },
      { id: "test_creatives", label: "Message Testing Creatives", type: "creative", description: "Ad creatives ready for testing" },
      { id: "campaign_structure", label: "Campaign Structure", type: "data", description: "Campaign naming and ad set configuration" },
      { id: "winning_angle", label: "WINNING ANGLE", type: "data", description: "Determined after 3 days of data", sampleContent: "🏆 WINNING ANGLE: \"The Hidden Root Cause\"\n\nPerformance Data:\n- Cost per Link Click: $0.42 (lowest)\n- Link Click CTR: 3.8% (highest)\n- Winning Message: \"Your joint pain isn't from aging — it's from a protein deficiency 93% of doctors miss.\"\n\nRunner-up: \"Why Nothing Else Worked\" ($0.58 CPC, 2.9% CTR)" },
    ],
  },
  {
    id: 3,
    title: "Produce 100 Creatives for Winning Angle",
    shortTitle: "Creative Production",
    icon: "🎨",
    status: "pending",
    inputs: [
      { id: "winning_angle_3", label: "Winning Angle", type: "text", placeholder: "Auto-populated...", required: true, fromPrevious: true, previousStepId: 2 },
      { id: "founder_story", label: "Founder Story", type: "textarea", placeholder: "Paste founder/about us story...", required: true },
      { id: "video_content", label: "Video Content (B-Roll & Founder)", type: "file", placeholder: "Upload video files...", required: true },
    ],
    aiActions: [
      "Generate 3 founder ad concepts × 5 hooks = 15 scripts",
      "Generate 3 Mini VSL concepts × 5 hooks = 15 scripts",
      "Generate 3 short TOF video ads × 5 messages = 15 scripts",
      "Create static ads by awareness stage (80/15/5 split)",
      "Generate 20 UGC scripts × 5 hooks = 100 scripts",
      "Research & rewrite proven ad scripts via AdSpy",
      "Compile B-Roll shot list from all scripts",
    ],
    outputs: [
      { id: "founder_ads", label: "15 Founder Ad Scripts", type: "creative", description: "3 concepts × 5 hooks each" },
      { id: "mini_vsls", label: "15 Mini VSL Scripts", type: "creative", description: "3 concepts × 5 hooks each" },
      { id: "short_tof", label: "15 Short TOF Video Ads", type: "creative", description: "3 concepts × 5 message variations" },
      { id: "static_ads", label: "Static Ad Designs", type: "creative", description: "By awareness stage: 80% problem, 15% solution, 5% product" },
      { id: "ugc_scripts", label: "100 UGC Ad Scripts", type: "creative", description: "20 scripts × 5 hooks each" },
      { id: "broll_shotlist", label: "B-Roll Shot List", type: "document", description: "Complete shot list for all scripts" },
    ],
  },
  {
    id: 4,
    title: "Build Listicle for Winning Angle",
    shortTitle: "Listicle",
    icon: "📋",
    status: "pending",
    inputs: [
      { id: "winning_angle_4", label: "Winning Angle", type: "text", placeholder: "Auto-populated...", required: true, fromPrevious: true, previousStepId: 2 },
      { id: "static_images", label: "Static Images / AI Generated", type: "file", placeholder: "Upload images...", required: true },
      { id: "product_page_4", label: "Product Page URL", type: "url", placeholder: "https://...", required: true, fromPrevious: true, previousStepId: 0 },
    ],
    aiActions: [
      "Generate listicle copy from reference templates",
      "Rewrite for winning angle and product",
      "Generate image suggestions for each bullet point",
      "Create AI-generated listicle images",
      "Assemble listicle in Replo",
    ],
    outputs: [
      { id: "listicle_copy", label: "Listicle Copy", type: "document", description: "11 reasons why format", sampleContent: "# 11 Reasons Why [Product] Is The #1 Choice For Joint Pain Relief\n\n1. **Targets the root cause** — Unlike glucosamine that only masks symptoms, [Product] addresses the collagen deficit that causes 93% of joint deterioration.\n\n2. **Clinically proven results** — In a double-blind study, 87% of participants reported significant pain reduction within 14 days.\n\n3. **No prescription needed** — Doctor-formulated but available without the hassle of appointments..." },
      { id: "listicle_images", label: "Listicle Images", type: "creative", description: "Generated images for each section" },
      { id: "listicle_page", label: "Completed Listicle Page", type: "link", description: "Live listicle page in Replo" },
    ],
  },
  {
    id: 5,
    title: "Analyze Results & Consult Client",
    shortTitle: "Analysis",
    icon: "📊",
    status: "pending",
    inputs: [
      { id: "campaign_data", label: "Campaign Performance Data", type: "textarea", placeholder: "Paste or upload campaign data...", required: true },
      { id: "creative_performance", label: "Creative Performance Data", type: "file", placeholder: "Upload performance report...", required: true },
    ],
    aiActions: [
      "Analyze campaign performance metrics",
      "Identify top-performing creatives",
      "Calculate ROAS and key KPIs",
      "Generate optimization recommendations",
      "Prepare client consultation document",
      "Draft next-month roadmap",
    ],
    outputs: [
      { id: "performance_report", label: "Sprint Performance Report", type: "document", description: "Comprehensive analysis of all campaigns" },
      { id: "top_creatives", label: "Top Performing Creatives", type: "data", description: "Ranked by performance metrics" },
      { id: "recommendations", label: "Optimization Recommendations", type: "document", description: "Next steps and scaling strategy" },
      { id: "next_roadmap", label: "Next Month Roadmap", type: "document", description: "Adapted strategy for continuation" },
    ],
  },
];
