export type CategoryId =
  | "top"
  | "bottom"
  | "onepiece"
  | "outerwear"
  | "ethnic"
  | "footwear"
  | "accessory";

export type Side = "front" | "back";

export type ClothingItem = {
  id: string;
  type: string;
  category: CategoryId;
  /** Up to two colour ids from the catalog; the first is the main colour. */
  colors: string[];
  description: string;
  hasBack: boolean;
  /** Starred pieces. */
  favorite: boolean;
  /** How many times it has been marked as worn. */
  wearCount: number;
  /** When it was last marked as worn (ms since epoch), or null if never. */
  lastWorn: number | null;
  createdAt: number;
  /** Bumped when the piece or its photos change; photo URLs are keyed by it. Favouriting/wearing does not bump it. */
  updatedAt: number;
};

/** The person using the app. Every field is optional ("" / null / [] when unset). */
export type Profile = {
  name: string;
  age: number | null;
  gender: "" | "man" | "woman" | "nonbinary";
  heightCm: number | null;
  weightKg: number | null;
  build: "" | "slim" | "athletic" | "average" | "broad" | "curvy" | "plus";
  shoulders: "" | "narrow" | "average" | "broad";
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  shoeSize: string;
  skinTone: "" | "fair" | "light" | "medium" | "olive" | "tan" | "brown" | "deep";
  undertone: "" | "warm" | "cool" | "neutral";
  hair: string;
  fit: "" | "slim" | "regular" | "relaxed" | "oversized";
  vibes: string[];
  /** Colour ids from the catalog. */
  favoriteColors: string[];
  avoidColors: string[];
  budget: "" | "budget" | "mid" | "premium";
  lifestyle: string;
  notes: string;
  /** A short AI-written summary of their style, editable by them. */
  persona: string;
  personaAt: number | null;
};

/** A saved look: a named set of wardrobe pieces. */
export type Outfit = {
  id: string;
  name: string;
  itemIds: string[];
  note: string;
  createdAt: number;
  wornCount: number;
  lastWorn: number | null;
};

export type Provider = "gemini" | "groq" | "openrouter";

export type AppSettings = {
  /** The provider whose card is selected in Settings; also the first one used when rotation is off. */
  provider: Provider;
  /** Spread requests across every provider that has a key (default on). */
  rolling: boolean;
  keys: Partial<Record<Provider, string>>;
  models: Partial<Record<Provider, string>>;
};

/** One conversation with the stylist. */
export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  /** Last message time; the list is sorted by it. */
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** True while the reply is still streaming in (never persisted). */
  pending?: boolean;
  /** Set when the reply failed; `content` may still hold a partial answer. */
  error?: string;
  /** Why it failed (e.g. "auth" for a rejected key), so the UI can offer the right fix. */
  errorKind?: string;
  /** The model that actually produced the reply. */
  model?: string;
};
