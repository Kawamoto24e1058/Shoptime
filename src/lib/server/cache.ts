export interface AIAnalysis {
    alcohol_status: string;
    alcohol_note: string; // New
    hero_feature: string; // New
    ai_insight: string;
    best_for: string;
    lo_risk: string;
    mood: string;
    score: number; // New
    recommendedMenu: string; // New
    hasAlcohol: boolean; // New
    tags: string[]; // New
    drinking_score: number; // New
}

// In-memory cache for AI analysis
export const aiCache = new Map<string, AIAnalysis>();
