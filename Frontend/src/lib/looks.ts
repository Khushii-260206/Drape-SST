/*
 * Finding outfits inside the stylist's replies. A "look" is any list, table or paragraph that cites two or
 * more of your pieces as [[id]]; the heading (or a bold title line) above it names it. The chat uses this to
 * show photos and a Save button, and the Outfits page uses it to collect every suggestion from every chat.
 * Pure functions (no React) so they can be unit-tested.
 */

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "hr" }
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; text: string };

const BULLET = /^(\s*)([-*•])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function isBlockStart(line: string, next?: string): boolean {
  const t = line.trim();
  return (
    !t ||
    t.startsWith("```") ||
    HEADING.test(line) ||
    HR.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next))
  );
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "h", text: heading[1].trim() });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = BULLET.exec(l) ?? NUMBERED.exec(l);
        if (m) {
          items.push({ text: m[3], depth: Math.min(2, Math.floor(m[1].replace(/\t/g, "  ").length / 2)) });
          i++;
        } else if (items.length && l.trim() && /^\s{2,}\S/.test(l)) {
          items[items.length - 1].text += ` ${l.trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !(buf.length > 0 && isBlockStart(lines[i], lines[i + 1]))) {
      buf.push(lines[i++]);
    }
    blocks.push({ kind: "p", text: buf.join("\n") });
  }

  return blocks;
}

export const ID_PATTERN = /[0-9a-f]{8}/gi;

/** Every wardrobe id cited in [[...]] tokens, lowercased, in order (with repeats). */
export function idsIn(text: string): string[] {
  const out: string[] = [];
  for (const token of text.match(/\[\[[^\]\n]*\]\]/g) ?? []) {
    for (const id of token.match(ID_PATTERN) ?? []) out.push(id.toLowerCase());
  }
  return out;
}

/** The nearest heading (or standalone bold title line) at or above each block — it names the look under it. */
export function headingsFor(blocks: Block[]): (string | null)[] {
  return blocks.reduce<(string | null)[]>((acc, b, i) => {
    const title =
      b.kind === "h"
        ? b.text
        : b.kind === "p" && /^\*\*[^*\n]{3,60}\*\*:?$/.test(b.text.trim())
          ? b.text.trim().replace(/^\*\*|\*\*:?$/g, "")
          : null;
    acc.push(title ?? (i > 0 ? acc[i - 1] : null));
    return acc;
  }, []);
}

/** A good default name for a look: the bold label the stylist gave it ("**Smart casual**"), else a dated one. */
export function lookName(raw: string, heading: string | null, when: Date = new Date()): string {
  // Only a real title counts: "**Top:**"-style labels inside the look are the pieces, not its name.
  const bold = /\*\*([^*\n:]{6,60}?)\*\*(?!:)/.exec(raw.replace(/\[\[[^\]\n]*\]\]/g, ""));
  const pick = (heading ?? bold?.[1] ?? "")
    .replace(/\[\[[^\]\n]*\]\]/g, "")
    .replace(/^(look|outfit)\s*\d*\s*[:\-–—]?\s*/i, "")
    .replace(/[:\s]+$/, "")
    .trim();
  if (pick.length >= 3) return pick.slice(0, 50);
  return `Look · ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

export type Look = { name: string; itemIds: string[] };

/** The looks in one reply: each block that cites at least two pieces you still own. */
export function extractLooks(text: string, valid: ReadonlySet<string>, when: Date = new Date()): Look[] {
  const blocks = parseBlocks(text);
  const headings = headingsFor(blocks);
  const looks: Look[] = [];
  blocks.forEach((block, i) => {
    let raw: string;
    if (block.kind === "list") raw = block.items.map((it) => it.text).join("\n");
    else if (block.kind === "table") raw = [...block.header, ...block.rows.flat()].join("\n");
    else if (block.kind === "p") raw = block.text;
    else return;
    const ids = Array.from(new Set(idsIn(raw))).filter((id) => valid.has(id));
    if (ids.length >= 2) looks.push({ name: lookName(raw, headings[i], when), itemIds: ids });
  });
  return looks;
}
