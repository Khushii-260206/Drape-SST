"use client";

import { useEffect, useMemo, useState } from "react";
import { loadAssistantReplies, loadChats, type SuggestedReply } from "@/lib/db";
import { extractLooks } from "@/lib/looks";
import type { Chat, ClothingItem } from "@/lib/types";

export type Idea = {
  /** Sorted piece ids — two suggestions with the same pieces are the same idea. */
  key: string;
  name: string;
  itemIds: string[];
  chatId: string;
  chatTitle: string;
  createdAt: number;
};

const MAX_IDEAS = 60;

/**
 * Every outfit the stylist has ever suggested, across all conversations, newest first. They are read straight
 * out of the saved replies (the same way the chat shows them), so nothing extra is stored and they stay in step
 * with your wardrobe: a piece you've since removed simply drops out of the idea.
 */
export function useIdeas(items: ClothingItem[]) {
  const [data, setData] = useState<{ replies: SuggestedReply[]; chats: Chat[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([loadAssistantReplies(), loadChats()])
        .then(([replies, chats]) => {
          if (cancelled) return;
          setData({ replies, chats });
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const ideas = useMemo<Idea[]>(() => {
    if (!data) return [];
    const valid = new Set(items.map((i) => i.id));
    const titles = new Map(data.chats.map((c) => [c.id, c.title]));
    const seen = new Set<string>();
    const out: Idea[] = [];
    // Replies arrive newest first, so the first time we see a set of pieces is its most recent suggestion.
    for (const reply of data.replies) {
      for (const look of extractLooks(reply.content, valid, new Date(reply.createdAt))) {
        const key = [...look.itemIds].sort().join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, name: look.name, itemIds: look.itemIds, chatId: reply.chatId, chatTitle: titles.get(reply.chatId) ?? "A chat", createdAt: reply.createdAt });
        if (out.length >= MAX_IDEAS) return out;
      }
    }
    return out;
  }, [data, items]);

  return { ideas, loading: data === null && !failed, failed };
}
