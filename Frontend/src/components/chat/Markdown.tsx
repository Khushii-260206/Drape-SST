"use client";

import { Check, Bookmark } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { itemTitle, typeLabel } from "@/lib/catalog";
import { useItemImage } from "@/lib/hooks";
import { headingsFor, ID_PATTERN, idsIn, lookName, parseBlocks } from "@/lib/looks";
import type { ClothingItem } from "@/lib/types";
import { useItemViewer } from "../ItemViewer";
import { useOutfits } from "../OutfitsProvider";
import { useToast } from "../Toaster";
import { useWardrobe } from "../WardrobeProvider";
import { onPhotoError } from "@/lib/photos";

/*
 * A small, dependency-free markdown renderer for the stylist's replies. Everything is rendered as
 * React nodes (never raw HTML), so model output can't inject markup. The special token [[id]] is
 * turned into a tappable photo chip for that wardrobe piece; unknown ids are silently dropped.
 */

// ----------------------------------------------------------------- piece chips

function PieceChip({ item }: { item: ClothingItem }) {
  const url = useItemImage(item, "front", "thumb");
  const open = useItemViewer();
  return (
    <button
      type="button"
      onClick={() => open(item.id)}
      title="View photos"
      className="mx-0.5 my-0.5 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pr-2.5 pl-1 align-middle text-[0.85em] font-medium text-brand-800 ring-1 ring-brand-200 transition ring-inset hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
    >
      <span className="size-5 shrink-0 overflow-hidden rounded-full bg-brand-100">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} onError={onPhotoError} alt="" className="size-full object-cover" />
        )}
      </span>
      <span className="truncate">{itemTitle(item)}</span>
    </button>
  );
}

function PieceCard({ item }: { item: ClothingItem }) {
  const url = useItemImage(item, "front", "thumb");
  const open = useItemViewer();
  return (
    <button type="button" onClick={() => open(item.id)} className="group w-[78px] text-left focus-visible:outline-none">
      <span className="block aspect-[4/5] overflow-hidden rounded-xl bg-gray-100 ring-1 ring-gray-200 transition group-hover:ring-brand-300 group-focus-visible:ring-2 group-focus-visible:ring-brand-400">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} onError={onPhotoError} alt={itemTitle(item)} className="size-full object-cover" />
        )}
      </span>
      <span className="mt-1 block truncate text-[11px] font-medium text-gray-600">{typeLabel(item.type)}</span>
    </button>
  );
}

// ----------------------------------------------------------------- inline

const INLINE =
  /(\[\[[^\]\n]*\]\]|\*\*[^*\n]+?\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*\n]*?\*)/g;

type Lookup = Map<string, ClothingItem>;

function renderInline(text: string, lookup: Lookup, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith("[[")) {
      const found = (token.match(ID_PATTERN) ?? [])
        .map((id) => lookup.get(id.toLowerCase()))
        .filter((x): x is ClothingItem => Boolean(x));
      nodes.push(
        ...found.map((item, idx) => <PieceChip key={`${key}-${idx}`} item={item} />)
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-gray-900">
          {renderInline(token.slice(2, -2), lookup, key)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      nodes.push(
        m ? (
          <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline underline-offset-2">
            {m[1]}
          </a>
        ) : (
          token
        )
      );
    } else {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), lookup, key)}</em>);
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Inline-renders text, honouring newlines and the literal <br> tags models like to put in table cells. */
function withLineBreaks(text: string, lookup: Lookup, keyPrefix: string): ReactNode[] {
  return text.replace(/<br\s*\/?>/gi, "\n").split("\n").flatMap((line, i) => [
    i > 0 ? <br key={`${keyPrefix}-br-${i}`} /> : null,
    <Fragment key={`${keyPrefix}-l-${i}`}>{renderInline(line, lookup, `${keyPrefix}-${i}`)}</Fragment>,
  ]);
}

// ----------------------------------------------------------------- component

export function plainTextFor(text: string, items: ClothingItem[]): string {
  const lookup = new Map(items.map((i) => [i.id.toLowerCase(), i]));
  return text.replace(/\[\[[^\]\n]*\]\]/g, (token) => {
    const names = (token.match(ID_PATTERN) ?? [])
      .map((id) => lookup.get(id.toLowerCase()))
      .filter((x): x is ClothingItem => Boolean(x))
      .map(itemTitle);
    return names.join(", ");
  });
}

function SaveLook({ ids, name }: { ids: string[]; name: string }) {
  const { saveLook, findLook } = useOutfits();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const saved = Boolean(findLook(ids));

  async function save() {
    setBusy(true);
    try {
      const { existed, outfit } = await saveLook({ name, itemIds: ids });
      toast(existed ? `Already saved as “${outfit.name}”` : `Saved “${outfit.name}” to Outfits`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save that look.", "error");
    } finally {
      setBusy(false);
    }
  }

  return saved ? (
    <Link
      href="/outfits/"
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100"
    >
      <Check className="size-3.5" aria-hidden /> Saved — view in Outfits
    </Link>
  ) : (
    <button
      type="button"
      onClick={save}
      disabled={busy}
      className="inline-flex min-h-8 items-center gap-1.5 btn-secondary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
    >
      <Bookmark className="size-3.5 text-blush-600" aria-hidden /> Save look
    </button>
  );
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { items } = useWardrobe();
  const lookup = useMemo<Lookup>(() => new Map(items.map((i) => [i.id.toLowerCase(), i])), [items]);

  // While streaming, hide a half-typed [[id marker instead of flashing it as raw text.
  const visible = streaming ? text.replace(/\[\[[^\]]*\]?$/, "") : text;
  const blocks = useMemo(() => parseBlocks(visible), [visible]);

  function strip(raw: string, key: string, heading: string | null = null) {
    const unique = Array.from(new Set(idsIn(raw)))
      .map((id) => lookup.get(id))
      .filter((x): x is ClothingItem => Boolean(x));
    if (unique.length < 2) return null;
    return (
      <div key={`${key}-strip`} className="mt-2 mb-1 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          {unique.map((item) => (
            <PieceCard key={item.id} item={item} />
          ))}
        </div>
        {!streaming && <SaveLook ids={unique.map((u) => u.id)} name={lookName(raw, heading)} />}
      </div>
    );
  }

  // The most recent heading above a block names the look underneath it.
  const headingFor = useMemo(() => headingsFor(blocks), [blocks]);

  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]">
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.kind) {
          case "h":
            return (
              <h4 key={key} className="pt-1 text-[15px] font-semibold text-gray-900">
                {withLineBreaks(block.text, lookup, key)}
              </h4>
            );
          case "hr":
            return <hr key={key} className="border-gray-200" />;
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-xl bg-gray-100 p-3 font-mono text-xs">
                {block.text}
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            const raw = block.items.map((it) => it.text).join("\n");
            return (
              <Fragment key={key}>
                <Tag className={block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
                  {block.items.map((it, ii) => (
                    <li key={ii} style={it.depth ? { marginLeft: it.depth * 16 } : undefined}>
                      {withLineBreaks(it.text, lookup, `${key}-${ii}`)}
                    </li>
                  ))}
                </Tag>
                {strip(raw, key, headingFor[bi])}
              </Fragment>
            );
          }
          case "table": {
            const raw = [...block.header, ...block.rows.flat()].join("\n");
            return (
              <Fragment key={key}>
                <div className="overflow-x-auto rounded-xl ring-1 ring-gray-200">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        {block.header.map((h, hi) => (
                          <th key={hi} className="px-3 py-2 font-semibold">
                            {withLineBreaks(h, lookup, `${key}-h${hi}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, ri) => (
                        <tr key={ri} className="border-t border-gray-100">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 align-top">
                              {withLineBreaks(cell, lookup, `${key}-${ri}-${ci}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {strip(raw, key, headingFor[bi])}
              </Fragment>
            );
          }
          default:
            return (
              <Fragment key={key}>
                <p>{withLineBreaks(block.text, lookup, key)}</p>
                {strip(block.text, key, headingFor[bi])}
              </Fragment>
            );
        }
      })}
    </div>
  );
}
