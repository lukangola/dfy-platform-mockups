/**
 * DESIGN: Studio Control Room — Done For You Workflow (Enhanced)
 * Full automated workflow with detailed views for every creative type
 * Research structure based on real Copywriting Master Sheet output
 * Embedded Message Testing flow with template selection
 * B-Roll shot list output from research
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Search, Target, MessageSquare, Paintbrush, FileText, BarChart3,
  ChevronRight, ChevronLeft, Check, RefreshCw, Send, Play,
  Edit3, ThumbsUp, RotateCcw, Download, ArrowRight, ArrowLeft,
  Sparkles, Zap, Eye, X, ChevronDown, ChevronUp, Plus,
  Video, ImagePlus, Type, Megaphone, ListChecks, Camera,
  AlertCircle, BookOpen, Users, Beaker, Shield, Brain, Heart,
  Flame, Layers, Grid3X3, Maximize2,
} from "lucide-react";
import { IMAGES, MOCK_PRODUCTS, MOCK_MESSAGE_ANGLES, MOCK_MESSAGE_TEMPLATES } from "@/lib/mockData";

// ============================================================
// DFY WORKFLOW STEPS (updated — removed campaign, added B-Roll to research)
// ============================================================

const DFY_STEPS = [
  { id: 0, key: "select", label: "Select Product", icon: Package, description: "Choose the product" },
  { id: 1, key: "research", label: "Research", icon: Search, description: "Product & market research + B-Roll shot list" },
  { id: 2, key: "angles", label: "Angles & Messages", icon: Target, description: "Review angles, messages, and copy" },
  { id: 3, key: "message-testing", label: "Message Testing", icon: MessageSquare, description: "Choose template & generate testing ads" },
  { id: 4, key: "creatives", label: "Produce Creatives", icon: Paintbrush, description: "Founder Ads, VSLs, Static Ads, UGC Scripts" },
  { id: 5, key: "listicle", label: "Build Listicle", icon: FileText, description: "Angle-specific listicle page" },
  { id: 6, key: "analysis", label: "Sprint Complete", icon: BarChart3, description: "Summary & export" },
];

// ============================================================
// DETAILED RESEARCH DATA (based on real Copywriting Master Sheet)
// ============================================================

const DETAILED_RESEARCH = {
  // Step 0: Product Context
  productContext: {
    description: "Golden Radiance Serum is a premium facial serum featuring a 24K gold-infused formula with Vitamin C, Hyaluronic Acid, and Niacinamide. Targets dullness, fine lines, and uneven skin tone.",
    primaryPurpose: "To deliver visible anti-aging results through a multi-active formula that combines luxury experience with clinical efficacy. Positioned as an accessible premium alternative to high-end serums.",
    frameworkAssignment: "Transformation-Based Luxury Positioning Framework",
  },
  // Step 1: Product Input
  productInput: {
    sourceUrl: "https://lumina-beauty.com/serum-gold",
    productName: "Golden Radiance Serum",
    price: "$78 / 30ml ($66.30 with subscription)",
    format: "Glass dropper bottle, 30ml",
    servingSize: "2-3 drops per application",
    rating: { stars: 4.7, reviews: 2847, breakdown: { five: 68, four: 22, three: 6, two: 3, one: 1 } },
    ingredients: [
      { name: "Vitamin C (L-Ascorbic Acid 15%)", mechanism: "Brightening via tyrosinase inhibition, antioxidant protection" },
      { name: "Hyaluronic Acid (3 molecular weights)", mechanism: "Multi-layer hydration at epidermis, dermis, and subcutaneous levels" },
      { name: "Niacinamide (5%)", mechanism: "Barrier repair, pore refinement, sebum regulation" },
      { name: "24K Gold Particles (colloidal)", mechanism: "Anti-inflammatory, promotes collagen synthesis, light-reflecting radiance" },
      { name: "Squalane (plant-derived)", mechanism: "Non-comedogenic moisture lock, mimics skin's natural sebum" },
      { name: "Peptide Complex (Matrixyl 3000)", mechanism: "Stimulates collagen I, III, IV production; reduces wrinkle depth" },
    ],
  },
  // Step 2: Deep Ingredient Analysis
  ingredientAnalysis: [
    {
      name: "Vitamin C (L-Ascorbic Acid)",
      activeCompound: "L-Ascorbic Acid at 15%",
      analysis: "L-Ascorbic Acid is the most bioavailable form of Vitamin C for topical application. At 15% concentration, it sits in the optimal efficacy window (10-20%) identified in multiple clinical studies. It works by inhibiting tyrosinase — the enzyme responsible for melanin production — resulting in visibly brighter, more even skin tone within 2-4 weeks. Additionally, it neutralizes free radicals from UV exposure and pollution, preventing premature aging at the cellular level. A 2017 study in the Journal of Clinical and Aesthetic Dermatology showed that 15% L-Ascorbic Acid reduced hyperpigmentation by 73% over 12 weeks.",
    },
    {
      name: "Hyaluronic Acid",
      activeCompound: "Triple molecular weight (high, medium, low)",
      analysis: "Unlike single-weight HA products that only hydrate the surface, this triple-weight formulation penetrates three distinct skin layers. High molecular weight (>1000 kDa) forms a moisture-retaining film on the epidermis. Medium weight (100-1000 kDa) penetrates to the dermis for deep hydration. Low molecular weight (<100 kDa) reaches the subcutaneous layer to stimulate the skin's own HA production. Clinical data shows this approach delivers 72-hour hydration vs. 8-12 hours for single-weight formulas.",
    },
    {
      name: "24K Gold Particles",
      activeCompound: "Colloidal gold nanoparticles",
      analysis: "Colloidal gold has been used in medicine for centuries, but recent dermatological research has validated its topical benefits. Gold nanoparticles exhibit potent anti-inflammatory properties by inhibiting NF-κB signaling — the master regulator of inflammatory responses. A 2012 study published in Nanomedicine showed that colloidal gold stimulated collagen synthesis by 89% in fibroblast cultures. The light-reflecting properties of gold particles also create an immediate visible radiance effect, which is both a cosmetic benefit and a powerful visual for content creation.",
    },
    {
      name: "Peptide Complex (Matrixyl 3000)",
      activeCompound: "Palmitoyl Tripeptide-1 & Palmitoyl Tetrapeptide-7",
      analysis: "Matrixyl 3000 is a dual-peptide complex that works synergistically to stimulate the production of collagen types I, III, and IV. In a double-blind clinical study, Matrixyl 3000 reduced wrinkle depth by 45% over 2 months. Unlike retinol, it achieves anti-aging effects without irritation, making it suitable for sensitive skin types. The peptides signal fibroblasts to increase extracellular matrix production, essentially 'tricking' the skin into behaving younger.",
    },
  ],
  // Step 3: Competitive Mapping
  competitiveMapping: [
    {
      category: "Premium Vitamin C Serums ($80-200)",
      examples: "SkinCeuticals C E Ferulic ($182), Drunk Elephant C-Firma ($80)",
      failures: "High price points with single-active focus. SkinCeuticals relies on brand prestige to justify 2.3x markup for a similar Vitamin C concentration. Drunk Elephant's formula oxidizes quickly, reducing efficacy within weeks of opening.",
      opportunity: "Multi-active formula at competitive price with superior stability through gold-particle encapsulation technology.",
    },
    {
      category: "Budget Vitamin C Options ($5-20)",
      examples: "The Ordinary Vitamin C 23% ($6.80), CeraVe Vitamin C Serum ($18)",
      failures: "Unstable formulations that oxidize rapidly, grainy textures, and concentrations that cause irritation without proportional results. The Ordinary's 23% concentration exceeds the optimal window and causes stinging in 40% of users.",
      opportunity: "Position as the 'Goldilocks' option — optimal concentration, premium experience, and multi-active benefits at a mid-market price.",
    },
    {
      category: "Gold-Infused Skincare ($40-150)",
      examples: "Peter Thomas Roth 24K Gold Mask ($85), Orogold 24K Deep Peeling ($120)",
      failures: "Most gold skincare products use gold as a marketing gimmick with negligible concentrations. Peter Thomas Roth's mask is a wash-off treatment with minimal gold contact time. Orogold uses gold leaf (not colloidal) which cannot penetrate the skin.",
      opportunity: "Colloidal gold nanoparticles that actually penetrate and deliver measurable anti-inflammatory benefits, combined with proven actives.",
    },
  ],
  // Step 4: Root Cause Mapping
  rootCauseMapping: [
    {
      name: "Oxidative Stress Accumulation",
      description: "Daily exposure to UV radiation, pollution, and blue light generates reactive oxygen species (ROS) that damage cellular DNA, break down collagen fibers, and accelerate the formation of fine lines and hyperpigmentation. Most consumers address symptoms (dullness, spots) without targeting the underlying oxidative cascade.",
    },
    {
      name: "Chronic Low-Grade Inflammation",
      description: "Micro-inflammation from environmental stressors, harsh skincare products, and stress hormones creates a persistent inflammatory state in the dermis. This 'inflammaging' degrades the extracellular matrix, weakens the skin barrier, and accelerates visible aging — often manifesting as redness, sensitivity, and premature wrinkles.",
    },
    {
      name: "Collagen Degradation Cycle",
      description: "After age 25, collagen production decreases by approximately 1% per year. Simultaneously, matrix metalloproteinases (MMPs) — enzymes that break down collagen — become more active. This creates a negative feedback loop where less collagen is produced while more is destroyed, leading to progressive loss of firmness and elasticity.",
    },
    {
      name: "Barrier Function Impairment",
      description: "Overuse of harsh actives (high-concentration retinol, chemical peels, physical exfoliants) strips the stratum corneum of essential lipids. This compromised barrier leads to transepidermal water loss (TEWL), increased sensitivity, and paradoxically accelerates the aging it was meant to prevent.",
    },
    {
      name: "Hydration-Radiance Disconnect",
      description: "Surface-level hydration from most moisturizers creates a temporary plumping effect but fails to address deep dermal dehydration. True radiance requires hydration at multiple skin depths — something single-weight hyaluronic acid products cannot achieve.",
    },
  ],
  // Step 4.1: Real-World Language
  realWorldLanguage: [
    {
      category: "Dull Skin & Lack of Radiance",
      quotes: [
        "\"My skin just looks... dead. No matter what I do, there's no glow.\"",
        "\"I spend 20 minutes on my routine and still look like I haven't slept in a week.\"",
        "\"Everyone asks if I'm tired. I'm not tired, my skin just looks terrible.\"",
        "\"I've tried vitamin C, retinol, AHA — nothing gives me that 'lit from within' look.\"",
      ],
    },
    {
      category: "Fine Lines & Premature Aging",
      quotes: [
        "\"I'm 32 and I have forehead lines that make me look 40.\"",
        "\"The lines around my eyes appeared overnight. One day smooth, next day creased.\"",
        "\"My mom looks younger than me and she uses bar soap. What am I doing wrong?\"",
        "\"I can literally see my skin losing firmness month by month. It's terrifying.\"",
      ],
    },
    {
      category: "Product Fatigue & Skepticism",
      quotes: [
        "\"I've spent $3,000 on serums this year alone. My skin looks the same.\"",
        "\"Every brand claims to be 'clinically proven' but none of them show the actual studies.\"",
        "\"I'm so tired of the skincare industry lying to me. Just give me something that works.\"",
        "\"At this point I'd rather save for Botox than buy another 'miracle' serum.\"",
      ],
    },
  ],
  // Review Analysis
  reviewAnalysis: {
    totalReviews: 2847,
    themes: [
      { name: "Visible Glow Within Days", percentage: 34, description: "Largest theme — users consistently report a noticeable 'lit from within' radiance within 3-7 days of first use." },
      { name: "Texture Improvement", percentage: 22, description: "Smoother skin texture, reduced pore appearance, and softer feel reported across all age groups." },
      { name: "Fine Line Reduction", percentage: 18, description: "Users 35+ specifically mention visible reduction in forehead lines and crow's feet within 2-4 weeks." },
      { name: "Luxury Experience", percentage: 14, description: "The gold color, glass packaging, and application ritual are frequently cited as reasons for repurchase." },
      { name: "Replaced Multiple Products", percentage: 8, description: "Users report simplifying their routine from 5-7 products to 2-3 after incorporating this serum." },
      { name: "Sensitive Skin Friendly", percentage: 4, description: "Despite active ingredients, minimal reports of irritation — attributed to the squalane and gold's anti-inflammatory properties." },
    ],
    keyObservation: "The strongest emotional driver is not the anti-aging benefit itself, but the confidence boost from visible radiance. Users describe feeling 'like themselves again' rather than 'younger' — suggesting transformation messaging should focus on radiance restoration rather than age reversal.",
  },
};

// B-Roll Shot List (from research)
const BROLL_SHOT_LIST = [
  { id: 1, shotType: "Unboxing", action: "Hands lift the branded box lid from a marble countertop, revealing tissue-wrapped product inside.", location: "Kitchen counter / vanity", visualExample: "Overhead angle, warm side-light catching the gold foil on the box, slow deliberate motion." },
  { id: 2, shotType: "Unboxing", action: "Fingers peel back tissue paper to reveal the glass serum bottle nestled in its holder.", location: "Vanity / bathroom counter", visualExample: "Close-up at 45°, shallow depth of field, the gold liquid visible through the glass catches light." },
  { id: 3, shotType: "Product Presentation", action: "Serum bottle stands alone on clean marble surface, camera slowly orbits 180°.", location: "Studio / clean surface", visualExample: "Product hero shot style — single directional light creating a long shadow, minimal props." },
  { id: 4, shotType: "Product Presentation", action: "Dropper pulls serum from bottle, holds it above to show the golden viscous liquid dripping.", location: "Studio / backlit setup", visualExample: "Backlit to make the gold serum glow like liquid gold, extreme close-up on the dropper tip." },
  { id: 5, shotType: "Product Presentation", action: "Full product range arranged in a diagonal line, camera slides along the lineup.", location: "Flat surface with neutral background", visualExample: "Editorial flat lay energy — each product casting soft shadows, consistent spacing." },
  { id: 6, shotType: "Product Usage", action: "Two drops of serum fall from dropper onto fingertips, catching light mid-air.", location: "Bathroom / natural light", visualExample: "Macro lens, the gold drops almost floating, natural window light from the side." },
  { id: 7, shotType: "Product Usage", action: "Fingertips press serum into cheek in gentle upward strokes.", location: "Bathroom mirror", visualExample: "Medium close-up of face, mirror reflection adds depth, morning light ambiance." },
  { id: 8, shotType: "Product Usage", action: "Palms press together then onto face in a warming-patting application technique.", location: "Bathroom / bedroom", visualExample: "Shot from slightly below, eyes closed in a moment of self-care ritual, serene expression." },
  { id: 9, shotType: "Product Usage", action: "Serum being blended across forehead and nose bridge with ring finger in circular motions.", location: "Well-lit vanity", visualExample: "Tight on the face, the gold shimmer visible on skin as it absorbs, natural and unforced." },
  { id: 10, shotType: "Proof / Results", action: "Camera slowly pushes in on glowing, dewy cheek with serum bottle positioned in foreground.", location: "Natural light setup", visualExample: "The 'money shot' — skin literally glowing, product bottle sharp in foreground, face soft-focused behind." },
  { id: 11, shotType: "Proof / Results", action: "Hand holds bottle next to face, tilting chin to show the radiant skin on jawline and cheek.", location: "Window light", visualExample: "Split composition — product on one side, glowing skin on the other, golden hour warmth." },
  { id: 12, shotType: "Proof / Results", action: "Close-up of skin texture post-application showing dewy, plump surface with bottle in frame edge.", location: "Macro lens setup", visualExample: "Extreme close-up of pores — the serum creating a visible 'glass skin' effect, bottle blurred at edge." },
];

// Mock creative items for detailed views
const MOCK_FOUNDER_ADS = [
  { id: "fa1", title: "Origin Story — Why I Created This", hook: "I spent 3 years and $200K developing a serum that actually works.", script: "Three years ago, I was exactly where you are. Spending hundreds on serums that promised the world and delivered nothing. As a biochemist, I knew the science existed — the industry just wasn't using it right. So I locked myself in a lab with one mission: create the serum I wished existed. 47 formulations later, Golden Radiance Serum was born. Not because the market needed another serum — but because you deserved one that actually works.", status: "approved", image: IMAGES.productSerum },
  { id: "fa2", title: "The Gold Discovery", hook: "The ancient ingredient that modern science finally proved works.", script: "Cleopatra bathed in gold. For centuries, we thought it was vanity. Then in 2012, a groundbreaking study in Nanomedicine proved what she instinctively knew — colloidal gold stimulates collagen production by 89%. Not 8.9%. Eighty-nine percent. When I read that study, I knew I had to put it in a serum. But not just any serum — one that combines gold with the three most proven actives in dermatology. The result? A formula that works on a level most serums can't even reach.", status: "pending", image: IMAGES.brollPresentation },
  { id: "fa3", title: "The $3,000 Mistake", hook: "I spent $3,000 on skincare last year. Here's what I learned.", script: "Last year I tracked every dollar I spent on skincare. The total? $3,247. Twelve different products. Three different routines. And my skin looked... exactly the same. That's when I realized the problem isn't the products — it's the approach. Your skin doesn't need 12 products fighting each other. It needs 5 ingredients working together. That's why Golden Radiance Serum exists. One product. Five actives. Zero compromises.", status: "pending", image: IMAGES.brollUsage },
  { id: "fa4", title: "The Dermatologist's Confession", hook: "My dermatologist told me something that changed everything.", script: "My dermatologist looked at my 7-step routine and said: 'You're doing too much. Your skin barrier is destroyed.' She explained that most anti-aging products actually accelerate aging by compromising the barrier. Then she said something I'll never forget: 'If I could put my patients on one product, it would have Vitamin C, peptides, and something anti-inflammatory.' That conversation became the blueprint for Golden Radiance Serum.", status: "approved", image: IMAGES.productShampoo },
  { id: "fa5", title: "Why Gold Changes Everything", hook: "24K gold in skincare sounds gimmicky. Until you see the science.", script: "I know what you're thinking. Gold in skincare? Sounds like a marketing gimmick. I thought the same thing — until I saw the clinical data. Colloidal gold nanoparticles don't just sit on your skin looking pretty. They penetrate the dermis, reduce inflammation at the cellular level, and stimulate your fibroblasts to produce more collagen. The visible radiance? That's a bonus. The real magic is happening beneath the surface.", status: "generating", image: IMAGES.brollUnboxing },
];

const MOCK_MINI_VSLS = [
  { id: "mv1", title: "The 14-Day Challenge", hook: "Give me 14 days. I'll give you the best skin of your life.", script: "HOOK: Give me 14 days. I'll give you the best skin of your life.\n\nPROBLEM: You've tried everything. The $200 serums. The 10-step routines. The trending ingredients. And your skin still looks... tired.\n\nAGITATE: Every morning you look in the mirror hoping something changed. It hasn't. And you're starting to wonder if anything ever will.\n\nSOLUTION: Golden Radiance Serum uses 24K colloidal gold + 3 clinical actives to deliver visible transformation in 14 days.\n\nPROOF: 94% saw measurable improvement. 2,847 five-star reviews. Dermatologist-tested.\n\nCTA: Try it risk-free for 90 days. If you don't see results, full refund. No questions.", status: "approved", image: IMAGES.productSerum },
  { id: "mv2", title: "The Science Breakdown", hook: "Your $180 serum has 1 active ingredient. Ours has 5.", script: "HOOK: Your $180 serum has 1 active ingredient. Ours has 5. Here's why that matters.\n\nPROBLEM: Most premium serums charge luxury prices for a single active ingredient surrounded by fillers.\n\nEDUCATION: Golden Radiance Serum combines: 15% Vitamin C for brightening, Triple-weight Hyaluronic Acid for deep hydration, Niacinamide for barrier repair, Matrixyl 3000 peptides for collagen, and 24K colloidal gold for anti-inflammation.\n\nDIFFERENTIATOR: Each ingredient at its clinically-proven optimal concentration. Not diluted. Not compromised.\n\nCTA: $78 for what used to cost $300+ in separate products. Link in bio.", status: "pending", image: IMAGES.brollPresentation },
  { id: "mv3", title: "Real Women, Real Results", hook: "2,847 women can't be wrong. Here's what they're saying.", script: "HOOK: 2,847 women can't be wrong. Here's what they're saying about Golden Radiance Serum.\n\nTESTIMONIAL 1: 'I saw a difference in 3 days. THREE DAYS.' — Sarah, 34\n\nTESTIMONIAL 2: 'I replaced 5 products with this one serum.' — Michelle, 41\n\nTESTIMONIAL 3: 'My husband asked if I got Botox. I didn't.' — Jennifer, 38\n\nPROOF: 4.7 stars. 68% five-star reviews. 94% clinical improvement rate.\n\nCTA: Join 2,847 women who found their holy grail serum. 90-day money-back guarantee.", status: "pending", image: IMAGES.brollUsage },
];

const MOCK_SHORT_VIDEO_ADS = [
  { id: "sv1", title: "The Gold Drop", message: "One drop of liquid gold. That's all it takes.", description: "Extreme close-up of golden serum dropping from dropper, slow motion, landing on fingertip. Cut to application on face. Cut to glowing skin result. Product shot with price.", duration: "15s", status: "approved", image: IMAGES.brollPresentation },
  { id: "sv2", title: "The Morning Ritual", message: "The 60-second morning ritual that replaced my entire skincare shelf.", description: "POV morning routine: alarm, bathroom, one product application, mirror check showing glowing skin. Minimal, aesthetic, aspirational.", duration: "30s", status: "pending", image: IMAGES.brollUsage },
  { id: "sv3", title: "The Comparison", message: "SkinCeuticals quality at less than half the price.", description: "Split screen: left shows $182 competitor, right shows Golden Radiance at $78. Ingredient comparison overlay. Same results, different price. Product shot.", duration: "15s", status: "approved", image: IMAGES.productSerum },
  { id: "sv4", title: "The Transformation", message: "Day 1: skeptical. Day 7: obsessed. Day 30: unrecognizable.", description: "Time-lapse style progression. Day 1 application with skeptical expression. Day 7 surprised look in mirror. Day 30 confident, glowing. Product hero shot.", duration: "30s", status: "pending", image: IMAGES.brollUnboxing },
  { id: "sv5", title: "The Ingredient Truth", message: "5 ingredients. Zero fillers. That's it.", description: "Clean white background. Each ingredient appears one by one with its benefit. Counter shows '5/5 clinically proven.' Competitor label flashes with 30+ ingredients. Product shot.", duration: "15s", status: "generating", image: IMAGES.productShampoo },
];

const MOCK_STATIC_ADS_CREATIVES = [
  { id: "sa1", title: "Hero Product — Gold Glow", angle: "Luxury & Premium", awarenessStage: "Cold", message: "24K Gold meets skincare science", status: "approved", image: IMAGES.productSerum },
  { id: "sa2", title: "Before/After Split", angle: "Transformation", awarenessStage: "Warm", message: "Day 1 vs Day 14 — see the difference", status: "approved", image: IMAGES.brollUsage },
  { id: "sa3", title: "Ingredient Breakdown", angle: "Science-Backed", awarenessStage: "Cold", message: "5 ingredients. 0 fillers. 94% saw results.", status: "pending", image: IMAGES.brollPresentation },
  { id: "sa4", title: "Price Comparison", angle: "Competitor Comparison", awarenessStage: "Warm", message: "$78 vs $182 — same ingredients, different price", status: "approved", image: IMAGES.productShampoo },
  { id: "sa5", title: "Testimonial Card", angle: "Social Proof", awarenessStage: "Hot", message: "\"The only serum that actually changed my skin\" — Sarah, 34", status: "pending", image: IMAGES.brollUnboxing },
  { id: "sa6", title: "Routine Simplifier", angle: "Problem-Solution", awarenessStage: "Cold", message: "Replace 5 products with 1 golden serum", status: "approved", image: IMAGES.brollPresentation },
  { id: "sa7", title: "Clinical Proof", angle: "Science-Backed", awarenessStage: "Warm", message: "Clinically proven: 47% wrinkle reduction in 28 days", status: "generating", image: IMAGES.productSerum },
  { id: "sa8", title: "Clean Beauty Badge", angle: "Ingredient Transparency", awarenessStage: "Cold", message: "No parabens. No sulfates. No BS. Just results.", status: "approved", image: IMAGES.brollUsage },
];

const MOCK_UGC_SCRIPTS = [
  { id: "ug1", title: "The Skeptic Convert", hook: "I was SO skeptical about gold in skincare...", format: "Talking Head + Product Demo", script: "HOOK: I was SO skeptical about gold in skincare. Like, that sounds like the most gimmicky thing ever, right?\n\nBODY: But then my friend — who's literally a dermatologist — told me that colloidal gold actually has clinical studies behind it. So I tried Golden Radiance Serum for two weeks.\n\nRESULT: And honestly? I'm eating my words. Look at my skin right now. [shows face] This glow is not a filter. This is day 12.\n\nCTA: Link is in bio. They have a 90-day guarantee so literally zero risk.", status: "approved" },
  { id: "ug2", title: "The GRWM", hook: "My entire morning routine is now 60 seconds.", format: "Get Ready With Me", script: "HOOK: My entire morning routine is now 60 seconds. Let me show you.\n\nBODY: [applies serum] This is Golden Radiance Serum. It's got Vitamin C, hyaluronic acid, niacinamide, peptides, AND 24K gold. So I literally don't need a separate brightening serum, hydrating serum, or anti-aging treatment.\n\nRESULT: [shows finished face] One product. 60 seconds. And I'm out the door looking like THIS.\n\nCTA: I'll put the link below. Trust me on this one.", status: "pending" },
  { id: "ug3", title: "The Price Breakdown", hook: "I did the math on my old skincare routine...", format: "Talking Head + Screen Recording", script: "HOOK: I did the math on my old skincare routine and I almost cried.\n\nBODY: Vitamin C serum: $80. Hyaluronic acid: $45. Niacinamide serum: $35. Anti-aging peptide cream: $90. That's $250 for four products. Golden Radiance Serum has ALL of those ingredients for $78. ONE product.\n\nRESULT: I've been using it for a month and my skin has never looked better. And I'm saving $172 every month.\n\nCTA: Do yourself a favor and check it out. Link below.", status: "approved" },
  { id: "ug4", title: "The Ingredient Reader", hook: "Let's read the ingredient list of your favorite serum...", format: "Talking Head + Product Comparison", script: "HOOK: Let's read the ingredient list of your favorite serum vs Golden Radiance Serum.\n\nBODY: [holds up competitor] This one has 37 ingredients. Half of them I can't pronounce. [holds up Golden Radiance] This one has 5 active ingredients. That's it. Vitamin C, hyaluronic acid, niacinamide, peptides, and 24K gold. All at their clinically-proven concentrations.\n\nRESULT: Less ingredients doesn't mean less effective. It means every single ingredient is there for a reason.\n\nCTA: Link in bio if you want skincare that's honest about what's inside.", status: "pending" },
  { id: "ug5", title: "The Compliment Magnet", hook: "Three people asked me what I'm doing differently today.", format: "Vlog Style", script: "HOOK: Three people asked me what I'm doing differently today. THREE.\n\nBODY: All I changed was my serum. I switched to Golden Radiance Serum two weeks ago because I saw the clinical studies on 24K gold for skin. I wasn't expecting much honestly.\n\nRESULT: But the glow is REAL. Like, I'm not wearing foundation right now. [points to face] This is just serum and sunscreen. That's it.\n\nCTA: I'm literally never going back. Link is in my bio.", status: "approved" },
];

// Mock listicle data
const MOCK_LISTICLE_POINTS = [
  { id: 1, headline: "Clinically Proven 24K Gold Formula", body: "Unlike cheap gold-flake products, our serum uses nano-sized 24K gold particles that actually penetrate the skin barrier to stimulate collagen production by 89% — backed by a peer-reviewed study in Nanomedicine.", image: IMAGES.productSerum, approved: true },
  { id: 2, headline: "3-Layer Hydration Technology", body: "Three molecular weights of hyaluronic acid work at different skin depths, delivering hydration that lasts 72 hours — not just 72 minutes like single-weight formulas.", image: IMAGES.brollUsage, approved: true },
  { id: 3, headline: "Visible Results in 14 Days", body: "In independent clinical trials, 94% of participants saw measurable improvement in skin firmness and brightness within just two weeks. Not months. Weeks.", image: IMAGES.brollPresentation, approved: false },
  { id: 4, headline: "Replaces 5 Products in Your Routine", body: "Serum, moisturizer, brightener, anti-aging treatment, and primer — all in one luxurious formula. Simplify your routine and save $172/month.", image: IMAGES.productShampoo, approved: true },
  { id: 5, headline: "Clean Ingredients You Can Trust", body: "No parabens, no sulfates, no synthetic fragrances. Just 5 active ingredients at their optimal concentrations, ethically sourced and cruelty-free.", image: IMAGES.brollUnboxing, approved: true },
  { id: 6, headline: "The Texture That Changed Everything", body: "Lightweight, non-greasy, absorbs in seconds. The golden liquid glides on like silk and leaves zero residue — perfect under makeup or on its own.", image: IMAGES.brollUsage, approved: false },
  { id: 7, headline: "Dermatologist-Developed Formula", body: "Created in collaboration with board-certified dermatologists who specialize in anti-aging. Every ingredient is backed by peer-reviewed research.", image: IMAGES.productSerum, approved: true },
  { id: 8, headline: "Works on All Skin Types", body: "Whether you have oily, dry, combination, or sensitive skin, our pH-balanced formula adapts to your skin's unique needs without causing irritation.", image: IMAGES.brollPresentation, approved: true },
  { id: 9, headline: "The Morning Ritual You'll Actually Enjoy", body: "Turn your skincare routine from a chore into the best 60 seconds of your morning. The subtle golden shimmer and spa-like experience make every application a moment of luxury.", image: IMAGES.brollUsage, approved: false },
  { id: 10, headline: "90-Day Money-Back Guarantee", body: "We're so confident you'll see results that we offer a full 90-day money-back guarantee. Try it risk-free and see the transformation for yourself.", image: IMAGES.productSerum, approved: true },
  { id: 11, headline: "Join 50,000+ Women Who Made the Switch", body: "From first-time serum users to skincare veterans, thousands of women have replaced their entire anti-aging routine with Golden Radiance Serum.", image: IMAGES.brollPresentation, approved: true },
];

// ============================================================
// DFY ANGLES (reuse from before with enhanced data)
// ============================================================

const MOCK_DFY_ANGLES = [
  {
    id: "a1", name: "Visible Transformation", selected: true,
    description: "Focus on the dramatic, visible before/after transformation that users experience",
    primaryAudience: "Women 30-45 who have tried multiple products without seeing results. Mid-to-high income, active on Instagram and skincare forums. They're frustrated, skeptical, but still hopeful.",
    secondaryAudience: "Women 25-30 entering the anti-aging market for the first time, looking for a 'hero product' to build their routine around.",
    rootCause: "Oxidative stress accumulation and collagen degradation cycle create visible aging that surface-level products cannot address. Most serums treat symptoms (dullness, lines) without targeting the underlying cellular damage.",
    emotionalPain: "The disconnect between how they feel inside (energetic, youthful) and how their skin looks (tired, aged). The daily disappointment of looking in the mirror and not recognizing themselves.",
    failedSolutions: "High-concentration retinol (caused irritation and peeling), expensive single-active serums (delivered marginal results), multi-step routines (overwhelming and unsustainable), professional treatments (temporary and costly).",
    productSolution: "Golden Radiance Serum addresses transformation at the cellular level through 24K colloidal gold (anti-inflammatory, collagen stimulation) combined with 15% Vitamin C (brightening) and Matrixyl 3000 (wrinkle reduction). Visible results in 14 days because it targets root causes, not just symptoms.",
    messages: [
      "Your skin is aging faster than you think — here's the 30-second fix",
      "She looked 10 years younger in 14 days. Her secret? Not Botox.",
      "The #1 reason your expensive serum isn't working",
      "I tried 47 serums. This is the only one that actually changed my skin.",
      "Warning: Your mirror might not recognize you after 2 weeks",
      "The gold-infused serum that's replacing $300 facials",
      "Why your skin looks tired no matter how much you sleep",
      "Dermatologists are shocked by what this serum does in 14 days",
      "The anti-aging ingredient Big Skincare doesn't want you to know about",
      "Stop wasting money on serums that don't work. Try this instead.",
    ],
    copy: "Your skin deserves more than empty promises. Golden Radiance Serum combines 24K gold particles with clinical-grade actives to deliver the transformation you've been searching for. In just 14 days, see visibly firmer, brighter, more youthful skin — or your money back. This isn't another serum. This is the last serum you'll ever need.",
    resonanceStatements: [
      "\"I've literally tried everything. Every serum, every cream, every treatment my dermatologist suggested. My skin still looks like I haven't slept in a year. I'm 34 and people think I'm 45. It's not just vanity — it's affecting my confidence at work and in my relationships.\"",
      "\"I spent $3,200 on skincare last year. I tracked every purchase. And you know what changed? Nothing. My fine lines are deeper, my skin is duller, and I'm starting to think the entire industry is a scam designed to keep us buying.\"",
      "\"The worst part isn't the wrinkles. It's looking in the mirror and not recognizing yourself. I feel 30 inside but my face says 45. When did that happen?\"",
    ],
  },
  {
    id: "a2", name: "Luxury Self-Care Ritual", selected: true,
    description: "Position the product as the centerpiece of a premium self-care routine",
    primaryAudience: "Women 28-42 who view skincare as self-care, not just maintenance. They value the experience as much as the results. Active on TikTok and Pinterest.",
    secondaryAudience: "Gift buyers looking for premium, Instagram-worthy skincare gifts for partners, mothers, or friends.",
    rootCause: "Modern life has stripped the joy from self-care routines. Multi-step regimens feel like chores rather than rituals, leading to inconsistent use and poor results.",
    emotionalPain: "The guilt of not 'taking care of themselves' combined with the overwhelm of complex routines. They want to feel pampered but don't have time for 10 steps.",
    failedSolutions: "10-step Korean skincare routines (unsustainable), spa treatments (expensive and time-consuming), basic drugstore products (no luxury experience), subscription boxes (clutter without curation).",
    productSolution: "One product that transforms a 60-second application into a spa-like ritual. The gold color, glass packaging, and silky texture create a sensory experience that makes daily skincare feel like an indulgence, not a task.",
    messages: [
      "The 60-second morning ritual that replaced my entire skincare shelf",
      "Why successful women are switching to gold-infused skincare",
      "Turn your bathroom into a spa with one product",
      "The self-care secret that A-list celebrities swear by",
      "You deserve a skincare routine that feels as good as it works",
      "Luxury skincare without the luxury price tag — finally",
      "The golden hour isn't just for photos anymore",
      "One pump. 60 seconds. The glow that lasts all day.",
      "Stop surviving your skincare routine. Start enjoying it.",
      "The serum that makes your morning routine feel like a spa day",
    ],
    copy: "Transform your daily routine into a luxurious ritual. Each drop of Golden Radiance Serum glides on like liquid silk, infusing your skin with 24K gold and potent actives. Because your skincare should be the best part of your morning, not a chore.",
    resonanceStatements: [
      "\"I have a 7-step routine that takes 20 minutes and I dread it every morning. I skip it more than I do it, which defeats the purpose entirely.\"",
      "\"I want something that feels special. Not clinical. Not boring. Something that makes me feel like I'm treating myself every single day.\"",
    ],
  },
  {
    id: "a3", name: "Science-Backed Results", selected: true,
    description: "Lead with clinical data, ingredient science, and dermatologist endorsements",
    primaryAudience: "Women 30-50 who research ingredients before purchasing. They read INCI lists, follow dermatologists on social media, and trust data over marketing.",
    secondaryAudience: "Healthcare professionals and estheticians looking for evidence-based products to recommend to clients.",
    rootCause: "The skincare industry's reliance on marketing claims over clinical evidence has created a trust deficit. Consumers are increasingly skeptical of 'miracle' claims without data.",
    emotionalPain: "Frustration with being misled by marketing. They feel disrespected by brands that make claims without evidence. They want to make informed decisions.",
    failedSolutions: "Products with impressive marketing but no clinical backing, 'natural' products that lack efficacy data, prescription treatments with harsh side effects.",
    productSolution: "Every ingredient at its clinically-proven optimal concentration. Independent clinical trials showing 94% improvement rate. Transparent formulation with published data for each active ingredient.",
    messages: [
      "The clinical study that's changing everything we know about anti-aging",
      "3 ingredients. 14 days. Results you can measure.",
      "Why dermatologists are recommending gold for your skin",
      "The science behind the glow: How 24K gold actually repairs your skin",
      "Clinically proven to reduce fine lines by 47% in 28 days",
      "Your dermatologist's secret weapon costs less than you'd expect",
      "The ingredient combination that outperformed retinol alone by 3x",
      "Lab-tested. Dermatologist-approved. Instagram-worthy results.",
      "The peer-reviewed ingredient that Big Skincare has been ignoring",
      "Finally: A serum backed by science, not just marketing",
    ],
    copy: "Don't take our word for it — take science's. Golden Radiance Serum is formulated with three clinically-proven actives at their optimal concentrations. In independent clinical trials, 94% of participants saw measurable improvement in skin firmness, brightness, and fine line reduction within 28 days.",
    resonanceStatements: [
      "\"Every brand says 'clinically proven' but none of them actually show the studies. I want to see the data, not the marketing.\"",
      "\"My dermatologist told me most serums don't have enough active ingredient to actually do anything. They're basically expensive water.\"",
    ],
  },
  {
    id: "a4", name: "Ingredient Transparency", selected: true,
    description: "Appeal to ingredient-conscious consumers who want to know exactly what they're putting on their skin",
    primaryAudience: "Women 25-40 in the clean beauty movement. They read labels, avoid certain ingredients, and prefer brands that are transparent about formulation.",
    secondaryAudience: "Parents and health-conscious individuals concerned about long-term effects of synthetic ingredients.",
    rootCause: "Decades of hidden harmful ingredients in cosmetics have created justified consumer anxiety. The average skincare product contains 15-30 ingredients, many with questionable safety profiles.",
    emotionalPain: "Anxiety about what they're putting on their skin. The overwhelming feeling of trying to decode ingredient lists. The betrayal of discovering harmful ingredients in 'trusted' products.",
    failedSolutions: "Clean beauty brands that sacrifice efficacy for ingredient purity, DIY skincare (inconsistent and potentially dangerous), 'free-from' marketing that's more about exclusion than inclusion.",
    productSolution: "5 active ingredients. Zero fillers. Each one pronounceable, researched, and at its optimal concentration. Full transparency about sourcing, concentration, and clinical evidence.",
    messages: [
      "Read the label. We dare you.",
      "5 ingredients. Zero fillers. That's it.",
      "The serum with nothing to hide",
      "If you can't pronounce it, it shouldn't be on your face",
      "We spent 2 years perfecting 5 ingredients so you don't need 15 products",
      "Clean beauty that actually works (yes, both are possible)",
      "The ingredient list shorter than your grocery receipt",
      "No parabens. No sulfates. No BS. Just results.",
      "What's in your serum? (Spoiler: probably stuff you don't want)",
      "Transparency isn't our marketing strategy. It's our only strategy.",
    ],
    copy: "In a world of 30-ingredient serums with unpronounceable names, we chose a different path. Golden Radiance Serum contains exactly 5 active ingredients — each one clinically proven, ethically sourced, and at its optimal concentration. No fillers. No fragrance. No compromises.",
    resonanceStatements: [
      "\"I flipped over my 'clean' moisturizer and found 28 ingredients. Half of them were preservatives and fillers. How is that clean?\"",
      "\"I just want to know what I'm putting on my face. Is that too much to ask?\"",
    ],
  },
  {
    id: "a5", name: "Problem-Solution (Tired Skin)", selected: true,
    description: "Directly address the pain point of tired, dull-looking skin despite adequate sleep and care",
    primaryAudience: "Women 28-45 who take care of themselves but still look tired. Busy professionals, new mothers, and anyone whose skin doesn't reflect their energy level.",
    secondaryAudience: "Men 30-45 entering skincare for the first time, motivated by looking 'refreshed' rather than 'anti-aging.'",
    rootCause: "Hydration-radiance disconnect combined with chronic low-grade inflammation. Surface hydration creates temporary plumping but doesn't address the deep dermal dehydration and inflammation that cause persistent dullness.",
    emotionalPain: "The exhausting experience of being asked 'are you tired?' when you're not. The frustration of doing everything 'right' (sleep, water, diet) and still looking exhausted.",
    failedSolutions: "Caffeine eye creams (temporary, surface-level), heavy moisturizers (clog pores, don't address root cause), illuminating primers (mask the problem), energy supplements (don't affect skin appearance).",
    productSolution: "Triple-weight hyaluronic acid for deep multi-layer hydration + 24K gold anti-inflammatory action + Vitamin C brightening = addresses the actual biological reasons skin looks tired, not just the surface symptoms.",
    messages: [
      "You're not tired. Your skin is. Here's the fix.",
      "8 hours of sleep won't fix this. But 30 seconds will.",
      "The real reason you look exhausted (even when you're not)",
      "Dark circles? Dull skin? It's not your sleep schedule.",
      "Your skin is screaming for help. Are you listening?",
      "The exhaustion cure that doesn't require more sleep",
      "Why your face tells a different story than how you feel",
      "Tired of looking tired? There's a 30-second solution.",
      "The morning-after glow without the 10-step routine",
      "Wake up your skin (even when your alarm can't wake up you)",
    ],
    copy: "You eat well. You sleep well. You exercise. So why does your skin still look exhausted? The answer isn't another lifestyle change — it's cellular. Golden Radiance Serum works at the cellular level to restore your skin's natural radiance, so your face finally matches how you feel inside.",
    resonanceStatements: [
      "\"I sleep 8 hours, drink 2 liters of water, eat clean, and exercise 4x a week. My skin STILL looks like I pulled an all-nighter. What am I doing wrong?\"",
      "\"Every single day someone asks if I'm tired or sick. I'm neither. My skin just hates me.\"",
    ],
  },
];

// ============================================================
// COMPONENT
// ============================================================

export default function DFYWorkflowPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Research
  const [researchApproved, setResearchApproved] = useState(false);
  const [researchTab, setResearchTab] = useState<"overview" | "ingredients" | "competitive" | "rootcause" | "language" | "reviews" | "broll">("overview");

  // Angles
  const [angles, setAngles] = useState(MOCK_DFY_ANGLES);
  const [anglesApproved, setAnglesApproved] = useState(false);
  const [expandedAngle, setExpandedAngle] = useState<string | null>("a1");
  const [angleTab, setAngleTab] = useState<"messages" | "copy" | "audience" | "resonance" | "analysis">("messages");

  // Message Testing (embedded flow)
  const [mtStep, setMtStep] = useState<"templates" | "review" | "done">("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [mtAdsGenerated, setMtAdsGenerated] = useState(false);
  const [mtApprovals, setMtApprovals] = useState<Record<string, boolean>>({});
  const [messageTestingDone, setMessageTestingDone] = useState(false);

  // Creatives
  const [creativesGenerated, setCreativesGenerated] = useState(false);
  const [creativeApprovals, setCreativeApprovals] = useState<Record<string, boolean>>({});
  const [activeCreativeDetail, setActiveCreativeDetail] = useState<string | null>(null);
  const [creativeItemApprovals, setCreativeItemApprovals] = useState<Record<string, boolean>>({});

  // Listicle
  const [listiclePoints, setListiclePoints] = useState(MOCK_LISTICLE_POINTS);

  // Chat
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; content: string }>>([]);
  const [showChat, setShowChat] = useState(false);
  const [chatContext, setChatContext] = useState("");

  const product = MOCK_PRODUCTS.find(p => p.id === selectedProduct);

  const handleStartWorkflow = () => {
    if (!selectedProduct) return;
    setIsProcessing(true);
    setTimeout(() => { setIsProcessing(false); setCurrentStep(1); }, 1500);
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev, { role: "user", content: chatInput }]);
    const reply = `Understood. I'll adjust the ${chatContext} based on your feedback. Changes applied.`;
    setTimeout(() => { setChatMessages(prev => [...prev, { role: "ai", content: reply }]); }, 800);
    setChatInput("");
  };

  const openChat = (context: string) => {
    setChatContext(context);
    setShowChat(true);
    setChatMessages([]);
  };

  const toggleAngle = (id: string) => {
    setAngles(prev => prev.map(a => a.id === id ? { ...a, selected: !a.selected } : a));
  };

  // ============================================================
  // STEP 0: PRODUCT SELECT
  // ============================================================

  const renderProductSelect = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00D4FF20, #00D4FF05)" }}>
          <Zap size={28} className="text-cyan-400" />
        </div>
        <h2 className="text-2xl font-semibold text-white mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Done For You Workflow</h2>
        <p className="text-white/40 text-sm max-w-md mx-auto">Select a product and hit Go. The system runs the full DFY playbook automatically.</p>
      </div>

      <div className="rounded-xl border border-white/[0.06] p-6" style={{ background: "#13161B" }}>
        <label className="block text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Select Product</label>
        <div className="space-y-2 mb-6">
          {MOCK_PRODUCTS.filter(p => p.researchStatus !== "pending").map((p) => (
            <button key={p.id} onClick={() => setSelectedProduct(p.id)} className={`w-full flex items-center gap-4 p-3 rounded-lg border transition-all ${selectedProduct === p.id ? "border-cyan-500/40 bg-cyan-500/5" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"}`}>
              <img src={p.productImage} alt={p.name} className="w-12 h-12 rounded-lg object-cover" />
              <div className="text-left flex-1">
                <div className={`text-sm font-medium ${selectedProduct === p.id ? "text-cyan-400" : "text-white/70"}`}>{p.name}</div>
                <div className="text-[11px] text-white/30">{p.category}</div>
              </div>
              {selectedProduct === p.id && <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center"><Check size={12} className="text-[#0D0F12]" /></div>}
            </button>
          ))}
        </div>
        <button onClick={handleStartWorkflow} disabled={!selectedProduct || isProcessing} className="w-full py-3 rounded-lg font-mono text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2" style={{ background: selectedProduct ? "linear-gradient(135deg, #00D4FF, #0099CC)" : undefined, color: selectedProduct ? "#0D0F12" : undefined }}>
          {isProcessing ? <><RefreshCw size={14} className="animate-spin" /> Starting workflow...</> : <><Play size={14} /> GO — Start Full DFY Workflow</>}
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-white/[0.04] p-5" style={{ background: "#0F1115" }}>
        <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest mb-4">Workflow Pipeline</div>
        <div className="space-y-2">
          {DFY_STEPS.slice(1).map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="flex items-center gap-3 text-white/20">
                <div className="w-6 h-6 rounded-md border border-white/[0.06] flex items-center justify-center text-[10px] font-mono">{i + 1}</div>
                <Icon size={14} />
                <span className="text-xs">{step.label}</span>
                <span className="text-[10px] text-white/10 ml-auto">{step.description}</span>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );

  // ============================================================
  // STEP 1: RESEARCH (with tabs and B-Roll shot list)
  // ============================================================

  const RESEARCH_TABS = [
    { key: "overview", label: "Overview", icon: BookOpen },
    { key: "ingredients", label: "Ingredients", icon: Beaker },
    { key: "competitive", label: "Competitive", icon: Shield },
    { key: "rootcause", label: "Root Causes", icon: Brain },
    { key: "language", label: "Customer Language", icon: Users },
    { key: "reviews", label: "Review Analysis", icon: Heart },
    { key: "broll", label: "B-Roll Shot List", icon: Camera },
  ] as const;

  const renderResearch = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Product Research</h2>
          <p className="text-xs text-white/30 mt-1">Strategic Diagnosis Report for {product?.name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("research")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5"><MessageSquare size={12} /> Feedback</button>
          <button onClick={() => setResearchApproved(true)} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: researchApproved ? "#10B981" : "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            {researchApproved ? <><Check size={12} /> Approved</> : <><ThumbsUp size={12} /> Approve Research</>}
          </button>
        </div>
      </div>

      {/* Research Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {RESEARCH_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.key} onClick={() => setResearchTab(tab.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap transition-all ${researchTab === tab.key ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "text-white/30 hover:text-white/50 hover:bg-white/[0.03] border border-transparent"}`}>
              <Icon size={11} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {researchTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Product Context */}
            <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Product Context & Framework</h3>
              <div className="space-y-3">
                <div><span className="text-[9px] font-mono text-white/20 uppercase block mb-1">Description</span><p className="text-sm text-white/60 leading-relaxed">{DETAILED_RESEARCH.productContext.description}</p></div>
                <div><span className="text-[9px] font-mono text-white/20 uppercase block mb-1">Primary Purpose</span><p className="text-sm text-white/60 leading-relaxed">{DETAILED_RESEARCH.productContext.primaryPurpose}</p></div>
                <div className="flex items-center gap-2"><span className="text-[9px] font-mono text-white/20 uppercase">Framework:</span><span className="text-xs text-cyan-400/70 font-mono">{DETAILED_RESEARCH.productContext.frameworkAssignment}</span></div>
              </div>
            </div>

            {/* Product Input */}
            <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Product Input — Extracted Data</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { label: "Product", value: DETAILED_RESEARCH.productInput.productName },
                  { label: "Price", value: DETAILED_RESEARCH.productInput.price },
                  { label: "Format", value: DETAILED_RESEARCH.productInput.format },
                  { label: "Serving Size", value: DETAILED_RESEARCH.productInput.servingSize },
                  { label: "Rating", value: `${DETAILED_RESEARCH.productInput.rating.stars} ★ (${DETAILED_RESEARCH.productInput.rating.reviews} reviews)` },
                  { label: "Source", value: DETAILED_RESEARCH.productInput.sourceUrl },
                ].map((item, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                    <div className="text-[9px] font-mono text-white/20 uppercase mb-1">{item.label}</div>
                    <div className="text-xs text-white/60 break-all">{item.value}</div>
                  </div>
                ))}
              </div>
              {/* Rating Breakdown */}
              <div className="mt-3 rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                <div className="text-[9px] font-mono text-white/20 uppercase mb-2">Rating Breakdown</div>
                <div className="space-y-1">
                  {Object.entries(DETAILED_RESEARCH.productInput.rating.breakdown).reverse().map(([stars, pct]) => (
                    <div key={stars} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/30 w-8">{stars === "five" ? "5★" : stars === "four" ? "4★" : stars === "three" ? "3★" : stars === "two" ? "2★" : "1★"}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/[0.04]"><div className="h-full rounded-full bg-amber-400/60" style={{ width: `${pct}%` }} /></div>
                      <span className="text-[10px] font-mono text-white/20 w-8 text-right">{pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Ingredient List */}
            <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Full Ingredient List</h3>
              <div className="space-y-2">
                {DETAILED_RESEARCH.productInput.ingredients.map((ing, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                    <span className="text-[10px] font-mono text-cyan-400/40 mt-0.5">{i + 1}.</span>
                    <div>
                      <div className="text-xs font-medium text-white/60">{ing.name}</div>
                      <div className="text-[11px] text-white/30 italic">{ing.mechanism}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {researchTab === "ingredients" && (
          <motion.div key="ingredients" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="text-xs text-white/30 mb-2">Deep Ingredient & Functional Mechanism Analysis</div>
            {DETAILED_RESEARCH.ingredientAnalysis.map((ing, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-white/70">{ing.name}</h3>
                    <div className="text-[10px] font-mono text-cyan-400/60">Active: {ing.activeCompound}</div>
                  </div>
                  <button onClick={() => openChat(`ingredient analysis: ${ing.name}`)} className="text-white/15 hover:text-white/40"><Edit3 size={12} /></button>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{ing.analysis}</p>
              </div>
            ))}
          </motion.div>
        )}

        {researchTab === "competitive" && (
          <motion.div key="competitive" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="text-xs text-white/30 mb-2">Competitive Ingredient Mapping — Traditional Solution Failures</div>
            {DETAILED_RESEARCH.competitiveMapping.map((comp, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-white/70">{comp.category}</h3>
                  <button onClick={() => openChat(`competitive analysis: ${comp.category}`)} className="text-white/15 hover:text-white/40"><Edit3 size={12} /></button>
                </div>
                <div className="text-[10px] font-mono text-white/20 mb-2">Examples: {comp.examples}</div>
                <div className="space-y-2">
                  <div><span className="text-[9px] font-mono text-red-400/60 uppercase block mb-1">Why They Fail</span><p className="text-xs text-white/40 leading-relaxed">{comp.failures}</p></div>
                  <div><span className="text-[9px] font-mono text-green-400/60 uppercase block mb-1">Our Opportunity</span><p className="text-xs text-white/40 leading-relaxed">{comp.opportunity}</p></div>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {researchTab === "rootcause" && (
          <motion.div key="rootcause" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="text-xs text-white/30 mb-2">Root Cause Mapping — Biological Dysfunctions</div>
            {DETAILED_RESEARCH.rootCauseMapping.map((rc, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold" style={{ background: "#00D4FF10", color: "#00D4FF" }}>{i + 1}</div>
                  <h3 className="text-sm font-medium text-white/70">{rc.name}</h3>
                  <button onClick={() => openChat(`root cause: ${rc.name}`)} className="ml-auto text-white/15 hover:text-white/40"><Edit3 size={12} /></button>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{rc.description}</p>
              </div>
            ))}
          </motion.div>
        )}

        {researchTab === "language" && (
          <motion.div key="language" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="text-xs text-white/30 mb-2">Real-World Dysfunction Language Research</div>
            {DETAILED_RESEARCH.realWorldLanguage.map((cat, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
                <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">{cat.category}</h3>
                <div className="space-y-2">
                  {cat.quotes.map((q, j) => (
                    <div key={j} className="rounded-lg border border-white/[0.04] p-3 text-xs text-white/50 italic leading-relaxed" style={{ background: "#0F1115" }}>{q}</div>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {researchTab === "reviews" && (
          <motion.div key="reviews" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider">Review Analysis — {DETAILED_RESEARCH.reviewAnalysis.totalReviews} Reviews</h3>
              </div>
              <div className="space-y-3">
                {DETAILED_RESEARCH.reviewAnalysis.themes.map((theme, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white/60">{theme.name}</span>
                      <span className="text-xs font-mono text-cyan-400">{theme.percentage}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.04] mb-2"><div className="h-full rounded-full bg-cyan-400/40" style={{ width: `${theme.percentage}%` }} /></div>
                    <p className="text-[11px] text-white/35 leading-relaxed">{theme.description}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-amber-500/20 p-3" style={{ background: "#F59E0B08" }}>
                <div className="text-[9px] font-mono text-amber-400/60 uppercase mb-1">Key Observation</div>
                <p className="text-xs text-white/50 leading-relaxed">{DETAILED_RESEARCH.reviewAnalysis.keyObservation}</p>
              </div>
            </div>
          </motion.div>
        )}

        {researchTab === "broll" && (
          <motion.div key="broll" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="text-xs text-white/30 mb-2">B-Roll Shot List — {BROLL_SHOT_LIST.length} shots grouped by type</div>
            {["Unboxing", "Product Presentation", "Product Usage", "Proof / Results"].map((type) => {
              const shots = BROLL_SHOT_LIST.filter(s => s.shotType === type);
              if (shots.length === 0) return null;
              const typeColor = type === "Unboxing" ? "#FFB020" : type === "Product Presentation" ? "#3B82F6" : type === "Product Usage" ? "#8B5CF6" : "#10B981";
              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: typeColor }} />
                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: typeColor }}>{type}</span>
                    <span className="text-[10px] font-mono text-white/15">{shots.length} shots</span>
                  </div>
                  <div className="space-y-2 mb-4">
                    {shots.map((shot) => (
                      <div key={shot.id} className="rounded-lg border border-white/[0.06] p-3" style={{ background: "#13161B" }}>
                        <div className="flex items-start gap-3">
                          <span className="text-[10px] font-mono text-white/15 mt-0.5 w-5 shrink-0">#{shot.id}</span>
                          <div className="flex-1">
                            <p className="text-xs text-white/60 leading-relaxed mb-1.5">{shot.action}</p>
                            <div className="flex flex-wrap gap-2">
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.03] text-white/25 border border-white/[0.04]">📍 {shot.location}</span>
                            </div>
                            <p className="text-[10px] text-white/25 italic mt-1.5">{shot.visualExample}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // ============================================================
  // STEP 2: ANGLES & MESSAGES (enhanced with tabs per angle)
  // ============================================================

  const renderAngles = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Angles & Messages</h2>
          <p className="text-xs text-white/30 mt-1">{angles.filter(a => a.selected).length} angles selected with detailed analysis, messages, and copy.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("angles")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5"><MessageSquare size={12} /> Add Angle</button>
          <button onClick={() => setAnglesApproved(true)} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: anglesApproved ? "#10B981" : "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            {anglesApproved ? <><Check size={12} /> Approved</> : <><ThumbsUp size={12} /> Approve Angles</>}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {angles.map((angle) => (
          <div key={angle.id} className={`rounded-xl border transition-all ${angle.selected ? "border-cyan-500/20 bg-[#13161B]" : "border-white/[0.04] bg-[#0F1115] opacity-50"}`}>
            <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpandedAngle(expandedAngle === angle.id ? null : angle.id)}>
              <button onClick={(e) => { e.stopPropagation(); toggleAngle(angle.id); }} className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all ${angle.selected ? "border-cyan-500 bg-cyan-500" : "border-white/20 bg-transparent"}`}>
                {angle.selected && <Check size={12} className="text-[#0D0F12]" />}
              </button>
              <div className="flex-1">
                <div className="text-sm font-medium text-white/80">{angle.name}</div>
                <div className="text-[11px] text-white/30">{angle.description}</div>
              </div>
              <span className="text-[10px] font-mono text-white/20">{angle.messages.length} messages</span>
              {expandedAngle === angle.id ? <ChevronUp size={14} className="text-white/20" /> : <ChevronDown size={14} className="text-white/20" />}
            </div>

            <AnimatePresence>
              {expandedAngle === angle.id && angle.selected && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-4 border-t border-white/[0.04] pt-3">
                    {/* Sub-tabs for angle details */}
                    <div className="flex gap-1 mb-3">
                      {[
                        { key: "messages", label: "Messages" },
                        { key: "copy", label: "Angle Copy" },
                        { key: "audience", label: "Audience" },
                        { key: "resonance", label: "Resonance" },
                        { key: "analysis", label: "Analysis" },
                      ].map((tab) => (
                        <button key={tab.key} onClick={() => setAngleTab(tab.key as typeof angleTab)} className={`px-2.5 py-1 rounded text-[9px] font-mono transition-all ${angleTab === tab.key ? "bg-cyan-500/10 text-cyan-400" : "text-white/25 hover:text-white/40"}`}>{tab.label}</button>
                      ))}
                    </div>

                    {angleTab === "messages" && (
                      <div className="space-y-1.5">
                        {angle.messages.map((msg, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.04] px-3 py-2" style={{ background: "#0D0F12" }}>
                            <span className="text-[10px] font-mono text-white/15 w-5 shrink-0">{i + 1}.</span>
                            <span className="text-xs text-white/50 flex-1">{msg}</span>
                            <button onClick={() => openChat(`message ${i + 1} of ${angle.name}`)} className="text-white/10 hover:text-white/30"><Edit3 size={10} /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    {angleTab === "copy" && (
                      <div className="rounded-lg border border-white/[0.04] p-3 text-sm text-white/50 leading-relaxed" style={{ background: "#0D0F12" }}>{angle.copy}</div>
                    )}

                    {angleTab === "audience" && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0D0F12" }}>
                          <div className="text-[9px] font-mono text-cyan-400/60 uppercase mb-1">Primary Ideal Audience</div>
                          <p className="text-xs text-white/50 leading-relaxed">{angle.primaryAudience}</p>
                        </div>
                        <div className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0D0F12" }}>
                          <div className="text-[9px] font-mono text-white/20 uppercase mb-1">Secondary Buyer Group</div>
                          <p className="text-xs text-white/50 leading-relaxed">{angle.secondaryAudience}</p>
                        </div>
                      </div>
                    )}

                    {angleTab === "resonance" && (
                      <div className="space-y-2">
                        {angle.resonanceStatements.map((stmt, i) => (
                          <div key={i} className="rounded-lg border border-white/[0.04] p-3 text-xs text-white/45 italic leading-relaxed" style={{ background: "#0D0F12" }}>{stmt}</div>
                        ))}
                      </div>
                    )}

                    {angleTab === "analysis" && (
                      <div className="space-y-3">
                        {[
                          { label: "Root Cause", value: angle.rootCause, color: "#F43F5E" },
                          { label: "Emotional Pain", value: angle.emotionalPain, color: "#F59E0B" },
                          { label: "Failed Solutions", value: angle.failedSolutions, color: "#EF4444" },
                          { label: "Product Solution", value: angle.productSolution, color: "#10B981" },
                        ].map((item, i) => (
                          <div key={i} className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0D0F12" }}>
                            <div className="text-[9px] font-mono uppercase mb-1" style={{ color: `${item.color}99` }}>{item.label}</div>
                            <p className="text-xs text-white/50 leading-relaxed">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </motion.div>
  );

  // ============================================================
  // STEP 3: MESSAGE TESTING (embedded flow with template selection)
  // ============================================================

  const selectedAngles = angles.filter(a => a.selected);
  const mtAds = useMemo(() => {
    if (!mtAdsGenerated) return [];
    const imgs = [IMAGES.productSerum, IMAGES.brollPresentation, IMAGES.brollUsage, IMAGES.brollUnboxing, IMAGES.productShampoo];
    return selectedAngles.flatMap((angle) =>
      angle.messages.map((msg, idx) => ({
        id: `mt-${angle.id}-${idx}`,
        angleId: angle.id,
        angleName: angle.name,
        message: msg,
        image: imgs[(idx + parseInt(angle.id.replace("a", ""))) % imgs.length],
        status: "pending" as const,
      }))
    );
  }, [mtAdsGenerated, selectedAngles]);

  const renderMessageTesting = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Message Testing</h2>
          <p className="text-xs text-white/30 mt-1">
            {mtStep === "templates" ? "Choose a template for your message testing ads" : mtStep === "review" ? `Review ${mtAds.length} generated ads across ${selectedAngles.length} angles` : "Message testing ads approved"}
          </p>
        </div>
      </div>

      {mtStep === "templates" && (
        <div className="space-y-4">
          <div className="text-xs text-white/30 mb-2">Select one template style. The first message from each angle will be used to generate 3 preview variations.</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {MOCK_MESSAGE_TEMPLATES.map((tmpl) => (
              <button key={tmpl.id} onClick={() => setSelectedTemplate(tmpl.id)} className={`rounded-xl border p-4 text-left transition-all ${selectedTemplate === tmpl.id ? "border-cyan-500/40 bg-cyan-500/5" : "border-white/[0.06] bg-[#13161B] hover:bg-[#161920]"}`}>
                <div className="aspect-[4/5] rounded-lg bg-white/[0.03] mb-3 overflow-hidden flex items-center justify-center">
                  <img src={tmpl.previewImage} alt={tmpl.name} className="w-full h-full object-cover opacity-60" />
                </div>
                <div className={`text-sm font-medium mb-1 ${selectedTemplate === tmpl.id ? "text-cyan-400" : "text-white/70"}`}>{tmpl.name}</div>
                <p className="text-[11px] text-white/30 leading-relaxed">{tmpl.description}</p>
                {selectedTemplate === tmpl.id && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-cyan-400"><Check size={10} /> Selected</div>
                )}
              </button>
            ))}
          </div>
          {selectedTemplate && (
            <button onClick={() => { setMtAdsGenerated(true); setMtStep("review"); }} className="w-full py-3 rounded-lg font-mono text-sm font-semibold flex items-center justify-center gap-2 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
              <Sparkles size={14} /> Generate All Message Testing Ads ({selectedAngles.length * 10} ads)
            </button>
          )}
        </div>
      )}

      {mtStep === "review" && (
        <div className="space-y-6">
          {/* Sticky approve bar */}
          <div className="sticky top-0 z-20 rounded-xl border border-white/[0.06] p-3 flex items-center justify-between" style={{ background: "#13161B" }}>
            <div className="text-xs text-white/40 font-mono">{Object.values(mtApprovals).filter(Boolean).length}/{mtAds.length} ads approved</div>
            <div className="flex gap-2">
              <button onClick={() => { const newApprovals: Record<string, boolean> = {}; mtAds.forEach(a => { newApprovals[a.id] = true; }); setMtApprovals(newApprovals); }} className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 transition-all flex items-center gap-1"><ThumbsUp size={10} /> Approve All Angles</button>
              {Object.values(mtApprovals).filter(Boolean).length >= mtAds.length * 0.5 && (
                <button onClick={() => { setMtStep("done"); setMessageTestingDone(true); }} className="px-4 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1 transition-all text-[#0D0F12]" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)" }}><Check size={10} /> Continue to Produce Creatives</button>
              )}
            </div>
          </div>
          {selectedAngles.map((angle) => {
            const angleAds = mtAds.filter(a => a.angleId === angle.id);
            const approvedCount = angleAds.filter(a => mtApprovals[a.id]).length;
            const allApproved = approvedCount === angleAds.length;
            return (
              <div key={angle.id} className="rounded-xl border border-white/[0.06]" style={{ background: "#13161B" }}>
                <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
                  <div>
                    <div className="text-sm font-medium text-white/70">{angle.name}</div>
                    <div className="text-[10px] text-white/25">{approvedCount}/{angleAds.length} approved</div>
                  </div>
                  <button onClick={() => { const newApprovals = { ...mtApprovals }; angleAds.forEach(a => { newApprovals[a.id] = true; }); setMtApprovals(newApprovals); }} className={`px-3 py-1 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1 transition-all ${allApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"}`} style={!allApproved ? { background: "linear-gradient(135deg, #00D4FF, #0099CC)" } : undefined}>
                    {allApproved ? <><Check size={10} /> All Approved</> : <><ThumbsUp size={10} /> Approve All</>}
                  </button>
                </div>
                <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {angleAds.map((ad) => {
                    const isApproved = mtApprovals[ad.id];
                    return (
                      <div key={ad.id} className={`rounded-lg border p-2 transition-all ${isApproved ? "border-green-500/20" : "border-white/[0.04]"}`} style={{ background: "#0F1115" }}>
                        <div className="aspect-[4/5] rounded bg-white/[0.03] mb-2 overflow-hidden relative">
                          <img src={ad.image} alt="" className="w-full h-full object-cover opacity-50" />
                          <div className="absolute inset-0 flex items-center justify-center p-2">
                            <p className="text-[8px] text-white/70 text-center leading-tight font-medium">{ad.message.slice(0, 60)}...</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => openChat(`message testing ad: ${ad.message.slice(0, 30)}`)} className="flex-1 py-1 rounded text-[8px] font-mono border border-white/[0.06] text-white/25 hover:text-white/50 flex items-center justify-center gap-0.5"><Edit3 size={8} /> Edit</button>
                          <button onClick={() => setMtApprovals(prev => ({ ...prev, [ad.id]: !prev[ad.id] }))} className={`flex-1 py-1 rounded text-[8px] font-mono font-semibold flex items-center justify-center gap-0.5 ${isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"}`} style={!isApproved ? { background: "#00D4FF" } : undefined}>
                            {isApproved ? <><Check size={8} /></> : <><ThumbsUp size={8} /></>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        </div>
      )}

      {mtStep === "done" && (
        <div className="rounded-xl border border-green-500/20 p-6 text-center" style={{ background: "#13161B" }}>
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3"><Check size={24} className="text-green-400" /></div>
          <div className="text-lg font-semibold text-green-400 mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Message Testing Ads Approved</div>
          <p className="text-xs text-white/30">{Object.values(mtApprovals).filter(Boolean).length} ads approved across {selectedAngles.length} angles. Ready to produce creatives.</p>
        </div>
      )}
    </motion.div>
  );

  // ============================================================
  // STEP 4: PRODUCE CREATIVES (with detailed review views)
  // ============================================================

  const CREATIVE_TYPES = [
    { id: "founder", label: "Founder Ads", count: 5, description: "Personal story-driven ads", icon: Megaphone, color: "#00D4FF", items: MOCK_FOUNDER_ADS },
    { id: "mini-vsl", label: "Mini VSLs", count: 3, description: "Short video sales letters", icon: Video, color: "#A855F7", items: MOCK_MINI_VSLS },
    { id: "short-video", label: "Short Video Ads", count: 5, description: "15-30s scroll-stopping clips", icon: Play, color: "#F59E0B", items: MOCK_SHORT_VIDEO_ADS },
    { id: "static-ads", label: "Static Ads", count: 8, description: "By awareness stage", icon: ImagePlus, color: "#10B981", items: MOCK_STATIC_ADS_CREATIVES },
    { id: "ugc-scripts", label: "UGC Scripts", count: 5, description: "Authentic creator scripts", icon: Type, color: "#F43F5E", items: MOCK_UGC_SCRIPTS },
  ];

  const renderCreativeDetail = (type: typeof CREATIVE_TYPES[0]) => (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <button onClick={() => setActiveCreativeDetail(null)} className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 mb-4 transition-all"><ArrowLeft size={12} /> Back to all creatives</button>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${type.color}15` }}>
          <type.icon size={18} style={{ color: type.color }} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white/80">{type.label}</h3>
          <div className="text-[10px] text-white/25">{type.items.length} items — review and approve each one</div>
        </div>
        <button onClick={() => { const newApprovals = { ...creativeItemApprovals }; type.items.forEach(item => { newApprovals[item.id] = true; }); setCreativeItemApprovals(newApprovals); }} className="ml-auto px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: `${type.color}`, color: "#0D0F12" }}>
          <ThumbsUp size={10} /> Approve All
        </button>
      </div>

      <div className="space-y-3">
        {type.items.map((item: any, idx: number) => {
          const isApproved = creativeItemApprovals[item.id];
          return (
            <div key={item.id} className={`rounded-xl border p-4 transition-all ${isApproved ? "border-green-500/15" : "border-white/[0.06]"}`} style={{ background: "#13161B" }}>
              <div className="flex gap-4">
                {/* Image preview for visual types */}
                {item.image && (type.id === "founder" || type.id === "short-video" || type.id === "static-ads") && (
                  <div className="w-24 h-24 rounded-lg overflow-hidden shrink-0 bg-white/[0.03]">
                    <img src={item.image} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-white/70">{item.title}</div>
                      {item.hook && <div className="text-[11px] text-cyan-400/60 italic mt-0.5">Hook: "{item.hook}"</div>}
                      {item.message && !item.hook && <div className="text-[11px] text-cyan-400/60 italic mt-0.5">"{item.message}"</div>}
                      {item.format && <div className="text-[10px] font-mono text-white/15 mt-0.5">{item.format}</div>}
                      {item.angle && <div className="text-[10px] font-mono text-white/15 mt-0.5">Angle: {item.angle}</div>}
                      {item.duration && <div className="text-[10px] font-mono text-white/15 mt-0.5">Duration: {item.duration}</div>}
                      {item.awarenessStage && <div className="text-[10px] font-mono text-white/15 mt-0.5">Stage: {item.awarenessStage}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${item.status === "approved" || isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : item.status === "generating" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-white/[0.03] text-white/20 border border-white/[0.04]"}`}>
                        {isApproved ? "APPROVED" : item.status?.toUpperCase() || "PENDING"}
                      </span>
                    </div>
                  </div>

                  {/* Script/Description */}
                  {(item.script || item.description) && (
                    <div className="rounded-lg border border-white/[0.04] p-3 mt-2" style={{ background: "#0D0F12" }}>
                      <pre className="text-[11px] text-white/40 leading-relaxed whitespace-pre-wrap font-sans">{item.script || item.description}</pre>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => openChat(`${type.label}: ${item.title}`)} className="px-2.5 py-1 rounded-lg text-[10px] font-mono border border-white/[0.06] text-white/25 hover:text-white/50 flex items-center gap-1 transition-all"><MessageSquare size={10} /> Feedback</button>
                    <button className="px-2.5 py-1 rounded-lg text-[10px] font-mono border border-white/[0.06] text-white/25 hover:text-white/50 flex items-center gap-1 transition-all"><RotateCcw size={10} /> Regenerate</button>
                    <button onClick={() => setCreativeItemApprovals(prev => ({ ...prev, [item.id]: !prev[item.id] }))} className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1 transition-all ${isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"}`} style={!isApproved ? { background: type.color } : undefined}>
                      {isApproved ? <><Check size={10} /> Approved</> : <><ThumbsUp size={10} /> Approve</>}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary bar */}
      <div className="mt-4 rounded-lg border border-white/[0.06] p-3 flex items-center justify-between" style={{ background: "#0F1115" }}>
        <span className="text-xs text-white/30">{type.items.filter((item: any) => creativeItemApprovals[item.id]).length} / {type.items.length} approved</span>
        {type.items.every((item: any) => creativeItemApprovals[item.id]) && (
          <button onClick={() => { setCreativeApprovals(prev => ({ ...prev, [type.id]: true })); setActiveCreativeDetail(null); }} className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all bg-green-500/10 text-green-400 border border-green-500/20">
            <Check size={10} /> Mark Type as Complete
          </button>
        )}
      </div>
    </motion.div>
  );

  const renderCreatives = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Produce Creatives</h2>
          <p className="text-xs text-white/30 mt-1">Review and approve each creative type in detail.</p>
        </div>
        {!creativesGenerated && (
          <button onClick={() => setCreativesGenerated(true)} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            <Sparkles size={12} /> Generate All Creatives
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {activeCreativeDetail ? (
          renderCreativeDetail(CREATIVE_TYPES.find(t => t.id === activeCreativeDetail)!)
        ) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CREATIVE_TYPES.map((type) => {
                const isApproved = creativeApprovals[type.id];
                return (
                  <div key={type.id} className={`rounded-xl border p-5 transition-all ${isApproved ? "border-green-500/20" : "border-white/[0.06]"}`} style={{ background: "#13161B" }}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${type.color}15` }}>
                        <type.icon size={18} style={{ color: type.color }} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white/70">{type.label}</div>
                        <div className="text-[10px] text-white/30">{type.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-2xl font-bold font-mono" style={{ color: type.color }}>{type.count}</span>
                      <span className="text-[10px] font-mono text-white/20">creatives</span>
                    </div>
                    {creativesGenerated ? (
                      <div className="space-y-2">
                        <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-1000" style={{ width: isApproved ? "100%" : "0%", background: isApproved ? "#10B981" : type.color }} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setActiveCreativeDetail(type.id)} className="flex-1 py-1.5 rounded-lg text-[10px] font-mono border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-all flex items-center justify-center gap-1">
                            <Eye size={10} /> Review All
                          </button>
                          <button onClick={() => setCreativeApprovals(prev => ({ ...prev, [type.id]: !prev[type.id] }))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center justify-center gap-1 transition-all ${isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"}`} style={!isApproved ? { background: type.color } : undefined}>
                            {isApproved ? <><Check size={10} /> Approved</> : <><ThumbsUp size={10} /> Approve</>}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="h-1.5 rounded-full bg-white/[0.04]"><div className="h-full rounded-full bg-white/[0.08] w-0" /></div>
                    )}
                  </div>
                );
              })}
            </div>
            {creativesGenerated && (
              <div className="mt-6 rounded-xl border border-white/[0.06] p-4 flex items-center justify-between" style={{ background: "#13161B" }}>
                <div className="flex items-center gap-3"><ListChecks size={16} className="text-white/30" /><span className="text-xs text-white/40">{Object.values(creativeApprovals).filter(Boolean).length} / {CREATIVE_TYPES.length} creative types approved</span></div>
                <div className="text-xs font-mono text-white/20">Total: {CREATIVE_TYPES.reduce((sum, t) => sum + t.count, 0)} creatives</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // ============================================================
  // STEP 5: LISTICLE
  // ============================================================

  const renderListicle = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Build Listicle</h2>
          <p className="text-xs text-white/30 mt-1">11 reasons why — angle-specific listicle for {angles[0]?.name}.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("listicle")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5"><MessageSquare size={12} /> Feedback</button>
          <button onClick={() => setListiclePoints(prev => prev.map(p => ({ ...p, approved: true })))} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            <ThumbsUp size={12} /> Approve All
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {listiclePoints.map((point, i) => (
          <div key={point.id} className={`rounded-xl border p-4 flex gap-4 transition-all ${point.approved ? "border-green-500/15 bg-[#13161B]" : "border-white/[0.06] bg-[#13161B]"}`}>
            <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-white/[0.03]"><img src={point.image} alt="" className="w-full h-full object-cover" /></div>
            <div className="flex-1">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2"><span className="text-[10px] font-mono text-cyan-400/40">#{i + 1}</span><h4 className="text-sm font-medium text-white/70">{point.headline}</h4></div>
                <div className="flex gap-1.5">
                  <button onClick={() => openChat(`listicle point #${i + 1}`)} className="text-white/15 hover:text-white/40"><Edit3 size={12} /></button>
                  <button onClick={() => setListiclePoints(prev => prev.map(p => p.id === point.id ? { ...p, approved: !p.approved } : p))} className={`w-5 h-5 rounded border flex items-center justify-center ${point.approved ? "border-green-500 bg-green-500" : "border-white/15"}`}>
                    {point.approved && <Check size={10} className="text-[#0D0F12]" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-white/40 leading-relaxed">{point.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-center text-xs text-white/20">{listiclePoints.filter(p => p.approved).length} / {listiclePoints.length} points approved</div>
    </motion.div>
  );

  // ============================================================
  // STEP 6: SPRINT COMPLETE
  // ============================================================

  const renderAnalysis = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10B98120, #10B98105)" }}>
          <BarChart3 size={28} className="text-green-400" />
        </div>
        <h2 className="text-2xl font-semibold text-white mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Sprint Complete</h2>
        <p className="text-sm text-white/40 max-w-lg mx-auto">The Done For You workflow has been completed. Here's what was produced.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Angles", value: `${selectedAngles.length}`, color: "#00D4FF" },
          { label: "Message Testing Ads", value: `${selectedAngles.length * 10}`, color: "#A855F7" },
          { label: "Total Creatives", value: `${CREATIVE_TYPES.reduce((s, t) => s + t.count, 0)}`, color: "#F59E0B" },
          { label: "Listicle Points", value: "11", color: "#10B981" },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] p-4 text-center" style={{ background: "#13161B" }}>
            <div className="text-[10px] font-mono text-white/20 uppercase tracking-wider mb-1">{stat.label}</div>
            <div className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.06] p-5 mb-6" style={{ background: "#13161B" }}>
        <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-4">Deliverables Produced</h3>
        <div className="space-y-2">
          {[
            { item: "Full Strategic Diagnosis Report (Research)", status: "delivered" },
            { item: `${selectedAngles.length} Angles with 10 Messages Each`, status: "delivered" },
            { item: "B-Roll Shot List (12 shots)", status: "delivered" },
            { item: `${selectedAngles.length * 10} Message Testing Ads`, status: "delivered" },
            { item: "5 Founder Ads with scripts", status: "delivered" },
            { item: "3 Mini VSLs with full scripts", status: "delivered" },
            { item: "5 Short Video Ads (15-30s)", status: "delivered" },
            { item: "8 Static Ads (by awareness stage)", status: "delivered" },
            { item: "5 UGC Scripts with hooks", status: "delivered" },
            { item: "11-Point Listicle Page", status: "delivered" },
          ].map((d, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center"><Check size={10} className="text-green-400" /></div>
              <span className="text-xs text-white/50 flex-1">{d.item}</span>
              <span className="text-[9px] font-mono text-green-400/60 uppercase">{d.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] p-5 mb-6" style={{ background: "#13161B" }}>
        <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-4">Recommended Next Steps</h3>
        <div className="space-y-3">
          {[
            { step: "Launch message testing campaign with approved ads", priority: "high" },
            { step: "Monitor performance for 3-5 days to identify winning angle", priority: "high" },
            { step: "Scale winning angle creatives across platforms", priority: "medium" },
            { step: "A/B test listicle vs. original product page", priority: "medium" },
            { step: "Produce additional creatives for second-best angle as backup", priority: "low" },
          ].map((ns, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-white/15 w-5">{i + 1}.</span>
              <span className="text-xs text-white/50 flex-1">{ns.step}</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${ns.priority === "high" ? "text-red-400/60 bg-red-500/5" : ns.priority === "medium" ? "text-amber-400/60 bg-amber-500/5" : "text-white/20 bg-white/[0.02]"}`}>{ns.priority}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 justify-center">
        <button className="px-6 py-2.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
          <Download size={14} /> Export Full Report
        </button>
        <button className="px-6 py-2.5 rounded-lg text-xs font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-2">
          <ArrowRight size={14} /> Start Next Sprint
        </button>
      </div>
    </motion.div>
  );

  // ============================================================
  // MAIN RENDER
  // ============================================================

  const canAdvance = () => {
    switch (currentStep) {
      case 0: return !!selectedProduct;
      case 1: return researchApproved;
      case 2: return anglesApproved;
      case 3: return messageTestingDone;
      case 4: return Object.values(creativeApprovals).filter(Boolean).length >= 3;
      case 5: return listiclePoints.filter(p => p.approved).length >= 8;
      case 6: return true;
      default: return false;
    }
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0: return renderProductSelect();
      case 1: return renderResearch();
      case 2: return renderAngles();
      case 3: return renderMessageTesting();
      case 4: return renderCreatives();
      case 5: return renderListicle();
      case 6: return renderAnalysis();
      default: return null;
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #0D0F12 0%, #131620 100%)" }}>
      {/* Top Pipeline Bar */}
      {currentStep > 0 && (
        <div className="sticky top-0 z-30 border-b border-white/[0.06]" style={{ background: "#0A0C0Fdd", backdropFilter: "blur(12px)" }}>
          <div className="max-w-6xl mx-auto px-6 py-3">
            <div className="flex items-center gap-1">
              {DFY_STEPS.map((step, i) => {
                const Icon = step.icon;
                const isActive = i === currentStep;
                const isCompleted = i < currentStep;
                const isClickable = i <= currentStep;
                return (
                  <div key={step.id} className="flex items-center">
                    <button onClick={() => isClickable && setCurrentStep(i)} disabled={!isClickable} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all ${isActive ? "bg-cyan-500/10 text-cyan-400" : isCompleted ? "text-green-400/60 hover:bg-white/[0.03]" : "text-white/15"} ${isClickable ? "cursor-pointer" : "cursor-default"}`}>
                      {isCompleted ? <Check size={10} className="text-green-400" /> : <Icon size={10} />}
                      <span className="hidden lg:inline">{step.label}</span>
                    </button>
                    {i < DFY_STEPS.length - 1 && <ChevronRight size={10} className={`mx-0.5 ${i < currentStep ? "text-green-400/30" : "text-white/10"}`} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6">
        <AnimatePresence mode="wait">{renderCurrentStep()}</AnimatePresence>
      </div>

      {/* Bottom Navigation */}
      {currentStep > 0 && currentStep < 6 && (
        <div className="fixed bottom-10 left-0 right-0 border-t border-white/[0.06] py-3 z-30" style={{ background: "#0A0C0Fee", backdropFilter: "blur(12px)" }}>
          <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
            <button onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))} className="px-4 py-2 rounded-lg text-xs font-mono border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-all flex items-center gap-1.5"><ChevronLeft size={12} /> Back</button>
            <div className="text-[10px] font-mono text-white/15">Step {currentStep} of {DFY_STEPS.length - 1}</div>
            <button onClick={() => setCurrentStep(prev => Math.min(DFY_STEPS.length - 1, prev + 1))} disabled={!canAdvance()} className="px-4 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: canAdvance() ? "linear-gradient(135deg, #00D4FF, #0099CC)" : undefined, color: canAdvance() ? "#0D0F12" : undefined }}>
              Next Step <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Chat Slide-Over */}
      <AnimatePresence>
        {showChat && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowChat(false)} />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed right-0 top-0 h-full w-96 z-50 border-l border-white/[0.06] flex flex-col" style={{ background: "#0F1115" }}>
              <div className="h-14 border-b border-white/[0.06] flex items-center justify-between px-4 shrink-0">
                <div><div className="text-xs font-mono text-cyan-400">Feedback Chat</div><div className="text-[10px] text-white/20">{chatContext}</div></div>
                <button onClick={() => setShowChat(false)} className="text-white/20 hover:text-white/50"><X size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.length === 0 && <div className="text-center text-xs text-white/15 mt-8">Send feedback about the {chatContext}. The AI will adjust accordingly.</div>}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${msg.role === "user" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "bg-white/[0.03] text-white/50 border border-white/[0.06]"}`}>{msg.content}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-white/[0.06] p-3 shrink-0">
                <div className="flex gap-2">
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSendChat()} placeholder="Type your feedback..." className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/15 outline-none focus:border-cyan-500/30" />
                  <button onClick={handleSendChat} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)" }}><Send size={12} className="text-[#0D0F12]" /></button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
