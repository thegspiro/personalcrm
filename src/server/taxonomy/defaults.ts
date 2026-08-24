import type { TaxonomyKind } from "@prisma/client";

/**
 * Starter taxonomies provisioned for every new account.
 *
 * These are seeds, not constants: they land in the database as ordinary
 * TaxonomyTerm rows the user can rename, recolor, reorder, deactivate, or add
 * to. Nothing in the app should branch on a specific slug — look terms up by
 * kind and let the user's list drive the UI.
 */
export interface TaxonomySeed {
  slug: string;
  label: string;
  icon?: string;
  color?: string;
  /** Slug of the reciprocal term, for RELATIONSHIP_TYPE. */
  inverse?: string;
  metadata?: Record<string, unknown>;
}

export const TAXONOMY_SEEDS: Record<TaxonomyKind, TaxonomySeed[]> = {
  CONTACT_CATEGORY: [
    { slug: "family", label: "Family", icon: "Home", color: "rose" },
    { slug: "close-friend", label: "Close friend", icon: "Heart", color: "pink" },
    { slug: "friend", label: "Friend", icon: "Users", color: "violet" },
    { slug: "acquaintance", label: "Acquaintance", icon: "UserRound", color: "slate" },
    { slug: "colleague", label: "Colleague", icon: "Briefcase", color: "blue" },
    { slug: "professional", label: "Professional", icon: "BadgeCheck", color: "cyan" },
    { slug: "neighbor", label: "Neighbor", icon: "MapPin", color: "emerald" },
    { slug: "romantic", label: "Romantic", icon: "Flame", color: "red" },
  ],

  CONTACT_METHOD_TYPE: [
    { slug: "mobile", label: "Mobile", icon: "Smartphone", color: "emerald" },
    { slug: "home-phone", label: "Home phone", icon: "Phone", color: "emerald" },
    { slug: "work-phone", label: "Work phone", icon: "PhoneCall", color: "emerald" },
    { slug: "email", label: "Email", icon: "Mail", color: "blue" },
    { slug: "instagram", label: "Instagram", icon: "Instagram", color: "pink" },
    { slug: "signal", label: "Signal", icon: "MessageSquare", color: "indigo" },
    { slug: "whatsapp", label: "WhatsApp", icon: "MessageCircle", color: "green" },
    { slug: "telegram", label: "Telegram", icon: "Send", color: "sky" },
    { slug: "snapchat", label: "Snapchat", icon: "Ghost", color: "yellow" },
    { slug: "discord", label: "Discord", icon: "MessagesSquare", color: "violet" },
    { slug: "linkedin", label: "LinkedIn", icon: "Linkedin", color: "blue" },
    { slug: "x", label: "X", icon: "AtSign", color: "slate" },
    { slug: "facebook", label: "Facebook", icon: "Facebook", color: "blue" },
    { slug: "website", label: "Website", icon: "Globe", color: "cyan" },
  ],

  INTERACTION_TYPE: [
    { slug: "text", label: "Text", icon: "MessageSquare", color: "sky" },
    { slug: "call", label: "Call", icon: "Phone", color: "emerald" },
    { slug: "video-call", label: "Video call", icon: "Video", color: "teal" },
    { slug: "coffee", label: "Coffee", icon: "Coffee", color: "amber" },
    { slug: "meal", label: "Meal", icon: "UtensilsCrossed", color: "orange" },
    { slug: "drinks", label: "Drinks", icon: "Wine", color: "rose" },
    { slug: "hangout", label: "Hangout", icon: "Users", color: "violet" },
    { slug: "date", label: "Date", icon: "Heart", color: "red" },
    { slug: "event", label: "Event", icon: "PartyPopper", color: "fuchsia" },
    { slug: "trip", label: "Trip", icon: "Plane", color: "cyan" },
    { slug: "activity", label: "Activity", icon: "Bike", color: "lime" },
    { slug: "email", label: "Email", icon: "Mail", color: "blue" },
    { slug: "ran-into", label: "Ran into", icon: "Footprints", color: "slate" },
    { slug: "gift", label: "Gift", icon: "Gift", color: "pink" },
  ],

  FACT_CATEGORY: [
    { slug: "preference", label: "Likes", icon: "ThumbsUp", color: "emerald" },
    { slug: "dislike", label: "Dislikes", icon: "ThumbsDown", color: "rose" },
    { slug: "family", label: "Family", icon: "Home", color: "pink" },
    { slug: "work", label: "Work", icon: "Briefcase", color: "blue" },
    { slug: "health", label: "Health", icon: "HeartPulse", color: "red" },
    { slug: "hobby", label: "Hobbies", icon: "Palette", color: "violet" },
    { slug: "food-drink", label: "Food & drink", icon: "UtensilsCrossed", color: "orange" },
    { slug: "media", label: "Music & media", icon: "Music", color: "fuchsia" },
    { slug: "goal", label: "Goals", icon: "Target", color: "amber" },
    { slug: "story", label: "Stories", icon: "BookOpen", color: "cyan" },
    { slug: "pet", label: "Pets", icon: "PawPrint", color: "lime" },
    { slug: "logistics", label: "Logistics", icon: "MapPin", color: "slate" },
  ],

  DATE_TYPE: [
    { slug: "birthday", label: "Birthday", icon: "Cake", color: "pink" },
    { slug: "anniversary", label: "Anniversary", icon: "Heart", color: "rose" },
    { slug: "work-anniversary", label: "Work anniversary", icon: "Briefcase", color: "blue" },
    { slug: "wedding", label: "Wedding", icon: "Church", color: "violet" },
    { slug: "graduation", label: "Graduation", icon: "GraduationCap", color: "amber" },
    { slug: "memorial", label: "Remembrance", icon: "Flower2", color: "slate" },
    { slug: "sobriety", label: "Sobriety", icon: "Sparkles", color: "emerald" },
    { slug: "moved", label: "Moved", icon: "Truck", color: "cyan" },
    { slug: "other", label: "Other", icon: "Calendar", color: "slate" },
  ],

  /**
   * Relationship types. The family terms carry `metadata` the rest of the app
   * reads instead of hardcoding slugs:
   *
   * - `family: true` puts the term in the Family section and the family tree.
   * - `tier` groups it there: immediate · extended · in-law · step · chosen ·
   *   former, the last being relationships that have ended without the person
   *   leaving your life.
   * - `generation` is the referent's generation relative to the subject —
   *   positive is older ("B is A's parent" → +1), so the tree can band rows.
   * - `role` is a stable semantic key. Inference (src/server/services/
   *   family-suggestions.ts) matches on it, so renaming "Parent" to "Papá"
   *   keeps working and a term the user invents simply gets no inference.
   */
  RELATIONSHIP_TYPE: [
    { slug: "partner", label: "Partner", inverse: "partner", icon: "Heart", color: "rose",
      metadata: { family: true, tier: "immediate", generation: 0, role: "spouse" } },
    { slug: "spouse", label: "Spouse", inverse: "spouse", icon: "Heart", color: "red",
      metadata: { family: true, tier: "immediate", generation: 0, role: "spouse" } },
    { slug: "ex-partner", label: "Ex-partner", inverse: "ex-partner", icon: "HeartCrack", color: "slate" },
    { slug: "parent", label: "Parent", inverse: "child", icon: "Users", color: "amber",
      metadata: { family: true, tier: "immediate", generation: 1, role: "parent" } },
    { slug: "child", label: "Child", inverse: "parent", icon: "Baby", color: "amber",
      metadata: { family: true, tier: "immediate", generation: -1, role: "child" } },
    { slug: "sibling", label: "Sibling", inverse: "sibling", icon: "Users", color: "orange",
      metadata: { family: true, tier: "immediate", generation: 0, role: "sibling" } },
    { slug: "grandparent", label: "Grandparent", inverse: "grandchild", icon: "Users", color: "yellow",
      metadata: { family: true, tier: "extended", generation: 2, role: "grandparent" } },
    { slug: "grandchild", label: "Grandchild", inverse: "grandparent", icon: "Users", color: "yellow",
      metadata: { family: true, tier: "extended", generation: -2, role: "grandchild" } },
    { slug: "aunt-uncle", label: "Aunt / uncle", inverse: "niece-nephew", icon: "Users", color: "amber",
      metadata: { family: true, tier: "extended", generation: 1, role: "aunt-uncle" } },
    { slug: "niece-nephew", label: "Niece / nephew", inverse: "aunt-uncle", icon: "Baby", color: "amber",
      metadata: { family: true, tier: "extended", generation: -1, role: "niece-nephew" } },
    { slug: "cousin", label: "Cousin", inverse: "cousin", icon: "Users", color: "orange",
      metadata: { family: true, tier: "extended", generation: 0, role: "cousin" } },
    { slug: "parent-in-law", label: "Parent-in-law", inverse: "child-in-law", icon: "Users", color: "teal",
      metadata: { family: true, tier: "inlaw", generation: 1, role: "parent-in-law" } },
    { slug: "child-in-law", label: "Child-in-law", inverse: "parent-in-law", icon: "Users", color: "teal",
      metadata: { family: true, tier: "inlaw", generation: -1, role: "child-in-law" } },
    { slug: "sibling-in-law", label: "Sibling-in-law", inverse: "sibling-in-law", icon: "Users", color: "teal",
      metadata: { family: true, tier: "inlaw", generation: 0, role: "sibling-in-law" } },
    { slug: "stepparent", label: "Stepparent", inverse: "stepchild", icon: "Users", color: "lime",
      metadata: { family: true, tier: "step", generation: 1, role: "stepparent" } },
    { slug: "stepchild", label: "Stepchild", inverse: "stepparent", icon: "Baby", color: "lime",
      metadata: { family: true, tier: "step", generation: -1, role: "stepchild" } },
    { slug: "stepsibling", label: "Stepsibling", inverse: "stepsibling", icon: "Users", color: "lime",
      metadata: { family: true, tier: "step", generation: 0, role: "stepsibling" } },
    { slug: "half-sibling", label: "Half-sibling", inverse: "half-sibling", icon: "Users", color: "lime",
      metadata: { family: true, tier: "step", generation: 0, role: "half-sibling" } },
    { slug: "godparent", label: "Godparent", inverse: "godchild", icon: "Sparkles", color: "violet",
      metadata: { family: true, tier: "chosen", generation: 1, role: "godparent" } },
    { slug: "godchild", label: "Godchild", inverse: "godparent", icon: "Sparkles", color: "violet",
      metadata: { family: true, tier: "chosen", generation: -1, role: "godchild" } },
    { slug: "chosen-family", label: "Chosen family", inverse: "chosen-family", icon: "HeartHandshake", color: "fuchsia",
      metadata: { family: true, tier: "chosen", generation: 0, role: "chosen-family" } },
    { slug: "ex-spouse", label: "Ex-spouse", inverse: "ex-spouse", icon: "HeartCrack", color: "slate",
      metadata: { family: true, tier: "former", generation: 0, role: "ex-spouse" } },
    { slug: "ex-parent-in-law", label: "Ex-parent-in-law", inverse: "ex-child-in-law", icon: "Users", color: "slate",
      metadata: { family: true, tier: "former", generation: 1, role: "ex-parent-in-law" } },
    { slug: "ex-child-in-law", label: "Ex-child-in-law", inverse: "ex-parent-in-law", icon: "Users", color: "slate",
      metadata: { family: true, tier: "former", generation: -1, role: "ex-child-in-law" } },
    { slug: "ex-sibling-in-law", label: "Ex-sibling-in-law", inverse: "ex-sibling-in-law", icon: "Users", color: "slate",
      metadata: { family: true, tier: "former", generation: 0, role: "ex-sibling-in-law" } },
    { slug: "ex-stepparent", label: "Ex-stepparent", inverse: "ex-stepchild", icon: "Users", color: "slate",
      metadata: { family: true, tier: "former", generation: 1, role: "ex-stepparent" } },
    { slug: "ex-stepchild", label: "Ex-stepchild", inverse: "ex-stepparent", icon: "Users", color: "slate",
      metadata: { family: true, tier: "former", generation: -1, role: "ex-stepchild" } },
    { slug: "ex-stepsibling", label: "Ex-stepsibling", inverse: "ex-stepsibling", icon: "Users", color: "slate",
      metadata: { family: true, tier: "former", generation: 0, role: "ex-stepsibling" } },
    { slug: "friend", label: "Friend", inverse: "friend", icon: "Users", color: "violet" },
    { slug: "roommate", label: "Roommate", inverse: "roommate", icon: "Home", color: "emerald" },
    { slug: "coworker", label: "Coworker", inverse: "coworker", icon: "Briefcase", color: "blue" },
    { slug: "manager", label: "Manager", inverse: "report", icon: "UserCog", color: "indigo" },
    { slug: "report", label: "Report", inverse: "manager", icon: "UserRound", color: "indigo" },
    { slug: "mutual-friend", label: "Mutual friend", inverse: "mutual-friend", icon: "Link", color: "cyan" },
  ],

  DATING_STAGE: [
    { slug: "interested", label: "Interested", icon: "Eye", color: "slate", metadata: { pipelineOrder: 1 } },
    { slug: "matched", label: "Matched", icon: "Sparkles", color: "cyan", metadata: { pipelineOrder: 2 } },
    { slug: "talking", label: "Talking", icon: "MessageSquare", color: "sky", metadata: { pipelineOrder: 3 } },
    { slug: "first-date-planned", label: "Date planned", icon: "CalendarHeart", color: "violet", metadata: { pipelineOrder: 4 } },
    { slug: "dating", label: "Dating", icon: "Heart", color: "pink", metadata: { pipelineOrder: 5 } },
    { slug: "exclusive", label: "Exclusive", icon: "HeartHandshake", color: "rose", metadata: { pipelineOrder: 6 } },
    { slug: "paused", label: "Paused", icon: "PauseCircle", color: "amber", metadata: { pipelineOrder: 7 } },
    { slug: "ended", label: "Ended", icon: "HeartCrack", color: "slate", metadata: { pipelineOrder: 8, terminal: true } },
  ],

  DATE_ACTIVITY_TYPE: [
    { slug: "coffee", label: "Coffee", icon: "Coffee", color: "amber" },
    { slug: "drinks", label: "Drinks", icon: "Wine", color: "rose" },
    { slug: "dinner", label: "Dinner", icon: "UtensilsCrossed", color: "orange" },
    { slug: "lunch", label: "Lunch", icon: "Sandwich", color: "yellow" },
    { slug: "walk", label: "Walk", icon: "Footprints", color: "emerald" },
    { slug: "activity", label: "Activity", icon: "Bike", color: "lime" },
    { slug: "movie", label: "Movie", icon: "Film", color: "violet" },
    { slug: "concert", label: "Concert", icon: "Music", color: "fuchsia" },
    { slug: "trip", label: "Trip", icon: "Plane", color: "cyan" },
    { slug: "at-home", label: "At home", icon: "Home", color: "pink" },
    { slug: "other", label: "Other", icon: "CircleDot", color: "slate" },
  ],

  MEETING_SOURCE: [
    { slug: "hinge", label: "Hinge", icon: "Smartphone", color: "violet", metadata: { dating: true } },
    { slug: "bumble", label: "Bumble", icon: "Smartphone", color: "amber", metadata: { dating: true } },
    { slug: "tinder", label: "Tinder", icon: "Smartphone", color: "red", metadata: { dating: true } },
    { slug: "feeld", label: "Feeld", icon: "Smartphone", color: "rose", metadata: { dating: true } },
    { slug: "coffee-meets-bagel", label: "Coffee Meets Bagel", icon: "Smartphone", color: "orange", metadata: { dating: true } },
    { slug: "in-person", label: "In person", icon: "Users", color: "emerald" },
    { slug: "mutual-friend", label: "Through a friend", icon: "Link", color: "cyan" },
    { slug: "work", label: "Work", icon: "Briefcase", color: "blue" },
    { slug: "school", label: "School", icon: "GraduationCap", color: "indigo" },
    { slug: "event", label: "Event", icon: "PartyPopper", color: "fuchsia" },
    { slug: "gym", label: "Gym", icon: "Dumbbell", color: "lime" },
    { slug: "neighborhood", label: "Neighborhood", icon: "MapPin", color: "teal" },
    { slug: "online", label: "Online", icon: "Globe", color: "sky" },
    { slug: "other", label: "Other", icon: "CircleDot", color: "slate" },
  ],

LIFE_EVENT_TYPE: [
    { slug: "new-job", label: "New job", icon: "Briefcase", color: "blue" },
    { slug: "promotion", label: "Promotion", icon: "TrendingUp", color: "indigo" },
    { slug: "left-job", label: "Left a job", icon: "LogOut", color: "slate" },
    { slug: "started-business", label: "Started a business", icon: "Rocket", color: "violet" },
    { slug: "retired", label: "Retired", icon: "Palmtree", color: "teal" },
    { slug: "moved", label: "Moved", icon: "Truck", color: "cyan" },
    { slug: "bought-home", label: "Bought a home", icon: "Home", color: "emerald" },
    { slug: "graduated", label: "Graduated", icon: "GraduationCap", color: "amber" },
    { slug: "started-school", label: "Started school", icon: "BookOpen", color: "yellow" },
    { slug: "engaged", label: "Got engaged", icon: "Gem", color: "pink" },
    { slug: "married", label: "Got married", icon: "Church", color: "rose" },
    { slug: "separated", label: "Separated or divorced", icon: "HeartCrack", color: "slate" },
    { slug: "new-baby", label: "New baby", icon: "Baby", color: "fuchsia" },
    { slug: "new-pet", label: "New pet", icon: "PawPrint", color: "lime" },
    { slug: "bereavement", label: "Loss in the family", icon: "Flower2", color: "slate" },
    { slug: "illness", label: "Health event", icon: "HeartPulse", color: "red" },
    { slug: "sobriety", label: "Got sober", icon: "Sparkles", color: "emerald" },
    { slug: "big-trip", label: "Big trip", icon: "Plane", color: "sky" },
    { slug: "award", label: "Award or recognition", icon: "Award", color: "amber" },
    { slug: "other", label: "Other", icon: "CircleDot", color: "slate" },
  ],

  GIFT_OCCASION: [
    { slug: "birthday", label: "Birthday", icon: "Cake", color: "pink" },
    { slug: "holiday", label: "Holiday", icon: "Gift", color: "red" },
    { slug: "anniversary", label: "Anniversary", icon: "Heart", color: "rose" },
    { slug: "just-because", label: "Just because", icon: "Sparkles", color: "violet" },
    { slug: "housewarming", label: "Housewarming", icon: "Home", color: "emerald" },
    { slug: "wedding", label: "Wedding", icon: "Church", color: "fuchsia" },
    { slug: "graduation", label: "Graduation", icon: "GraduationCap", color: "amber" },
    { slug: "thank-you", label: "Thank you", icon: "HandHeart", color: "cyan" },
  ],
};

export const TAXONOMY_KIND_LABELS: Record<TaxonomyKind, { title: string; description: string }> = {
  CONTACT_CATEGORY: { title: "Contact categories", description: "How you group the people in your life." },
  CONTACT_METHOD_TYPE: { title: "Contact methods", description: "Phone, email, and social handles you store." },
  INTERACTION_TYPE: { title: "Interaction types", description: "The kinds of moments you log." },
  FACT_CATEGORY: { title: "Fact categories", description: "How the things you know about someone are grouped." },
  DATE_TYPE: { title: "Important date types", description: "Birthdays, anniversaries, and the rest." },
  RELATIONSHIP_TYPE: { title: "Relationship types", description: "How people connect to each other." },
  DATING_STAGE: { title: "Dating stages", description: "The columns of your dating pipeline." },
  DATE_ACTIVITY_TYPE: { title: "Date activities", description: "What you did on a date." },
  MEETING_SOURCE: { title: "Meeting sources", description: "Where you met someone — apps included." },
  GIFT_OCCASION: { title: "Gift occasions", description: "Why a gift was given." },
  LIFE_EVENT_TYPE: { title: "Life events", description: "Things that happen in someone's life." },
};

/** Ordered for the settings UI. */
export const TAXONOMY_KIND_ORDER: TaxonomyKind[] = [
  "CONTACT_CATEGORY",
  "INTERACTION_TYPE",
  "FACT_CATEGORY",
  "DATE_TYPE",
  "RELATIONSHIP_TYPE",
  "CONTACT_METHOD_TYPE",
  "MEETING_SOURCE",
  "GIFT_OCCASION",
  "LIFE_EVENT_TYPE",
  "DATING_STAGE",
  "DATE_ACTIVITY_TYPE",
];
