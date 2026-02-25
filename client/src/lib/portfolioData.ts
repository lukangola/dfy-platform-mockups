export interface Brand {
  id: string;
  name: string;
  logo: string;
  productUrl: string;
  category: string;
  startDate: string;
  currentStep: number;
  stepStatuses: Record<number, StepStatus>;
  health: 'on-track' | 'attention' | 'blocked';
  weekNumber: number;
  totalWeeks: number;
  keyMetrics?: {
    adsLaunched?: number;
    winningAngle?: string;
    creativesProduced?: number;
    roas?: number;
  };
}

export type StepStatus = 'completed' | 'active' | 'testing' | 'review' | 'pending';

export interface StepTimeline {
  stepId: number;
  title: string;
  shortTitle: string;
  icon: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
}

export const mockBrands: Brand[] = [
  {
    id: "acme-supplements",
    name: "Acme Supplements",
    logo: "💊",
    productUrl: "https://acmesupplements.com/joint-relief",
    category: "Health & Wellness",
    startDate: "2026-01-15",
    currentStep: 2,
    stepStatuses: { 0: 'completed', 1: 'completed', 2: 'testing', 3: 'pending', 4: 'pending', 5: 'pending' },
    health: 'on-track',
    weekNumber: 3,
    totalWeeks: 6,
    keyMetrics: {
      adsLaunched: 12,
      winningAngle: undefined,
      creativesProduced: 0,
    },
  },
  {
    id: "glow-skincare",
    name: "Glow Skincare Co.",
    logo: "✨",
    productUrl: "https://glowskincare.com/serum",
    category: "Beauty & Skincare",
    startDate: "2026-02-01",
    currentStep: 4,
    stepStatuses: { 0: 'completed', 1: 'completed', 2: 'completed', 3: 'completed', 4: 'active', 5: 'pending' },
    health: 'on-track',
    weekNumber: 5,
    totalWeeks: 6,
    keyMetrics: {
      adsLaunched: 45,
      winningAngle: "The 30-Second Night Routine",
      creativesProduced: 87,
      roas: 3.2,
    },
  },
  {
    id: "peak-fitness",
    name: "Peak Fitness Gear",
    logo: "🏋️",
    productUrl: "https://peakfitness.com/resistance-bands",
    category: "Fitness & Sports",
    startDate: "2026-02-10",
    currentStep: 1,
    stepStatuses: { 0: 'completed', 1: 'active', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending' },
    health: 'on-track',
    weekNumber: 2,
    totalWeeks: 6,
  },
  {
    id: "zen-sleep",
    name: "ZenSleep",
    logo: "🌙",
    productUrl: "https://zensleep.com/weighted-blanket",
    category: "Home & Sleep",
    startDate: "2026-01-20",
    currentStep: 3,
    stepStatuses: { 0: 'completed', 1: 'completed', 2: 'completed', 3: 'review', 4: 'pending', 5: 'pending' },
    health: 'attention',
    weekNumber: 4,
    totalWeeks: 6,
    keyMetrics: {
      adsLaunched: 24,
      winningAngle: "Why You Can't Sleep",
      creativesProduced: 42,
    },
  },
  {
    id: "pure-coffee",
    name: "Pure Origin Coffee",
    logo: "☕",
    productUrl: "https://pureorigincoffee.com/subscription",
    category: "Food & Beverage",
    startDate: "2026-02-18",
    currentStep: 0,
    stepStatuses: { 0: 'active', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending' },
    health: 'on-track',
    weekNumber: 1,
    totalWeeks: 6,
  },
];

export const stepNames = [
  { id: 0, title: "Set Up Infrastructure & Optimize Status Quo", shortTitle: "Infrastructure", icon: "⚙️" },
  { id: 1, title: "Conduct Research & Brief B-Roll", shortTitle: "Research", icon: "🔍" },
  { id: 2, title: "Message Testing & Winning Angle", shortTitle: "Message Testing", icon: "💬" },
  { id: 3, title: "Produce 100 Creatives", shortTitle: "Creative Production", icon: "🎨" },
  { id: 4, title: "Build Listicle", shortTitle: "Listicle", icon: "📋" },
  { id: 5, title: "Analyze Results & Consult", shortTitle: "Analysis", icon: "📊" },
];

export const messageTestingCreatives = [
  {
    id: "mt-1",
    angle: "The Hidden Root Cause",
    message: "Your joint pain isn't from aging — it's from a protein deficiency 93% of doctors miss.",
    imageUrl: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=400&h=400&fit=crop",
    status: 'testing' as const,
    metrics: { spend: 42.50, clicks: 89, ctr: 3.8, cpc: 0.42 },
  },
  {
    id: "mt-2",
    angle: "The Hidden Root Cause",
    message: "The real reason your joints hurt has nothing to do with cartilage wear.",
    imageUrl: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=400&h=400&fit=crop",
    status: 'testing' as const,
    metrics: { spend: 38.20, clicks: 72, ctr: 3.1, cpc: 0.53 },
  },
  {
    id: "mt-3",
    angle: "Why Nothing Else Worked",
    message: "Glucosamine failed you. Here's what actually repairs damaged joints.",
    imageUrl: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=400&h=400&fit=crop",
    status: 'testing' as const,
    metrics: { spend: 45.00, clicks: 78, ctr: 2.9, cpc: 0.58 },
  },
  {
    id: "mt-4",
    angle: "Why Nothing Else Worked",
    message: "If joint supplements haven't worked, you've been targeting the wrong problem.",
    imageUrl: "https://images.unsplash.com/photo-1585435557343-3b092031a831?w=400&h=400&fit=crop",
    status: 'testing' as const,
    metrics: { spend: 40.10, clicks: 65, ctr: 2.5, cpc: 0.62 },
  },
  {
    id: "mt-5",
    angle: "Doctor's Secret",
    message: "The supplement orthopedic surgeons take themselves — but never recommend to patients.",
    imageUrl: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=400&h=400&fit=crop",
    status: 'testing' as const,
    metrics: { spend: 36.80, clicks: 58, ctr: 2.2, cpc: 0.63 },
  },
  {
    id: "mt-6",
    angle: "Doctor's Secret",
    message: "Board-certified doctors are switching to this joint solution. Big Pharma isn't happy.",
    imageUrl: "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=400&h=400&fit=crop",
    status: 'testing' as const,
    metrics: { spend: 44.30, clicks: 70, ctr: 2.7, cpc: 0.63 },
  },
];
