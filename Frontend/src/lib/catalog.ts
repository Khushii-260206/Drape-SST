import type { CategoryId, ClothingItem } from "./types";

export const CATEGORIES: { id: CategoryId; label: string; emoji: string }[] = [
  { id: "top", label: "Tops", emoji: "👕" },
  { id: "bottom", label: "Bottoms", emoji: "👖" },
  { id: "onepiece", label: "One-pieces", emoji: "👗" },
  { id: "outerwear", label: "Outerwear", emoji: "🧥" },
  { id: "ethnic", label: "Ethnic wear", emoji: "🥻" },
  { id: "footwear", label: "Footwear", emoji: "👟" },
  { id: "accessory", label: "Accessories", emoji: "⌚" },
];

/** `hint` is a short visual cue the AI classifier is shown to tell look-alike pieces apart. */
export type TypeDef = { id: string; label: string; category: CategoryId; hint?: string };

const t = (id: string, label: string, category: CategoryId, hint?: string): TypeDef => ({ id, label, category, hint });

const TYPES: TypeDef[] = [
  // Tops
  t("tshirt", "T-shirt", "top", "knit jersey, crew or V neck, short sleeves, no collar or buttons"),
  t("polo", "Polo", "top", "knit with a fold-down collar and a short button placket"),
  t("shirt", "Casual shirt", "top", "woven, collar and full button front, relaxed or printed"),
  t("button-down", "Button-down shirt", "top", "woven oxford-style shirt with a collar that buttons to the shirt, full button front"),
  t("formal-shirt", "Formal shirt", "top", "crisp woven dress shirt with a stiff collar and cuffs, plain or fine stripes"),
  t("henley", "Henley", "top", "knit, round neck with a short 2-4 button placket, no collar"),
  t("tank", "Tank top / vest", "top", "sleeveless, wide shoulder straps, usually knit"),
  t("camisole", "Camisole", "top", "sleeveless with thin spaghetti straps, light or silky, often lace-trimmed"),
  t("crop-top", "Crop top", "top", "any top cut to end above the waist"),
  t("bodysuit", "Bodysuit", "top", "fitted top in one piece with the bottom closing between the legs"),
  t("sweatshirt", "Sweatshirt", "top", "thick fleece-backed cotton pullover, crew neck, no hood"),
  t("hoodie", "Hoodie", "top", "thick pullover or zip-up with a hood, often a front pocket"),
  t("sweater", "Sweater / pullover", "top", "knitted pullover, thicker than a T-shirt, no buttons or hood"),
  t("cardigan", "Cardigan", "top", "knitted, open or buttoned all the way down the front"),
  t("turtleneck", "Turtleneck", "top", "fitted knit with a high folded neck"),
  t("blouse", "Blouse / top", "top", "loose, soft or drapey woven top, often with a feminine neckline or sleeves"),
  t("tunic", "Tunic", "top", "long loose top that reaches the hips or thighs, worn over leggings or trousers"),
  t("other-top", "Other top", "top"),

  // Bottoms
  t("jeans", "Jeans", "bottom"),
  t("chinos", "Chinos", "bottom"),
  t("trousers", "Formal trousers", "bottom"),
  t("cargo", "Cargo pants", "bottom"),
  t("joggers", "Joggers / track pants", "bottom"),
  t("shorts", "Shorts", "bottom"),
  t("skirt", "Skirt", "bottom"),
  t("leggings", "Leggings", "bottom"),
  t("palazzo", "Palazzo / wide-leg pants", "bottom"),
  t("swim", "Swim shorts / swimwear", "bottom"),
  t("other-bottom", "Other bottom", "bottom"),

  // One-pieces
  t("dress", "Dress", "onepiece"),
  t("jumpsuit", "Jumpsuit", "onepiece"),
  t("coord", "Co-ord set", "onepiece"),
  t("other-onepiece", "Other one-piece", "onepiece"),

  // Outerwear
  t("jacket", "Jacket", "outerwear"),
  t("denim-jacket", "Denim jacket", "outerwear"),
  t("leather-jacket", "Leather jacket", "outerwear"),
  t("bomber", "Bomber jacket", "outerwear"),
  t("blazer", "Blazer", "outerwear"),
  t("coat", "Coat / overcoat", "outerwear"),
  t("puffer", "Puffer jacket", "outerwear"),
  t("windcheater", "Windcheater / raincoat", "outerwear"),
  t("overshirt", "Overshirt / shacket", "outerwear"),
  t("gilet", "Vest / gilet", "outerwear"),
  t("shrug", "Shrug", "outerwear"),
  t("other-outerwear", "Other outerwear", "outerwear"),

  // Ethnic wear
  t("kurta", "Kurta", "ethnic"),
  t("kurta-set", "Kurta set", "ethnic"),
  t("kurti", "Kurti", "ethnic"),
  t("sherwani", "Sherwani", "ethnic"),
  t("nehru-jacket", "Nehru / Modi jacket", "ethnic"),
  t("bandhgala", "Bandhgala", "ethnic"),
  t("pathani", "Pathani suit", "ethnic"),
  t("dhoti", "Dhoti / lungi", "ethnic"),
  t("pyjama", "Churidar / pyjama", "ethnic"),
  t("salwar", "Salwar suit", "ethnic"),
  t("saree", "Saree", "ethnic"),
  t("lehenga", "Lehenga", "ethnic"),
  t("anarkali", "Anarkali", "ethnic"),
  t("dupatta", "Dupatta / stole", "ethnic"),
  t("other-ethnic", "Other ethnic wear", "ethnic"),

  // Footwear
  t("sneakers", "Sneakers", "footwear"),
  t("running-shoes", "Running / sports shoes", "footwear"),
  t("formal-shoes", "Formal shoes", "footwear"),
  t("loafers", "Loafers", "footwear"),
  t("boots", "Boots", "footwear"),
  t("sandals", "Sandals", "footwear"),
  t("slides", "Slides / flip-flops", "footwear"),
  t("heels", "Heels", "footwear"),
  t("flats", "Flats", "footwear"),
  t("mojari", "Mojari / jutti", "footwear"),
  t("other-footwear", "Other footwear", "footwear"),

  // Accessories
  t("watch", "Watch", "accessory"),
  t("belt", "Belt", "accessory"),
  t("cap", "Cap / hat", "accessory"),
  t("beanie", "Beanie", "accessory"),
  t("scarf", "Scarf / muffler", "accessory"),
  t("sunglasses", "Sunglasses", "accessory"),
  t("bag", "Bag / backpack", "accessory"),
  t("wallet", "Wallet", "accessory"),
  t("tie", "Tie / bow tie", "accessory"),
  t("pocket-square", "Pocket square", "accessory"),
  t("jewellery", "Jewellery", "accessory"),
  t("socks", "Socks", "accessory"),
  t("gloves", "Gloves", "accessory"),
  t("other-accessory", "Other accessory", "accessory"),
];

const TYPE_MAP = new Map(TYPES.map((x) => [x.id, x]));

export const TYPES_BY_CATEGORY: Record<CategoryId, TypeDef[]> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.id] = TYPES.filter((x) => x.category === c.id);
    return acc;
  },
  {} as Record<CategoryId, TypeDef[]>
);

export function isKnownType(id: string): boolean {
  return TYPE_MAP.has(id);
}

export function typeLabel(id: string): string {
  return TYPE_MAP.get(id)?.label ?? "Clothing";
}

export function categoryOfType(id: string): CategoryId | undefined {
  return TYPE_MAP.get(id)?.category;
}

export type ColorGroupId = "neutral" | "brown" | "blue" | "green" | "yellow" | "red" | "pink" | "purple" | "metallic" | "pattern";

export const COLOR_GROUPS: { id: ColorGroupId; label: string }[] = [
  { id: "neutral", label: "Neutrals" },
  { id: "brown", label: "Browns & creams" },
  { id: "blue", label: "Blues" },
  { id: "green", label: "Greens" },
  { id: "yellow", label: "Yellows & oranges" },
  { id: "red", label: "Reds" },
  { id: "pink", label: "Pinks" },
  { id: "purple", label: "Purples" },
  { id: "metallic", label: "Metallics" },
  { id: "pattern", label: "Pattern" },
];

/** Stored values are the ids and never change: pieces saved earlier keep working as the palette grows. */
export type ColorDef = { id: string; label: string; hex: string; group: ColorGroupId };

const c = (id: string, label: string, hex: string, group: ColorGroupId): ColorDef => ({ id, label, hex, group });

export const COLORS: ColorDef[] = [
  c("black", "Black", "#111827", "neutral"),
  c("charcoal", "Charcoal", "#374151", "neutral"),
  c("grey", "Grey", "#9ca3af", "neutral"),
  c("light-grey", "Light grey", "#d1d5db", "neutral"),
  c("white", "White", "#ffffff", "neutral"),
  c("off-white", "Off-white", "#f5f1e8", "neutral"),

  c("cream", "Cream", "#fff4d6", "brown"),
  c("beige", "Beige", "#e7d8c0", "brown"),
  c("sand", "Sand", "#d8c3a0", "brown"),
  c("tan", "Tan", "#c8a27a", "brown"),
  c("camel", "Camel", "#b98a4e", "brown"),
  c("khaki", "Khaki", "#b5a26a", "brown"),
  c("taupe", "Taupe", "#8b7d72", "brown"),
  c("brown", "Brown", "#7c4a2d", "brown"),
  c("chocolate", "Chocolate", "#4a2c1d", "brown"),

  c("navy", "Navy", "#1e3a8a", "blue"),
  c("indigo", "Indigo", "#3730a3", "blue"),
  c("blue", "Blue", "#2563eb", "blue"),
  c("denim", "Denim", "#4b6a9b", "blue"),
  c("sky-blue", "Sky blue", "#38bdf8", "blue"),
  c("light-blue", "Light blue", "#93c5fd", "blue"),
  c("powder-blue", "Powder blue", "#cfe3f1", "blue"),
  c("turquoise", "Turquoise", "#22d3c5", "blue"),
  c("teal", "Teal", "#0d9488", "blue"),

  c("green", "Green", "#16a34a", "green"),
  c("forest", "Forest green", "#14532d", "green"),
  c("emerald", "Emerald", "#059669", "green"),
  c("olive", "Olive", "#6b7a2c", "green"),
  c("sage", "Sage", "#9caf88", "green"),
  c("mint", "Mint", "#a7f3d0", "green"),
  c("lime", "Lime", "#a3e635", "green"),

  c("yellow", "Yellow", "#facc15", "yellow"),
  c("mustard", "Mustard", "#d4a017", "yellow"),
  c("peach", "Peach", "#fdba8c", "yellow"),
  c("orange", "Orange", "#f97316", "yellow"),
  c("rust", "Rust", "#b7410e", "yellow"),
  c("terracotta", "Terracotta", "#c9694a", "yellow"),

  c("red", "Red", "#dc2626", "red"),
  c("coral", "Coral", "#fb7185", "red"),
  c("burgundy", "Burgundy", "#6d1a36", "red"),
  c("maroon", "Maroon", "#7f1d1d", "red"),

  c("blush", "Blush", "#fbcfe8", "pink"),
  c("rose", "Rose", "#e8a0b4", "pink"),
  c("pink", "Pink", "#f472b6", "pink"),
  c("hot-pink", "Hot pink", "#ec4899", "pink"),
  c("magenta", "Magenta", "#c026d3", "pink"),

  c("lavender", "Lavender", "#c4b5fd", "purple"),
  c("lilac", "Lilac", "#c8a2c8", "purple"),
  c("mauve", "Mauve", "#a67b9a", "purple"),
  c("purple", "Purple", "#7e22ce", "purple"),
  c("plum", "Plum", "#581c4d", "purple"),

  c("silver", "Silver", "#c0c0c0", "metallic"),
  c("gold", "Gold", "#d4af37", "metallic"),
  c("rose-gold", "Rose gold", "#b76e79", "metallic"),
  c("bronze", "Bronze", "#8c6a3b", "metallic"),

  c("multicolor", "Multicolour / pattern", "#a855f7", "pattern"),
];

const COLOR_MAP = new Map(COLORS.map((c) => [c.id, c]));

export function isKnownColor(id: string): boolean {
  return COLOR_MAP.has(id);
}

export function colorLabel(id: string): string {
  return COLOR_MAP.get(id)?.label ?? id;
}

export function colorHex(id: string): string {
  return COLOR_MAP.get(id)?.hex ?? "#d1d5db";
}

/** "Navy T-shirt", "Black + white Hoodie", or just "Watch" when no colour is set. */
export function itemTitle(item: Pick<ClothingItem, "type" | "colors">): string {
  const colors = item.colors.map(colorLabel);
  const prefix = colors.length ? `${colors.join(" + ")} ` : "";
  return `${prefix}${typeLabel(item.type)}`;
}
