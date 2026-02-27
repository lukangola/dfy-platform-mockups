/**
 * DESIGN: Studio Control Room — Done For You Workflow (v3)
 * Scrollable research organized by angles as primary structure
 * No tabs, no B-Roll shot list — single continuous page
 * Embedded Message Testing flow with template selection
 * Detailed review views for every creative type
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Search, Target, MessageSquare, Paintbrush, FileText, BarChart3,
  ChevronRight, ChevronLeft, Check, RefreshCw, Send, Play,
  Edit3, ThumbsUp, RotateCcw, Download, ArrowRight, ArrowLeft,
  Sparkles, Zap, Eye, X, ChevronDown, ChevronUp, Plus,
  Video, ImagePlus, Type, Megaphone, ListChecks,
  BookOpen, Users, Beaker, Shield, Brain, Heart, Quote,
  Layers, Grid3X3, Maximize2,
} from "lucide-react";
import { IMAGES, MOCK_PRODUCTS, MOCK_MESSAGE_TEMPLATES } from "@/lib/mockData";

// ============================================================
// DFY WORKFLOW STEPS (removed separate Angles step — angles are in Research)
// ============================================================

const DFY_STEPS = [
  { id: 0, key: "select", label: "Select Product", icon: Package, description: "Choose the product" },
  { id: 1, key: "research", label: "Research", icon: Search, description: "Full research with angles" },
  { id: 2, key: "message-testing", label: "Message Testing", icon: MessageSquare, description: "Choose template & generate testing ads" },
  { id: 3, key: "creatives", label: "Produce Creatives", icon: Paintbrush, description: "Founder Ads, VSLs, Static Ads, UGC Scripts" },
  { id: 4, key: "listicle", label: "Build Listicle", icon: FileText, description: "Angle-specific listicle page" },
  { id: 5, key: "analysis", label: "Sprint Complete", icon: BarChart3, description: "Summary & export" },
];

// ============================================================
// RESEARCH DATA — scrollable, angle-first structure
// ============================================================

const RESEARCH_DATA = {
  productContext: {
    description: "Golden Radiance Serum is a premium facial serum featuring a 24K gold-infused formula with Vitamin C, Hyaluronic Acid, and Niacinamide. Targets dullness, fine lines, and uneven skin tone.",
    primaryPurpose: "To deliver visible anti-aging results through a multi-active formula that combines luxury experience with clinical efficacy. Positioned as an accessible premium alternative to high-end serums.",
    framework: "Transformation-Based Luxury Positioning Framework",
  },
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
      { name: "Ferulic Acid", mechanism: "Stabilizes Vitamin C, doubles photoprotection efficacy" },
      { name: "Rosehip Seed Oil", mechanism: "Rich in trans-retinoic acid; promotes cell turnover without irritation" },
    ],
  },
  ingredientAnalysis: [
    { name: "Vitamin C (L-Ascorbic Acid)", active: "L-Ascorbic Acid at 15%", analysis: "L-Ascorbic Acid is the most bioavailable form of Vitamin C for topical application. At 15% concentration, it sits in the optimal efficacy window (10-20%) identified in multiple clinical studies. It works by inhibiting tyrosinase — the enzyme responsible for melanin production — resulting in visibly brighter, more even skin tone within 2-4 weeks. Additionally, it neutralizes free radicals from UV exposure and pollution, preventing premature aging at the cellular level. A 2017 study in the Journal of Clinical and Aesthetic Dermatology showed that 15% L-Ascorbic Acid reduced hyperpigmentation by 73% over 12 weeks." },
    { name: "Hyaluronic Acid", active: "Triple molecular weight (high, medium, low)", analysis: "Unlike single-weight HA products that only hydrate the surface, this triple-weight formulation penetrates three distinct skin layers. High molecular weight (>1000 kDa) forms a moisture-retaining film on the epidermis. Medium weight (100-1000 kDa) penetrates to the dermis for deep hydration. Low molecular weight (<100 kDa) reaches the subcutaneous layer to stimulate the skin's own HA production. Clinical data shows this approach delivers 72-hour hydration vs. 8-12 hours for single-weight formulas." },
    { name: "24K Gold Particles", active: "Colloidal gold nanoparticles", analysis: "Colloidal gold has been used in medicine for centuries, but recent dermatological research has validated its topical benefits. Gold nanoparticles exhibit potent anti-inflammatory properties by inhibiting NF-κB signaling — the master regulator of inflammatory responses. A 2012 study published in Nanomedicine showed that colloidal gold stimulated collagen synthesis by 89% in fibroblast cultures. The light-reflecting properties of gold particles also create an immediate visible radiance effect." },
    { name: "Peptide Complex (Matrixyl 3000)", active: "Palmitoyl Tripeptide-1 & Palmitoyl Tetrapeptide-7", analysis: "Matrixyl 3000 is a dual-peptide complex that works synergistically to stimulate the production of collagen types I, III, and IV. In a double-blind clinical study, Matrixyl 3000 reduced wrinkle depth by 45% over 2 months. Unlike retinol, it achieves anti-aging effects without irritation, making it suitable for sensitive skin types." },
  ],
  competitiveMapping: [
    { category: "Premium Vitamin C Serums ($80-200)", examples: "SkinCeuticals C E Ferulic ($182), Drunk Elephant C-Firma ($80)", failures: "High price points with single-active focus. SkinCeuticals relies on brand prestige to justify 2.3x markup for a similar Vitamin C concentration. Drunk Elephant's formula oxidizes quickly, reducing efficacy within weeks of opening.", opportunity: "Multi-active formula at competitive price with superior stability through gold-particle encapsulation technology." },
    { category: "Budget Vitamin C Options ($5-20)", examples: "The Ordinary Vitamin C 23% ($6.80), CeraVe Vitamin C Serum ($18)", failures: "Unstable formulations that oxidize rapidly, grainy textures, and concentrations that cause irritation without proportional results.", opportunity: "Position as the 'Goldilocks' option — optimal concentration, premium experience, and multi-active benefits at a mid-market price." },
    { category: "Gold-Infused Skincare ($40-150)", examples: "Peter Thomas Roth 24K Gold Mask ($85), Orogold 24K Deep Peeling ($120)", failures: "Most gold skincare products use gold as a marketing gimmick with negligible concentrations. Peter Thomas Roth's mask is a wash-off treatment with minimal gold contact time.", opportunity: "Colloidal gold nanoparticles that actually penetrate and deliver measurable anti-inflammatory benefits, combined with proven actives." },
  ],
  rootCauses: [
    { name: "Oxidative Stress Accumulation", description: "Daily exposure to UV radiation, pollution, and blue light generates reactive oxygen species (ROS) that damage cellular DNA, break down collagen fibers, and accelerate the formation of fine lines and hyperpigmentation." },
    { name: "Chronic Low-Grade Inflammation", description: "Micro-inflammation from environmental stressors, harsh skincare products, and stress hormones creates a persistent inflammatory state in the dermis. This 'inflammaging' degrades the extracellular matrix and accelerates visible aging." },
    { name: "Collagen Degradation Cycle", description: "After age 25, collagen production decreases by approximately 1% per year. Simultaneously, matrix metalloproteinases (MMPs) become more active, creating a negative feedback loop of progressive firmness loss." },
    { name: "Barrier Function Impairment", description: "Overuse of harsh actives strips the stratum corneum of essential lipids. This compromised barrier leads to transepidermal water loss (TEWL) and paradoxically accelerates the aging it was meant to prevent." },
    { name: "Hydration-Radiance Disconnect", description: "Surface-level hydration from most moisturizers creates a temporary plumping effect but fails to address deep dermal dehydration. True radiance requires hydration at multiple skin depths." },
  ],
  customerLanguage: [
    { category: "Dull Skin & Lack of Radiance", quotes: ["My skin just looks... dead. No matter what I do, there's no glow.", "I spend 20 minutes on my routine and still look like I haven't slept in a week.", "Everyone asks if I'm tired. I'm not tired, my skin just looks terrible.", "I've tried vitamin C, retinol, AHA — nothing gives me that 'lit from within' look."] },
    { category: "Fine Lines & Premature Aging", quotes: ["I'm 32 and I have forehead lines that make me look 40.", "The lines around my eyes appeared overnight. One day smooth, next day creased.", "My mom looks younger than me and she uses bar soap. What am I doing wrong?", "I can literally see my skin losing firmness month by month. It's terrifying."] },
    { category: "Product Fatigue & Skepticism", quotes: ["I've spent $3,000 on serums this year alone. My skin looks the same.", "Every brand claims to be 'clinically proven' but none of them show the actual studies.", "I'm so tired of the skincare industry lying to me. Just give me something that works.", "At this point I'd rather save for Botox than buy another 'miracle' serum."] },
  ],
  reviewAnalysis: {
    totalReviews: 2847,
    themes: [
      { name: "Visible Glow Within Days", pct: 34, desc: "Largest theme — users consistently report a noticeable 'lit from within' radiance within 3-7 days of first use." },
      { name: "Texture Improvement", pct: 22, desc: "Smoother skin texture, reduced pore appearance, and softer feel reported across all age groups." },
      { name: "Fine Line Reduction", pct: 18, desc: "Users 35+ specifically mention visible reduction in forehead lines and crow's feet within 2-4 weeks." },
      { name: "Luxury Experience", pct: 14, desc: "The gold color, glass packaging, and application ritual are frequently cited as reasons for repurchase." },
      { name: "Replaced Multiple Products", pct: 8, desc: "Users report simplifying their routine from 5-7 products to 2-3 after incorporating this serum." },
      { name: "Sensitive Skin Friendly", pct: 4, desc: "Despite active ingredients, minimal reports of irritation — attributed to the squalane and gold's anti-inflammatory properties." },
    ],
    keyObservation: "The strongest emotional driver is not the anti-aging benefit itself, but the confidence boost from visible radiance. Users describe feeling 'like themselves again' rather than 'younger' — suggesting transformation messaging should focus on radiance restoration rather than age reversal.",
  },
};

// ============================================================
// ANGLES — the primary structure of the research output
// ============================================================

const RESEARCH_ANGLES = [
  {
    id: "a1",
    name: "Visible Transformation — Radiance Restoration",
    tagline: "From dull and lifeless to lit-from-within glow",
    rootCause: "Oxidative stress from UV, pollution, and blue light has been silently degrading your skin's natural luminosity for years. The damage accumulates at the cellular level — destroying the light-reflecting properties of healthy skin cells and creating a persistent dullness that no amount of moisturizer can fix.",
    physicalPain: "Dull, lifeless complexion that looks tired regardless of sleep. Uneven skin tone with dark spots and patches. Skin that absorbs light instead of reflecting it — making you look older and more fatigued than you are.",
    emotionalPain: "The frustration of spending hundreds on products that promise 'glow' but deliver nothing. The self-consciousness of being asked 'Are you tired?' when you're not. The slow erosion of confidence as you watch your skin lose its vitality month by month.",
    failedSolutions: "Single-ingredient Vitamin C serums that oxidize in the bottle before they can work. Harsh chemical peels that strip the skin and cause rebound dullness. Illuminating primers that fake a glow on top of damaged skin without addressing the root cause. LED masks that require 20+ minutes daily with marginal results.",
    newFraming: "True radiance isn't about adding glow on top — it's about restoring your skin's biological ability to reflect light. This requires simultaneously neutralizing oxidative damage (Vitamin C + Ferulic Acid), rebuilding the collagen matrix that creates natural luminosity (Peptides + Gold), and hydrating at all three skin depths (Triple-weight HA).",
    productSolution: "Golden Radiance Serum combines 15% L-Ascorbic Acid with colloidal gold nanoparticles that stimulate collagen synthesis by 89% while creating immediate light-reflecting radiance. The triple-weight Hyaluronic Acid ensures hydration reaches all skin layers, while Matrixyl 3000 rebuilds the structural foundation of youthful, glowing skin.",
    competitiveAdvantage: "Unlike single-active serums that address one symptom, this multi-mechanism formula targets the three root causes of dullness simultaneously. The colloidal gold provides both immediate visible results AND long-term collagen stimulation — something no competitor offers.",
    primaryAudience: "Women 28-45 who have tried multiple skincare products without achieving the 'glow' they see on others. Typically spend $50-150/month on skincare, are educated about ingredients, and are growing skeptical of marketing claims. They want science-backed results, not another empty promise.",
    secondaryAudience: "Women 45-60 experiencing accelerated dullness from menopause-related hormonal changes. Willing to invest in premium products but need to see results within 1-2 weeks to maintain commitment.",
    resonanceStatements: [
      "I've been using expensive serums for three years now and honestly, I can't tell the difference between any of them. My skin still looks dull, still looks tired. I'm starting to think maybe this is just how my skin is now and nothing will change it. But then I see other women my age with this incredible glow and I know it's possible — I just haven't found the right thing yet.",
      "The worst part isn't even the dull skin itself. It's when someone at work says 'rough night?' and I slept 8 hours. Or when my husband says I look tired when I feel fine. My skin is telling a story about me that isn't true, and I can't seem to change the narrative no matter what I put on it.",
      "I did the math last month — I've spent over $4,000 on serums, masks, and treatments in the past two years. Four thousand dollars. And my skin looks exactly the same as it did before I started. Sometimes I think it looks worse because now I'm hyper-aware of every dull patch and uneven area.",
      "What kills me is that I know the science exists. I've read the studies on Vitamin C, on peptides, on hyaluronic acid. I know these ingredients work in clinical trials. So why don't they work on my face? Either the products aren't formulated right or my skin is broken beyond repair. Both options are depressing.",
      "I used to have this natural glow in my twenties — people would ask if I was wearing highlighter when I wasn't. Now I layer on three products just to look 'normal.' I miss that effortless radiance. I didn't appreciate it when I had it.",
    ],
    messages: [
      "Your skin isn't aging — it's suffocating under oxidative damage. Here's the fix.",
      "I spent $4,000 on serums before I understood why none of them worked.",
      "The 'glow' you lost in your 30s isn't gone — it's buried under cellular damage.",
      "Why your Vitamin C serum oxidizes before it can work (and what to use instead).",
      "Dermatologists won't tell you this: most 'brightening' serums are too unstable to work.",
      "3 days. That's how fast colloidal gold restores what years of damage took away.",
      "Stop faking glow with highlighter. Restore the real thing at the cellular level.",
      "The $78 serum that replaced my entire $200/month skincare routine.",
      "89% increase in collagen synthesis. Not from retinol. From something ancient.",
      "If you're tired of being asked 'are you tired?' — your skin barrier is the problem.",
    ],
    angleCopy: "You haven't lost your glow. It's been buried.\n\nEvery day, UV radiation, pollution, and blue light from your screen generate millions of free radicals that attack your skin cells. Over time, this oxidative damage destroys the collagen matrix that gives skin its natural luminosity — creating that persistent dullness that no moisturizer can fix.\n\nYou've probably tried Vitamin C serums. Maybe several. The problem? Most formulas oxidize in the bottle within weeks, delivering a fraction of their promised potency. And even the ones that don't oxidize only address ONE of the three root causes of dull skin.\n\nGolden Radiance Serum is different. It combines 15% stabilized L-Ascorbic Acid with colloidal gold nanoparticles — the same compound that stimulated collagen production by 89% in clinical studies. Add triple-weight Hyaluronic Acid that hydrates at three skin depths, and Matrixyl 3000 that rebuilds your skin's structural foundation.\n\nThe result? Visible radiance in 3-5 days. Not from a filter. Not from a primer. From your actual skin, doing what it was always meant to do.\n\nTry it for 30 days. If you don't get at least one unsolicited compliment on your skin, we'll refund every penny.",
  },
  {
    id: "a2",
    name: "Anti-Aging Without Irritation",
    tagline: "Finally — real results without the retinol redness",
    rootCause: "The skincare industry has conditioned consumers to believe that effective anti-aging requires aggressive ingredients that cause irritation, peeling, and 'purging periods.' This has created a cycle where people damage their skin barrier in pursuit of anti-aging results, paradoxically accelerating the aging process.",
    physicalPain: "Redness, flaking, and sensitivity from retinol and chemical exfoliants. The dreaded 'purging period' that makes skin worse before it gets better. Barrier damage that leads to increased sensitivity and reactive skin.",
    emotionalPain: "The impossible choice between 'effective but painful' and 'gentle but useless.' Feeling like you have to suffer for results. The anxiety of trying a new active ingredient and not knowing if the reaction is 'purging' or damage.",
    failedSolutions: "Prescription retinoids that cause months of peeling and sun sensitivity. High-concentration AHAs that strip the barrier. Microneedling that creates micro-wounds requiring days of recovery. Aggressive professional peels that leave skin raw and vulnerable.",
    newFraming: "Anti-aging doesn't require aggression. The most effective approach combines peptide signaling (telling cells to produce more collagen) with anti-inflammatory protection (gold nanoparticles) and deep hydration (triple-weight HA) — achieving superior results without a single day of irritation.",
    productSolution: "Golden Radiance Serum delivers anti-aging results through peptide technology and colloidal gold — both clinically proven to stimulate collagen without triggering inflammatory responses. Zero purging period. Zero peeling. Just progressive, visible improvement from day one.",
    competitiveAdvantage: "While competitors force customers through weeks of irritation for results, this formula works WITH the skin's biology rather than against it. The gold nanoparticles actually reduce inflammation while stimulating collagen — the opposite of retinol's inflammatory pathway.",
    primaryAudience: "Women 30-50 who have tried retinol and experienced negative reactions (redness, peeling, sensitivity). They want anti-aging results but have been burned by aggressive products. Often have sensitive or reactive skin types.",
    secondaryAudience: "Women 25-35 who are retinol-curious but afraid to start because of the horror stories they've seen online. They want to be proactive about aging but don't want to risk their current skin health.",
    resonanceStatements: [
      "I tried tretinoin for six months. Six months of peeling, redness, and my skin looking worse than when I started. My dermatologist kept saying 'push through it' but I couldn't take it anymore. My skin was raw. I looked like I had a sunburn every single day.",
      "Every anti-aging product that actually works seems to come with a warning label. Retinol? Peeling. Vitamin C at high concentrations? Stinging. AHAs? Don't go in the sun. I just want something that makes my skin better without making it worse first.",
      "I have sensitive skin AND I'm aging. Apparently that means I get to choose between looking old or looking irritated. Every 'powerful' anti-aging product destroys my barrier within a week. I'm so frustrated.",
      "The whole concept of 'purging' feels like gaslighting. Your skin is getting worse? That means it's working! Really? In what other context do we accept that something making us worse is actually helping?",
    ],
    messages: [
      "Retinol made my skin worse for 6 months. This worked in 3 days — with zero irritation.",
      "The anti-aging ingredient that stimulates 89% more collagen than retinol. Without the peeling.",
      "Your skin shouldn't have to suffer to look younger. Here's the science that proves it.",
      "I quit retinol. My skin has never looked better. Here's what I use instead.",
      "Sensitive skin AND aging? You don't have to choose between comfort and results anymore.",
      "The 'purging period' is a lie the skincare industry tells you. Real results don't hurt.",
      "Gold nanoparticles: the anti-inflammatory anti-aging ingredient dermatologists are sleeping on.",
      "Why the most effective anti-aging approach is also the gentlest one.",
      "No peeling. No redness. No 'it gets worse before it gets better.' Just results.",
      "The $78 alternative to retinol that sensitive skin types are switching to.",
    ],
    angleCopy: "What if the most effective anti-aging ingredient was also the gentlest?\n\nFor decades, the skincare industry has told you that real results require real suffering. Retinol purging. Chemical peel recovery. Weeks of redness and peeling before you see improvement.\n\nBut here's what the science actually shows: the inflammatory pathway that retinol triggers to stimulate collagen is not the only pathway available. Peptide signaling and colloidal gold achieve the same collagen stimulation — through an anti-inflammatory mechanism that protects your skin barrier instead of destroying it.\n\nGolden Radiance Serum uses Matrixyl 3000 (clinically shown to reduce wrinkle depth by 45%) combined with colloidal gold nanoparticles that boost collagen synthesis by 89% while actively reducing inflammation.\n\nNo purging period. No peeling. No choosing between results and comfort.\n\nJust your skin, getting visibly younger, day by day. Starting from the very first application.",
  },
  {
    id: "a3",
    name: "Luxury Self-Care Ritual",
    tagline: "Transform your routine into a golden moment of self-care",
    rootCause: "Modern life has reduced skincare to a rushed, joyless chore — another task on an endless to-do list. This transactional relationship with self-care means products are applied hastily, inconsistently, and without the mindful attention that both skin and soul need.",
    physicalPain: "Inconsistent product application leading to uneven results. Rushed routines that don't allow products to absorb properly. Multiple products creating a complicated, time-consuming regimen that's hard to maintain.",
    emotionalPain: "Skincare feels like a chore, not a pleasure. The guilt of skipping steps when tired. The overwhelming complexity of 7-10 step routines. Losing the connection between self-care and self-worth.",
    failedSolutions: "Complex 10-step Korean skincare routines that are impossible to maintain long-term. Clinical-looking products in medical packaging that feel like medication, not luxury. Expensive spa treatments that provide a moment of luxury but aren't sustainable daily.",
    newFraming: "When skincare becomes a ritual you look forward to — not a chore you rush through — consistency follows naturally. And consistency is what delivers results. The sensory experience of a product is not superficial; it's the mechanism that ensures you actually use it every day.",
    productSolution: "Golden Radiance Serum transforms your routine into a 60-second luxury ritual. The visible gold particles, the weight of the glass dropper, the silky texture that melts into skin — every detail is designed to make this the moment in your day you actually look forward to.",
    competitiveAdvantage: "Most serums are designed to be effective. This one is designed to be effective AND irresistible to use. The luxury experience ensures the consistency that clinical ingredients need to deliver results.",
    primaryAudience: "Professional women 30-50 who value quality over quantity. They'd rather have one exceptional product than ten mediocre ones. They appreciate craftsmanship, design, and the ritual of self-care as a form of self-respect.",
    secondaryAudience: "Gift buyers looking for a luxurious, Instagram-worthy skincare gift that feels special and premium. The gold aesthetic and glass packaging make it a standout present.",
    resonanceStatements: [
      "I used to have this beautiful evening routine — candles, music, taking my time with each product. Now I'm lucky if I remember to wash my face before collapsing into bed. I miss that version of me who treated herself with care.",
      "My bathroom counter looks like a pharmacy. Twelve products, all in clinical white packaging with tiny text. Nothing about my skincare routine feels luxurious or special. It feels like a medical protocol.",
      "I bought a $180 serum once just because the bottle was beautiful. I know that sounds shallow, but I used it every single day because I loved the ritual of it. The cheaper serums I buy for the ingredients? They sit in my drawer unused.",
    ],
    messages: [
      "Your skincare routine should be the best 60 seconds of your day.",
      "I replaced 7 products with one golden ritual. My skin — and my sanity — have never been better.",
      "The serum that made me actually look forward to my skincare routine.",
      "Skincare shouldn't feel like homework. It should feel like a golden moment of self-care.",
      "Why the most luxurious serum I've ever used is also the most effective.",
      "One product. 60 seconds. The ritual that changed my skin and my mornings.",
      "Stop treating skincare like a chore. Start treating it like the luxury you deserve.",
      "The gold serum that simplified my routine and elevated my results.",
      "When your serum feels this good, consistency happens naturally. And consistency is everything.",
      "I didn't buy this for the gold. I bought it for the results. I stayed for the ritual.",
    ],
    angleCopy: "What if your skincare routine was the best part of your day?\n\nNot a chore. Not a 10-step protocol. Not something you rush through or skip when you're tired.\n\nA ritual. A golden, 60-second moment of pure self-care that you actually look forward to.\n\nGolden Radiance Serum was designed with a simple insight: the most effective skincare product is the one you actually use every day. And you'll use it every day when it feels extraordinary.\n\nThe weight of the glass dropper in your hand. The visible gold particles catching the light. The silky, non-greasy texture that melts into your skin like liquid luxury.\n\nBut this isn't just about aesthetics. Beneath the ritual is a formula that delivers: 15% Vitamin C for brightening, colloidal gold for collagen stimulation, triple-weight HA for deep hydration, and Matrixyl 3000 for wrinkle reduction.\n\nBeauty and efficacy. Luxury and science. In one golden drop.",
  },
  {
    id: "a4",
    name: "Science-Backed Results",
    tagline: "Clinical proof, not marketing promises",
    rootCause: "The skincare industry has eroded consumer trust through decades of exaggerated claims, misleading 'clinical studies' with tiny sample sizes, and marketing language designed to imply results without actually promising them. Consumers are increasingly skeptical but lack the scientific literacy to evaluate claims independently.",
    physicalPain: "Wasting money on products that don't deliver on their promises. Using products with unproven or insufficient concentrations of active ingredients. Skin that doesn't improve despite following recommended routines.",
    emotionalPain: "Deep distrust of skincare marketing. Feeling manipulated by before/after photos and influencer endorsements. The exhaustion of researching every ingredient and still not knowing what to believe.",
    failedSolutions: "Products that claim 'clinically proven' based on studies with 12 participants. Influencer recommendations driven by sponsorship, not results. Dermatologist-recommended products that are safe but not particularly effective. DIY skincare that lacks proper formulation science.",
    newFraming: "Real clinical evidence isn't a 12-person study funded by the brand. It's decades of independent research on individual ingredients at specific concentrations. When you understand the science, you can evaluate products yourself — and Golden Radiance Serum is formulated to withstand that scrutiny.",
    productSolution: "Every ingredient in Golden Radiance Serum is backed by independent, peer-reviewed research at the exact concentrations used. 15% L-Ascorbic Acid (optimal range: 10-20%). Matrixyl 3000 (45% wrinkle depth reduction in double-blind study). Colloidal gold (89% collagen synthesis increase in Nanomedicine journal). No proprietary blends hiding behind vague percentages.",
    competitiveAdvantage: "Full ingredient transparency with published research citations for every active. No proprietary blends, no hidden concentrations, no 'clinical studies' conducted by the brand itself.",
    primaryAudience: "Ingredient-savvy consumers 25-45 who read INCI lists, follow dermatologists on social media, and are skeptical of marketing claims. They want to see the studies, know the concentrations, and make informed decisions.",
    secondaryAudience: "Healthcare professionals and estheticians who recommend products to clients and need to trust the formulation science behind what they suggest.",
    resonanceStatements: [
      "I'm so tired of 'clinically proven' meaning a 12-person study funded by the brand. That's not science. That's marketing with a lab coat.",
      "I spent two hours last week trying to figure out if the Vitamin C in my serum was actually at an effective concentration. The brand wouldn't tell me. That tells me everything I need to know.",
      "Every influencer I follow is sponsored by a different skincare brand. They all claim their product is 'the one.' I don't trust any of them anymore. I just want to see the actual research.",
    ],
    messages: [
      "89% collagen increase. Published in Nanomedicine. Not in a brand-funded 'study' with 12 people.",
      "We publish every concentration. Every study citation. Every mechanism. Because real science has nothing to hide.",
      "Tired of 'clinically proven' claims with no actual proof? Here are the receipts.",
      "The skincare industry doesn't want you to understand the science. We do.",
      "15% Vitamin C. Not 'a proprietary blend of brightening actives.' The actual percentage.",
      "Stop trusting influencers. Start trusting peer-reviewed research.",
      "Every ingredient. Every concentration. Every published study. All on the label.",
      "The serum for people who read ingredient lists before buying.",
      "We don't say 'clinically proven.' We give you the citations so you can verify yourself.",
      "Formulated by scientists. Verified by research. Trusted by skeptics.",
    ],
    angleCopy: "Let's talk about 'clinically proven.'\n\nIn the skincare industry, that phrase can mean almost anything. A study with 12 participants. A brand-funded trial with no control group. A survey where people 'agreed' their skin 'felt smoother.'\n\nWe think you deserve better than that.\n\nEvery active ingredient in Golden Radiance Serum is backed by independent, peer-reviewed research:\n\n→ 15% L-Ascorbic Acid: Optimal concentration per Journal of Clinical and Aesthetic Dermatology (2017). 73% reduction in hyperpigmentation over 12 weeks.\n→ Colloidal Gold: 89% increase in collagen synthesis per Nanomedicine (2012). Anti-inflammatory via NF-κB pathway inhibition.\n→ Matrixyl 3000: 45% wrinkle depth reduction in double-blind study. Stimulates collagen types I, III, and IV.\n→ Triple-weight Hyaluronic Acid: 72-hour hydration vs. 8-12 hours for single-weight formulas.\n\nNo proprietary blends. No hidden concentrations. No 'trust us.'\n\nJust science you can verify yourself.",
  },
  {
    id: "a5",
    name: "Ingredient Transparency — Simplify Your Routine",
    tagline: "One serum that replaces five products",
    rootCause: "The skincare industry profits from complexity. More steps means more products sold. But layering 5-7 products creates ingredient conflicts, increases irritation risk, and makes it impossible to identify what's actually working or causing problems.",
    physicalPain: "Product pilling from layering too many serums. Ingredient conflicts (e.g., Vitamin C + Niacinamide myths). Overwhelmed skin barrier from too many actives. Confusion about product order and timing.",
    emotionalPain: "Decision fatigue from an overwhelming number of products and conflicting advice. Guilt about the money spent on products that sit unused. The anxiety of not knowing if your routine is helping or hurting.",
    failedSolutions: "Building a 7-10 step routine based on influencer recommendations. Buying individual serums for each active ingredient. Constantly adding new products without removing old ones. Following conflicting advice from different dermatologists.",
    newFraming: "The most effective skincare routine is the simplest one. When a single product contains the right actives at the right concentrations in a stable, synergistic formula, you don't need 7 products — you need one good one.",
    productSolution: "Golden Radiance Serum replaces your Vitamin C serum, your hyaluronic acid, your peptide serum, your niacinamide treatment, and your facial oil — in one stable, synergistic formula where every ingredient enhances the others.",
    competitiveAdvantage: "Instead of buying 5 separate products ($200-400 total) and hoping they work together, get one formula specifically designed for ingredient synergy at a fraction of the cost.",
    primaryAudience: "Women 25-40 experiencing 'skincare fatigue' from overly complex routines. They've accumulated 10+ products and feel overwhelmed. They want simplification without sacrificing results.",
    secondaryAudience: "Skincare beginners who are intimidated by the complexity of building a routine and want one reliable product to start with.",
    resonanceStatements: [
      "My bathroom looks like a Sephora stockroom. I have 14 products and I don't even know which ones are doing anything. I'm afraid to stop using any of them in case that's 'the one' that's working.",
      "I spend 25 minutes on my morning routine. Twenty-five minutes. That's almost 3 hours a week just putting stuff on my face. There has to be a simpler way.",
      "I read that Vitamin C and Niacinamide shouldn't be used together. Then I read they can. Then I read it depends on the pH. I give up. I just want someone to tell me what to put on my face.",
    ],
    messages: [
      "I replaced 5 serums with one. My skin has never looked better. My bathroom has never been cleaner.",
      "Your 10-step routine isn't helping your skin. It's overwhelming it.",
      "One serum. Five actives. Zero conflicts. The simplification your skin is begging for.",
      "The skincare industry wants you to buy 7 products. You need one.",
      "Stop layering. Start simplifying. Your skin barrier will thank you.",
      "25 minutes on skincare every morning? There's a 60-second alternative that works better.",
      "$78 for one serum vs. $350 for five that don't work together. The math is simple.",
      "The serum that made me throw away half my skincare collection.",
      "Ingredient synergy > ingredient quantity. Always.",
      "Your skin doesn't need more products. It needs the right formula.",
    ],
    angleCopy: "How many products are on your bathroom counter right now?\n\nIf you're like most women, the answer is somewhere between 7 and 15. A Vitamin C serum. A hyaluronic acid. A peptide treatment. Niacinamide. A facial oil. Maybe a retinol for night.\n\nEach one bought because an influencer or a dermatologist said you 'need' it. Each one adding time, complexity, and cost to your routine. And here's the uncomfortable truth: they might be fighting each other.\n\nLayering multiple actives creates pH conflicts, stability issues, and barrier stress. Your skin doesn't need more products — it needs the right formula.\n\nGolden Radiance Serum combines five key actives in one synergistic formula: Vitamin C for brightening, Hyaluronic Acid for hydration, Peptides for anti-aging, Niacinamide for barrier repair, and Colloidal Gold for inflammation and collagen.\n\nOne product. 60 seconds. Better results than your entire current routine.\n\nSimplify everything.",
  },
];

// ============================================================
// CREATIVE MOCK DATA
// ============================================================

const MOCK_FOUNDER_ADS = [
  { id: "fa1", title: "Origin Story — Why I Created This", hook: "I spent 3 years and $200K developing a serum that actually works.", script: "Three years ago, I was exactly where you are. Spending hundreds on serums that promised the world and delivered nothing. As a biochemist, I knew the science existed — the industry just wasn't using it right. So I locked myself in a lab with one mission: create the serum I wished existed. 47 formulations later, Golden Radiance Serum was born.", status: "pending", image: IMAGES.productSerum },
  { id: "fa2", title: "The Gold Discovery", hook: "The ancient ingredient that modern science finally proved works.", script: "Cleopatra bathed in gold. For centuries, we thought it was vanity. Then in 2012, a groundbreaking study in Nanomedicine proved what she instinctively knew — colloidal gold stimulates collagen production by 89%. When I read that study, I knew I had to put it in a serum.", status: "pending", image: IMAGES.brollPresentation },
  { id: "fa3", title: "The $3,000 Mistake", hook: "I wasted $3,000 on skincare before I understood this one thing.", script: "I tracked every dollar I spent on skincare for two years. The total? $3,247. On serums, masks, treatments, and devices. My skin looked exactly the same. The problem wasn't the ingredients — it was the formulations. Most products contain the right ingredients at the wrong concentrations.", status: "pending", image: IMAGES.brollUsage },
  { id: "fa4", title: "Why We Show Our Concentrations", hook: "Every skincare brand hides this. We put it on the label.", script: "Ask any skincare brand the exact percentage of Vitamin C in their serum. Most won't tell you. That's because they use concentrations below the clinically effective threshold — just enough to list the ingredient, not enough to deliver results. We put 15% on our label because we have nothing to hide.", status: "pending", image: IMAGES.productShampoo },
  { id: "fa5", title: "The Simplification Manifesto", hook: "Your bathroom counter is lying to you. You don't need 10 products.", script: "I used to have a 9-step routine. Nine products, applied in a specific order, twice a day. My skin was okay. Then I formulated Golden Radiance Serum with five actives in one bottle. I dropped to a 2-step routine. My skin has never looked better.", status: "pending", image: IMAGES.brollUnboxing },
];

const MOCK_MINI_VSLS = [
  { id: "mv1", title: "The 89% Study", hook: "What if I told you there's an ingredient that increases collagen by 89%?", script: "HOOK: What if I told you there's an ingredient that increases collagen production by 89%?\n\nPROBLEM: You've tried retinol. You've tried peptides. You've tried vitamin C. And your skin still looks... the same.\n\nAGITATE: Every year, you lose 1% of your collagen. And most products can't keep up with that loss.\n\nSOLUTION: Colloidal gold. In a 2012 study published in Nanomedicine, gold nanoparticles increased collagen synthesis by 89% in fibroblast cultures.\n\nPRODUCT: Golden Radiance Serum combines colloidal gold with 15% Vitamin C and Matrixyl 3000.\n\nCTA: Try it risk-free for 30 days.", duration: "45-60s", status: "pending" },
  { id: "mv2", title: "The Routine Simplifier", hook: "I used to spend 25 minutes on skincare every morning. Now I spend 60 seconds.", script: "HOOK: I used to spend 25 minutes on skincare every morning. Now I spend 60 seconds.\n\nPROBLEM: 7 products. Specific order. Wait times between layers. And half of them were probably canceling each other out.\n\nREVEAL: One serum replaced five of them. Same ingredients, better concentrations, designed to work together.\n\nRESULT: Better skin in less time. My dermatologist actually asked what changed.\n\nCTA: Link in bio.", duration: "30-45s", status: "pending" },
  { id: "mv3", title: "The Trust Problem", hook: "I don't trust skincare brands. Here's why I made my own.", script: "HOOK: I don't trust skincare brands. And I work in the industry.\n\nPROBLEM: 'Clinically proven' means nothing. Brands fund their own studies with 12 participants and call it science.\n\nFRUSTRATION: I spent years reading the actual research. The ingredients work. The products don't — because they're formulated for marketing, not efficacy.\n\nSOLUTION: So I made a serum with published concentrations backed by independent studies.\n\nPROOF: Every claim has a citation. Every percentage is on the label.\n\nCTA: Check the science yourself. Link in bio.", duration: "45-60s", status: "pending" },
];

const MOCK_SHORT_VIDEO_ADS = [
  { id: "sv1", title: "The Gold Drop", hook: "Watch what happens when liquid gold meets skin.", format: "15s — Product Demo", status: "pending", image: IMAGES.brollUsage },
  { id: "sv2", title: "Before/After Timelapse", hook: "Day 1 vs. Day 14. Same lighting. Same camera. Different skin.", format: "15s — Results", status: "pending", image: IMAGES.productSerum },
  { id: "sv3", title: "The Ingredient Callout", hook: "5 actives. 1 serum. 0 compromises.", format: "20s — Educational", status: "pending", image: IMAGES.brollPresentation },
  { id: "sv4", title: "Morning Ritual", hook: "60 seconds that changed my skin.", format: "30s — Lifestyle", status: "pending", image: IMAGES.brollUnboxing },
  { id: "sv5", title: "The Skeptic Convert", hook: "I didn't believe in gold skincare. Then I saw my own results.", format: "25s — Testimonial", status: "pending", image: IMAGES.productShampoo },
];

const MOCK_STATIC_ADS = [
  { id: "sa1", title: "Problem Aware — Dull Skin", message: "Your skin isn't aging. It's suffocating.", awarenessStage: "Problem Aware", status: "pending", image: IMAGES.productSerum },
  { id: "sa2", title: "Problem Aware — Product Fatigue", message: "$3,000 on serums. Same skin.", awarenessStage: "Problem Aware", status: "pending", image: IMAGES.brollPresentation },
  { id: "sa3", title: "Solution Aware — Ingredients", message: "15% Vitamin C + 24K Gold + Matrixyl 3000", awarenessStage: "Solution Aware", status: "pending", image: IMAGES.brollUsage },
  { id: "sa4", title: "Solution Aware — Simplification", message: "One serum replaced my entire routine.", awarenessStage: "Solution Aware", status: "pending", image: IMAGES.productShampoo },
  { id: "sa5", title: "Product Aware — Social Proof", message: "4.7★ from 2,847 reviews. See why.", awarenessStage: "Product Aware", status: "pending", image: IMAGES.brollUnboxing },
  { id: "sa6", title: "Product Aware — Science", message: "89% collagen increase. Published. Peer-reviewed. Real.", awarenessStage: "Product Aware", status: "pending", image: IMAGES.productSerum },
  { id: "sa7", title: "Most Aware — Offer", message: "15% off your first bottle. 30-day guarantee.", awarenessStage: "Most Aware", status: "pending", image: IMAGES.brollPresentation },
  { id: "sa8", title: "Most Aware — Urgency", message: "This batch sells out every month. Don't wait.", awarenessStage: "Most Aware", status: "pending", image: IMAGES.brollUsage },
];

const MOCK_UGC_SCRIPTS = [
  { id: "ug1", title: "The Honest Review", hook: "Okay, I need to talk about this serum because I'm genuinely shocked.", script: "HOOK: Okay, I need to talk about this serum because I'm genuinely shocked.\n\nSETUP: So I've been using Golden Radiance Serum for two weeks now. I was skeptical — I've tried SO many serums.\n\nEXPERIENCE: But the first thing I noticed was the texture. It's like... liquid gold. Literally. And it absorbs in seconds.\n\nRESULT: By day 3, my husband asked if I was wearing makeup. I wasn't. By day 10, the dark spots on my cheeks had visibly faded.\n\nCTA: I'll put the link below. They have a 30-day guarantee so there's literally no risk.", status: "pending" },
  { id: "ug2", title: "The Routine Swap", hook: "POV: You replace your entire serum collection with one product.", script: "HOOK: POV: You replace your entire serum collection with one product.\n\n[Shows bathroom counter with multiple products]\n\nBEFORE: This was my routine. Vitamin C, hyaluronic acid, peptide serum, niacinamide, facial oil. 20 minutes every morning.\n\n[Shows single bottle]\n\nAFTER: Now it's just this. Golden Radiance Serum has all five of those ingredients in one formula.\n\nRESULT: My skin looks better. My routine takes 60 seconds. And I'm saving like $200 a month.\n\nCTA: Link in my bio if you want to simplify your life.", status: "pending" },
  { id: "ug3", title: "The Skeptic", hook: "I don't trust skincare brands. But I trust published research.", script: "HOOK: I don't trust skincare brands. But I trust published research.\n\nSETUP: When Golden Radiance Serum claimed their gold ingredient increases collagen by 89%, I looked up the study. It's real. Published in Nanomedicine, 2012.\n\nTEST: So I tried it. Two weeks, morning and night.\n\nRESULT: The glow is... real. Like, people-commenting-on-it real. And my fine lines around my eyes have visibly softened.\n\nVERDICT: This is the first serum I've used where the science actually matches the results.\n\nCTA: Link below. Do your own research first — they actually encourage it.", status: "pending" },
  { id: "ug4", title: "The Gift Reaction", hook: "My best friend bought me this gold serum and I can't stop using it.", script: "HOOK: My best friend bought me this gold serum and I can't stop using it.\n\nUNBOXING: Look at this packaging. The glass bottle, the gold liquid inside — it feels so luxurious.\n\nUSAGE: Two drops. That's all you need. Watch it absorb... like butter.\n\nRESULT: I've been using it for a week and I swear my skin is glowing. Not in a filter way. In a real way.\n\nCTA: Best gift I've ever received. Link in bio.", status: "pending" },
  { id: "ug5", title: "The Sensitive Skin Convert", hook: "I have the most sensitive skin on the planet. This is the first serum that didn't destroy it.", script: "HOOK: I have the most sensitive skin on the planet. This is the first serum that didn't destroy it.\n\nBACKSTORY: Retinol? Disaster. Vitamin C serums? Burning. AHAs? Don't even get me started.\n\nDISCOVERY: Golden Radiance Serum uses gold nanoparticles instead of harsh actives. They're actually anti-inflammatory.\n\nRESULT: No redness. No stinging. No purging. Just... better skin. After years of my skin rejecting everything, it finally accepted something.\n\nCTA: If you have sensitive skin, try this. 30-day guarantee. Link below.", status: "pending" },
];

const MOCK_LISTICLE_POINTS = [
  { id: "l1", headline: "Clinical-Grade Vitamin C at the Optimal 15% Concentration", body: "While most serums use unstable derivatives at sub-therapeutic levels, Golden Radiance Serum contains 15% L-Ascorbic Acid — the exact concentration shown to reduce hyperpigmentation by 73% in peer-reviewed studies.", approved: false, image: IMAGES.productSerum },
  { id: "l2", headline: "24K Gold That Actually Penetrates (Not Just Marketing)", body: "Colloidal gold nanoparticles — not gold leaf or gold dust — that penetrate the epidermis and stimulate collagen synthesis by 89% according to research published in Nanomedicine.", approved: false, image: IMAGES.brollPresentation },
  { id: "l3", headline: "Triple-Weight Hyaluronic Acid for 72-Hour Hydration", body: "Three molecular weights of HA hydrate at three skin depths simultaneously, delivering 72-hour moisture retention vs. 8-12 hours from standard single-weight formulas.", approved: false, image: IMAGES.brollUsage },
  { id: "l4", headline: "Matrixyl 3000: 45% Wrinkle Reduction Without Retinol Side Effects", body: "This dual-peptide complex stimulates collagen types I, III, and IV production — achieving anti-aging results comparable to retinol without irritation, peeling, or sun sensitivity.", approved: false, image: IMAGES.productShampoo },
  { id: "l5", headline: "Replaces 5 Products in Your Current Routine", body: "Vitamin C + HA + Peptides + Niacinamide + Facial Oil — all in one synergistic formula. Save time, money, and shelf space.", approved: false, image: IMAGES.brollUnboxing },
  { id: "l6", headline: "Visible Results in 3-5 Days (Not 3-5 Months)", body: "The colloidal gold creates immediate light-reflecting radiance from day one, while the actives work on long-term structural improvement beneath the surface.", approved: false, image: IMAGES.productSerum },
  { id: "l7", headline: "4.7 Stars from 2,847 Verified Reviews", body: "68% five-star ratings. The #1 most-mentioned benefit? 'Visible glow within days' — reported by 34% of reviewers independently.", approved: false, image: IMAGES.brollPresentation },
  { id: "l8", headline: "Zero Irritation — Even for Sensitive Skin", body: "Gold's anti-inflammatory properties combined with squalane's barrier-supporting effects make this suitable for even the most reactive skin types.", approved: false, image: IMAGES.brollUsage },
  { id: "l9", headline: "Full Ingredient Transparency", body: "Every concentration published. Every claim cited. No proprietary blends hiding behind vague percentages.", approved: false, image: IMAGES.productShampoo },
  { id: "l10", headline: "The Luxury Experience That Drives Consistency", body: "The glass dropper, visible gold particles, and silky texture transform application into a ritual — and consistency is what delivers results.", approved: false, image: IMAGES.brollUnboxing },
  { id: "l11", headline: "30-Day Money-Back Guarantee", body: "If you don't receive at least one unsolicited compliment on your skin within 30 days, return it for a full refund. No questions asked.", approved: false, image: IMAGES.productSerum },
];

// ============================================================
// COMPONENT
// ============================================================

export default function DFYWorkflowPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Research (now includes angles)
  const [researchApproved, setResearchApproved] = useState(false);
  const [expandedAngle, setExpandedAngle] = useState<string | null>("a1");
  const [expandedAngleSections, setExpandedAngleSections] = useState<Record<string, string[]>>({});
  const [angleSelections, setAngleSelections] = useState<Record<string, boolean>>(
    Object.fromEntries(RESEARCH_ANGLES.map(a => [a.id, true]))
  );

  // Message Testing
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
  const selectedAngles = RESEARCH_ANGLES.filter(a => angleSelections[a.id]);

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

  const toggleAngleSection = (angleId: string, section: string) => {
    setExpandedAngleSections(prev => {
      const current = prev[angleId] || [];
      return { ...prev, [angleId]: current.includes(section) ? current.filter(s => s !== section) : [...current, section] };
    });
  };

  const isAngleSectionOpen = (angleId: string, section: string) => {
    return (expandedAngleSections[angleId] || []).includes(section);
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
  // STEP 1: RESEARCH — single scrollable page, angles-first
  // ============================================================

  const renderResearch = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6 pb-24">
      {/* Header with approve */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Strategic Research — {product?.name}</h2>
          <p className="text-xs text-white/30 mt-1">Full research output including angles, messages, and competitive analysis</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("research")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5"><MessageSquare size={12} /> Feedback</button>
          <button onClick={() => openChat("add angle")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5"><Plus size={12} /> Add Angle</button>
          <button onClick={() => setResearchApproved(true)} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: researchApproved ? "#10B981" : "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            {researchApproved ? <><Check size={12} /> Approved</> : <><ThumbsUp size={12} /> Approve Research</>}
          </button>
        </div>
      </div>

      {/* ===== SECTION: STRATEGIC ANGLES (PRIMARY) ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Target size={16} className="text-cyan-400" />
          <h3 className="text-sm font-mono font-semibold text-cyan-400 uppercase tracking-wider">Strategic Angles</h3>
          <span className="text-[10px] font-mono text-white/20 ml-2">{selectedAngles.length} of {RESEARCH_ANGLES.length} selected</span>
        </div>

        <div className="space-y-3">
          {RESEARCH_ANGLES.map((angle, angleIdx) => {
            const isExpanded = expandedAngle === angle.id;
            const isSelected = angleSelections[angle.id];
            const angleColor = ["#00D4FF", "#A855F7", "#F59E0B", "#10B981", "#F43F5E"][angleIdx % 5];

            return (
              <div key={angle.id} className={`rounded-xl border transition-all ${isSelected ? `border-[${angleColor}]/20` : "border-white/[0.04] opacity-40"}`} style={{ background: "#13161B", borderColor: isSelected ? `${angleColor}33` : undefined }}>
                {/* Angle Header */}
                <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpandedAngle(isExpanded ? null : angle.id)}>
                  <button onClick={(e) => { e.stopPropagation(); setAngleSelections(prev => ({ ...prev, [angle.id]: !prev[angle.id] })); }} className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all`} style={{ borderColor: isSelected ? angleColor : "rgba(255,255,255,0.15)", background: isSelected ? angleColor : "transparent" }}>
                    {isSelected && <Check size={12} className="text-[#0D0F12]" />}
                  </button>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold" style={{ background: `${angleColor}15`, color: angleColor }}>
                    {angleIdx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-white/80">{angle.name}</div>
                    <div className="text-[11px] text-white/30">{angle.tagline}</div>
                  </div>
                  <span className="text-[10px] font-mono text-white/15">{angle.messages.length} messages</span>
                  <button onClick={(e) => { e.stopPropagation(); openChat(`angle: ${angle.name}`); }} className="text-white/10 hover:text-white/30 p-1"><Edit3 size={12} /></button>
                  {isExpanded ? <ChevronUp size={14} className="text-white/20" /> : <ChevronDown size={14} className="text-white/20" />}
                </div>

                {/* Expanded Angle Content */}
                <AnimatePresence>
                  {isExpanded && isSelected && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="px-4 pb-5 border-t border-white/[0.04] pt-4 space-y-3">

                        {/* Angle Description / Analysis */}
                        <div className="rounded-lg border border-white/[0.04] p-4" style={{ background: "#0D0F12" }}>
                          <div className="space-y-3">
                            {[
                              { label: "Primary Root Cause", value: angle.rootCause, color: "#F43F5E" },
                              { label: "Physical Pain / Symptom", value: angle.physicalPain, color: "#F97316" },
                              { label: "Emotional Pain / Gap", value: angle.emotionalPain, color: "#EAB308" },
                              { label: "Failed Solutions", value: angle.failedSolutions, color: "#EF4444" },
                              { label: "New Biological Framing", value: angle.newFraming, color: "#3B82F6" },
                              { label: "Product Solution", value: angle.productSolution, color: "#10B981" },
                              { label: "Competitive Advantage", value: angle.competitiveAdvantage, color: "#06B6D4" },
                            ].map((item) => (
                              <div key={item.label}>
                                <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: `${item.color}99` }}>{item.label}</div>
                                <p className="text-xs text-white/50 leading-relaxed">{item.value}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Audience */}
                        <button onClick={() => toggleAngleSection(angle.id, "audience")} className="w-full flex items-center justify-between rounded-lg border border-white/[0.04] px-4 py-2.5 hover:bg-white/[0.01] transition-all" style={{ background: "#0D0F12" }}>
                          <div className="flex items-center gap-2"><Users size={12} className="text-white/20" /><span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Target Audience</span></div>
                          {isAngleSectionOpen(angle.id, "audience") ? <ChevronUp size={12} className="text-white/15" /> : <ChevronDown size={12} className="text-white/15" />}
                        </button>
                        <AnimatePresence>
                          {isAngleSectionOpen(angle.id, "audience") && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-2">
                              <div className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0A0C0F" }}>
                                <div className="text-[9px] font-mono text-cyan-400/60 uppercase mb-1">Primary Ideal Audience</div>
                                <p className="text-xs text-white/45 leading-relaxed">{angle.primaryAudience}</p>
                              </div>
                              <div className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0A0C0F" }}>
                                <div className="text-[9px] font-mono text-white/20 uppercase mb-1">Secondary Buyer Group</div>
                                <p className="text-xs text-white/45 leading-relaxed">{angle.secondaryAudience}</p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Customer Resonance Statements */}
                        <button onClick={() => toggleAngleSection(angle.id, "resonance")} className="w-full flex items-center justify-between rounded-lg border border-white/[0.04] px-4 py-2.5 hover:bg-white/[0.01] transition-all" style={{ background: "#0D0F12" }}>
                          <div className="flex items-center gap-2"><Quote size={12} className="text-white/20" /><span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Customer Resonance Statements</span><span className="text-[9px] font-mono text-white/15">{angle.resonanceStatements.length}</span></div>
                          {isAngleSectionOpen(angle.id, "resonance") ? <ChevronUp size={12} className="text-white/15" /> : <ChevronDown size={12} className="text-white/15" />}
                        </button>
                        <AnimatePresence>
                          {isAngleSectionOpen(angle.id, "resonance") && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-2">
                              {angle.resonanceStatements.map((stmt, i) => (
                                <div key={i} className="rounded-lg border border-white/[0.04] p-3 flex gap-3" style={{ background: "#0A0C0F" }}>
                                  <Quote size={10} className="text-white/10 shrink-0 mt-1" />
                                  <p className="text-xs text-white/40 italic leading-relaxed">"{stmt}"</p>
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Messages */}
                        <button onClick={() => toggleAngleSection(angle.id, "messages")} className="w-full flex items-center justify-between rounded-lg border border-white/[0.04] px-4 py-2.5 hover:bg-white/[0.01] transition-all" style={{ background: "#0D0F12" }}>
                          <div className="flex items-center gap-2"><MessageSquare size={12} className="text-white/20" /><span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Messages</span><span className="text-[9px] font-mono text-white/15">{angle.messages.length}</span></div>
                          {isAngleSectionOpen(angle.id, "messages") ? <ChevronUp size={12} className="text-white/15" /> : <ChevronDown size={12} className="text-white/15" />}
                        </button>
                        <AnimatePresence>
                          {isAngleSectionOpen(angle.id, "messages") && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-1.5">
                              {angle.messages.map((msg, i) => (
                                <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.04] px-3 py-2" style={{ background: "#0A0C0F" }}>
                                  <span className="text-[10px] font-mono text-white/15 w-5 shrink-0">{i + 1}.</span>
                                  <span className="text-xs text-white/50 flex-1">{msg}</span>
                                  <button onClick={() => openChat(`message ${i + 1} of ${angle.name}`)} className="text-white/10 hover:text-white/30"><Edit3 size={10} /></button>
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Angle Copy */}
                        <button onClick={() => toggleAngleSection(angle.id, "copy")} className="w-full flex items-center justify-between rounded-lg border border-white/[0.04] px-4 py-2.5 hover:bg-white/[0.01] transition-all" style={{ background: "#0D0F12" }}>
                          <div className="flex items-center gap-2"><FileText size={12} className="text-white/20" /><span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Angle Copy</span></div>
                          {isAngleSectionOpen(angle.id, "copy") ? <ChevronUp size={12} className="text-white/15" /> : <ChevronDown size={12} className="text-white/15" />}
                        </button>
                        <AnimatePresence>
                          {isAngleSectionOpen(angle.id, "copy") && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="rounded-lg border border-white/[0.04] p-4" style={{ background: "#0A0C0F" }}>
                                <pre className="text-xs text-white/45 leading-relaxed whitespace-pre-wrap font-sans">{angle.angleCopy}</pre>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== SECTION: PRODUCT CONTEXT ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Product Context</h3>
        </div>
        <div className="rounded-xl border border-white/[0.06] p-5 space-y-3" style={{ background: "#13161B" }}>
          <div><span className="text-[9px] font-mono text-white/20 uppercase block mb-1">Description</span><p className="text-xs text-white/50 leading-relaxed">{RESEARCH_DATA.productContext.description}</p></div>
          <div><span className="text-[9px] font-mono text-white/20 uppercase block mb-1">Primary Purpose</span><p className="text-xs text-white/50 leading-relaxed">{RESEARCH_DATA.productContext.primaryPurpose}</p></div>
          <div className="flex items-center gap-2"><span className="text-[9px] font-mono text-white/20 uppercase">Framework:</span><span className="text-xs text-cyan-400/60 font-mono">{RESEARCH_DATA.productContext.framework}</span></div>
        </div>
      </div>

      {/* ===== SECTION: PRODUCT INPUT ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Package size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Product Input — Extracted Data</h3>
        </div>
        <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
            {[
              { label: "Product", value: RESEARCH_DATA.productInput.productName },
              { label: "Price", value: RESEARCH_DATA.productInput.price },
              { label: "Format", value: RESEARCH_DATA.productInput.format },
              { label: "Serving Size", value: RESEARCH_DATA.productInput.servingSize },
              { label: "Rating", value: `${RESEARCH_DATA.productInput.rating.stars} ★ (${RESEARCH_DATA.productInput.rating.reviews} reviews)` },
              { label: "Source", value: RESEARCH_DATA.productInput.sourceUrl },
            ].map((item, i) => (
              <div key={i} className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                <div className="text-[9px] font-mono text-white/20 uppercase mb-1">{item.label}</div>
                <div className="text-xs text-white/50 break-all">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
            <div className="text-[9px] font-mono text-white/20 uppercase mb-2">Ingredient List</div>
            <div className="space-y-1">
              {RESEARCH_DATA.productInput.ingredients.map((ing, i) => (
                <div key={i} className="flex items-start gap-2 text-xs"><span className="text-white/15 font-mono shrink-0">{i + 1}.</span><span className="text-white/50">{ing.name}</span><span className="text-white/20 italic">— {ing.mechanism}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ===== SECTION: INGREDIENT ANALYSIS ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Beaker size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Deep Ingredient Analysis</h3>
        </div>
        <div className="space-y-3">
          {RESEARCH_DATA.ingredientAnalysis.map((ing, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <div className="flex items-center justify-between mb-2">
                <div><h4 className="text-sm font-medium text-white/70">{ing.name}</h4><div className="text-[10px] font-mono text-cyan-400/50">Active: {ing.active}</div></div>
                <button onClick={() => openChat(`ingredient: ${ing.name}`)} className="text-white/10 hover:text-white/30"><Edit3 size={12} /></button>
              </div>
              <p className="text-xs text-white/45 leading-relaxed">{ing.analysis}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ===== SECTION: COMPETITIVE MAPPING ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Competitive Mapping</h3>
        </div>
        <div className="space-y-3">
          {RESEARCH_DATA.competitiveMapping.map((comp, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <h4 className="text-sm font-medium text-white/70 mb-1">{comp.category}</h4>
              <div className="text-[10px] font-mono text-white/20 mb-3">Examples: {comp.examples}</div>
              <div className="space-y-2">
                <div><span className="text-[9px] font-mono text-red-400/60 uppercase block mb-1">Why They Fail</span><p className="text-xs text-white/40 leading-relaxed">{comp.failures}</p></div>
                <div><span className="text-[9px] font-mono text-green-400/60 uppercase block mb-1">Our Opportunity</span><p className="text-xs text-white/40 leading-relaxed">{comp.opportunity}</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== SECTION: ROOT CAUSES ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Brain size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Root Cause Mapping</h3>
        </div>
        <div className="space-y-3">
          {RESEARCH_DATA.rootCauses.map((rc, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] p-4 flex gap-4" style={{ background: "#13161B" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold shrink-0" style={{ background: "#00D4FF10", color: "#00D4FF" }}>{i + 1}</div>
              <div><h4 className="text-sm font-medium text-white/70 mb-1">{rc.name}</h4><p className="text-xs text-white/45 leading-relaxed">{rc.description}</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== SECTION: CUSTOMER LANGUAGE ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Real-World Customer Language</h3>
        </div>
        <div className="space-y-3">
          {RESEARCH_DATA.customerLanguage.map((cat, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
              <h4 className="text-xs font-mono text-cyan-400/60 uppercase tracking-wider mb-3">{cat.category}</h4>
              <div className="space-y-2">
                {cat.quotes.map((q, j) => (
                  <div key={j} className="rounded-lg border border-white/[0.04] p-3 text-xs text-white/40 italic leading-relaxed flex gap-2" style={{ background: "#0F1115" }}>
                    <Quote size={10} className="text-white/10 shrink-0 mt-0.5" />"{q}"
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== SECTION: REVIEW ANALYSIS ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Heart size={16} className="text-white/30" />
          <h3 className="text-sm font-mono font-semibold text-white/50 uppercase tracking-wider">Review Analysis — {RESEARCH_DATA.reviewAnalysis.totalReviews} Reviews</h3>
        </div>
        <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
          <div className="space-y-3 mb-4">
            {RESEARCH_DATA.reviewAnalysis.themes.map((theme, i) => (
              <div key={i} className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/60">{theme.name}</span>
                  <span className="text-xs font-mono text-cyan-400">{theme.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.04] mb-2"><div className="h-full rounded-full bg-cyan-400/40" style={{ width: `${theme.pct}%` }} /></div>
                <p className="text-[11px] text-white/35 leading-relaxed">{theme.desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-amber-500/20 p-3" style={{ background: "#F59E0B08" }}>
            <div className="text-[9px] font-mono text-amber-400/60 uppercase mb-1">Key Observation</div>
            <p className="text-xs text-white/50 leading-relaxed">{RESEARCH_DATA.reviewAnalysis.keyObservation}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // ============================================================
  // STEP 2: MESSAGE TESTING (embedded flow)
  // ============================================================

  const mtAds = useMemo(() => {
    if (!mtAdsGenerated) return [];
    const imgs = [IMAGES.productSerum, IMAGES.brollPresentation, IMAGES.brollUsage, IMAGES.brollUnboxing, IMAGES.productShampoo];
    return selectedAngles.flatMap((angle, aIdx) =>
      angle.messages.map((msg, idx) => ({
        id: `mt-${angle.id}-${idx}`,
        angleId: angle.id,
        angleName: angle.name,
        message: msg,
        image: imgs[(idx + aIdx) % imgs.length],
      }))
    );
  }, [mtAdsGenerated, selectedAngles]);

  const renderMessageTesting = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6 pb-24">
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
                {selectedTemplate === tmpl.id && <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-cyan-400"><Check size={10} /> Selected</div>}
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
          <div className="sticky top-12 z-20 rounded-xl border border-white/[0.06] p-3 flex items-center justify-between" style={{ background: "#13161Bee", backdropFilter: "blur(8px)" }}>
            <div className="text-xs text-white/40 font-mono">{Object.values(mtApprovals).filter(Boolean).length}/{mtAds.length} ads approved</div>
            <div className="flex gap-2">
              <button onClick={() => { const n: Record<string, boolean> = {}; mtAds.forEach(a => { n[a.id] = true; }); setMtApprovals(n); }} className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 transition-all flex items-center gap-1"><ThumbsUp size={10} /> Approve All</button>
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
                  <div><div className="text-sm font-medium text-white/70">{angle.name}</div><div className="text-[10px] text-white/25">{approvedCount}/{angleAds.length} approved</div></div>
                  <button onClick={() => { const n = { ...mtApprovals }; angleAds.forEach(a => { n[a.id] = true; }); setMtApprovals(n); }} className={`px-3 py-1 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1 transition-all ${allApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"}`} style={!allApproved ? { background: "linear-gradient(135deg, #00D4FF, #0099CC)" } : undefined}>
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
                          <div className="absolute inset-0 flex items-center justify-center p-2"><p className="text-[8px] text-white/70 text-center leading-tight font-medium">{ad.message.slice(0, 60)}...</p></div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => openChat(`ad: ${ad.message.slice(0, 30)}`)} className="flex-1 py-1 rounded text-[8px] font-mono border border-white/[0.06] text-white/25 hover:text-white/50 flex items-center justify-center gap-0.5"><Edit3 size={8} /></button>
                          <button onClick={() => setMtApprovals(prev => ({ ...prev, [ad.id]: !prev[ad.id] }))} className={`flex-1 py-1 rounded text-[8px] font-mono font-semibold flex items-center justify-center gap-0.5 ${isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"}`} style={!isApproved ? { background: "#00D4FF" } : undefined}>
                            {isApproved ? <Check size={8} /> : <ThumbsUp size={8} />}
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
          <p className="text-xs text-white/30">{Object.values(mtApprovals).filter(Boolean).length} ads approved across {selectedAngles.length} angles.</p>
        </div>
      )}
    </motion.div>
  );

  // ============================================================
  // STEP 3: PRODUCE CREATIVES
  // ============================================================

  const CREATIVE_TYPES = [
    { id: "founder", label: "Founder Ads", count: 5, description: "Personal story-driven ads", icon: Megaphone, color: "#00D4FF", items: MOCK_FOUNDER_ADS },
    { id: "mini-vsl", label: "Mini VSLs", count: 3, description: "Short video sales letters", icon: Video, color: "#A855F7", items: MOCK_MINI_VSLS },
    { id: "short-video", label: "Short Video Ads", count: 5, description: "15-30s scroll-stopping clips", icon: Play, color: "#F59E0B", items: MOCK_SHORT_VIDEO_ADS },
    { id: "static-ads", label: "Static Ads", count: 8, description: "By awareness stage", icon: ImagePlus, color: "#10B981", items: MOCK_STATIC_ADS },
    { id: "ugc-scripts", label: "UGC Scripts", count: 5, description: "Authentic creator scripts", icon: Type, color: "#F43F5E", items: MOCK_UGC_SCRIPTS },
  ];

  const renderCreativeDetail = (type: typeof CREATIVE_TYPES[0]) => (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <button onClick={() => setActiveCreativeDetail(null)} className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 mb-4 transition-all"><ArrowLeft size={12} /> Back to all creatives</button>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${type.color}15` }}><type.icon size={18} style={{ color: type.color }} /></div>
        <div><h3 className="text-sm font-semibold text-white/80">{type.label}</h3><div className="text-[10px] text-white/25">{type.items.length} items</div></div>
        <button onClick={() => { const n = { ...creativeItemApprovals }; type.items.forEach(item => { n[item.id] = true; }); setCreativeItemApprovals(n); }} className="ml-auto px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: type.color, color: "#0D0F12" }}><ThumbsUp size={10} /> Approve All</button>
      </div>
      <div className="space-y-3">
        {type.items.map((item: any) => {
          const isApproved = creativeItemApprovals[item.id];
          return (
            <div key={item.id} className={`rounded-xl border p-4 transition-all ${isApproved ? "border-green-500/15" : "border-white/[0.06]"}`} style={{ background: "#13161B" }}>
              <div className="flex gap-4">
                {item.image && (type.id === "founder" || type.id === "short-video" || type.id === "static-ads") && (
                  <div className="w-24 h-24 rounded-lg overflow-hidden shrink-0 bg-white/[0.03]"><img src={item.image} alt="" className="w-full h-full object-cover" /></div>
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-white/70">{item.title}</div>
                      {item.hook && <div className="text-[11px] text-cyan-400/60 italic mt-0.5">Hook: "{item.hook}"</div>}
                      {item.message && !item.hook && <div className="text-[11px] text-cyan-400/60 italic mt-0.5">"{item.message}"</div>}
                      {item.format && <div className="text-[10px] font-mono text-white/15 mt-0.5">{item.format}</div>}
                      {item.duration && <div className="text-[10px] font-mono text-white/15 mt-0.5">Duration: {item.duration}</div>}
                      {item.awarenessStage && <div className="text-[10px] font-mono text-white/15 mt-0.5">Stage: {item.awarenessStage}</div>}
                    </div>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-white/[0.03] text-white/20 border border-white/[0.04]"}`}>{isApproved ? "APPROVED" : "PENDING"}</span>
                  </div>
                  {(item.script || item.description) && (
                    <div className="rounded-lg border border-white/[0.04] p-3 mt-2" style={{ background: "#0D0F12" }}>
                      <pre className="text-[11px] text-white/40 leading-relaxed whitespace-pre-wrap font-sans">{item.script || item.description}</pre>
                    </div>
                  )}
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
      <div className="mt-4 rounded-lg border border-white/[0.06] p-3 flex items-center justify-between" style={{ background: "#0F1115" }}>
        <span className="text-xs text-white/30">{type.items.filter((item: any) => creativeItemApprovals[item.id]).length} / {type.items.length} approved</span>
        {type.items.every((item: any) => creativeItemApprovals[item.id]) && (
          <button onClick={() => { setCreativeApprovals(prev => ({ ...prev, [type.id]: true })); setActiveCreativeDetail(null); }} className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all bg-green-500/10 text-green-400 border border-green-500/20"><Check size={10} /> Mark Complete</button>
        )}
      </div>
    </motion.div>
  );

  const renderCreatives = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Produce Creatives</h2>
          <p className="text-xs text-white/30 mt-1">Review and approve each creative type in detail.</p>
        </div>
        {!creativesGenerated && (
          <button onClick={() => setCreativesGenerated(true)} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}><Sparkles size={12} /> Generate All Creatives</button>
        )}
      </div>
      <AnimatePresence mode="wait">
        {activeCreativeDetail ? renderCreativeDetail(CREATIVE_TYPES.find(t => t.id === activeCreativeDetail)!) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CREATIVE_TYPES.map((type) => {
                const isApproved = creativeApprovals[type.id];
                return (
                  <div key={type.id} className={`rounded-xl border p-5 transition-all ${isApproved ? "border-green-500/20" : "border-white/[0.06]"}`} style={{ background: "#13161B" }}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${type.color}15` }}><type.icon size={18} style={{ color: type.color }} /></div>
                      <div className="flex-1"><div className="text-sm font-medium text-white/70">{type.label}</div><div className="text-[10px] text-white/30">{type.description}</div></div>
                    </div>
                    <div className="flex items-center justify-between mb-3"><span className="text-2xl font-bold font-mono" style={{ color: type.color }}>{type.count}</span><span className="text-[10px] font-mono text-white/20">creatives</span></div>
                    {creativesGenerated ? (
                      <div className="space-y-2">
                        <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden"><div className="h-full rounded-full transition-all duration-1000" style={{ width: isApproved ? "100%" : "0%", background: isApproved ? "#10B981" : type.color }} /></div>
                        <div className="flex gap-2">
                          <button onClick={() => setActiveCreativeDetail(type.id)} className="flex-1 py-1.5 rounded-lg text-[10px] font-mono border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-all flex items-center justify-center gap-1"><Eye size={10} /> Review All</button>
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
                <div className="flex items-center gap-3"><ListChecks size={16} className="text-white/30" /><span className="text-xs text-white/40">{Object.values(creativeApprovals).filter(Boolean).length} / {CREATIVE_TYPES.length} types approved</span></div>
                <div className="text-xs font-mono text-white/20">Total: {CREATIVE_TYPES.reduce((s, t) => s + t.count, 0)} creatives</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // ============================================================
  // STEP 4: LISTICLE
  // ============================================================

  const renderListicle = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Build Listicle</h2>
          <p className="text-xs text-white/30 mt-1">11 reasons why — angle-specific listicle for {selectedAngles[0]?.name}.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("listicle")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5"><MessageSquare size={12} /> Feedback</button>
          <button onClick={() => setListiclePoints(prev => prev.map(p => ({ ...p, approved: true })))} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}><ThumbsUp size={12} /> Approve All</button>
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
                  <button onClick={() => openChat(`listicle #${i + 1}`)} className="text-white/15 hover:text-white/40"><Edit3 size={12} /></button>
                  <button onClick={() => setListiclePoints(prev => prev.map(p => p.id === point.id ? { ...p, approved: !p.approved } : p))} className={`w-5 h-5 rounded border flex items-center justify-center ${point.approved ? "border-green-500 bg-green-500" : "border-white/15"}`}>{point.approved && <Check size={10} className="text-[#0D0F12]" />}</button>
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
  // STEP 5: SPRINT COMPLETE
  // ============================================================

  const renderAnalysis = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10B98120, #10B98105)" }}><BarChart3 size={28} className="text-green-400" /></div>
        <h2 className="text-2xl font-semibold text-white mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Sprint Complete</h2>
        <p className="text-sm text-white/40 max-w-lg mx-auto">The Done For You workflow has been completed.</p>
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
            `Full Strategic Diagnosis Report`,
            `${selectedAngles.length} Angles with 10 Messages Each + Angle Copy`,
            `${selectedAngles.length * 10} Message Testing Ads`,
            "5 Founder Ads with scripts",
            "3 Mini VSLs with full scripts",
            "5 Short Video Ads (15-30s)",
            "8 Static Ads (by awareness stage)",
            "5 UGC Scripts with hooks",
            "11-Point Listicle Page",
          ].map((d, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center"><Check size={10} className="text-green-400" /></div>
              <span className="text-xs text-white/50 flex-1">{d}</span>
              <span className="text-[9px] font-mono text-green-400/60 uppercase">delivered</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3 justify-center">
        <button className="px-6 py-2.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}><Download size={14} /> Export Full Report</button>
        <button className="px-6 py-2.5 rounded-lg text-xs font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-2"><ArrowRight size={14} /> Start Next Sprint</button>
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
      case 2: return messageTestingDone;
      case 3: return Object.values(creativeApprovals).filter(Boolean).length >= 3;
      case 4: return listiclePoints.filter(p => p.approved).length >= 8;
      case 5: return true;
      default: return false;
    }
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0: return renderProductSelect();
      case 1: return renderResearch();
      case 2: return renderMessageTesting();
      case 3: return renderCreatives();
      case 4: return renderListicle();
      case 5: return renderAnalysis();
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
      {currentStep > 0 && currentStep < DFY_STEPS.length - 1 && (
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
          <motion.div initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }} className="fixed top-0 right-0 bottom-0 w-96 z-50 border-l border-white/[0.06] flex flex-col" style={{ background: "#13161B" }}>
            <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
              <div>
                <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider">Feedback</div>
                <div className="text-[10px] text-white/25 mt-0.5 truncate max-w-[250px]">{chatContext}</div>
              </div>
              <button onClick={() => setShowChat(false)} className="text-white/20 hover:text-white/50"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <MessageSquare size={24} className="text-white/10 mx-auto mb-2" />
                  <p className="text-[11px] text-white/20">Describe what you'd like to change.</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`rounded-lg p-3 text-xs leading-relaxed ${msg.role === "user" ? "bg-cyan-500/10 text-cyan-400/80 ml-8" : "bg-white/[0.03] text-white/50 mr-8"}`}>
                  {msg.content}
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-white/[0.06]">
              <div className="flex gap-2">
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSendChat()} placeholder="Describe changes..." className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30" />
                <button onClick={handleSendChat} className="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)" }}><Send size={12} className="text-[#0D0F12]" /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
