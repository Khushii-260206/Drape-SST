"use client";

import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { daysBetween } from "@/lib/time";
import type { Chat } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChat } from "../ChatProvider";
import { useToast } from "../Toaster";
import { Modal } from "../ui/Modal";

function groupLabel(updatedAt: number): string {
  const d = daysBetween(updatedAt);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return "This week";
  if (d < 31) return "This month";
  return "Older";
}

function when(updatedAt: number): string {
  const date = new Date(updatedAt);
  return daysBetween(updatedAt) <= 0
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Every conversation you've had with the stylist, newest first. Tap one to pick it back up. */
export function ChatHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Your chats" className="sm:max-w-md">
      {open && <Body onClose={onClose} />}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const { chats, activeId, streaming, newChat, openChat, removeChat } = useChat();
  const toast = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);

  async function remove(chat: Chat) {
    try {
      await removeChat(chat.id);
      toast(`Deleted “${chat.title}”`);
    } catch {
      toast("Couldn't delete that chat. Check your connection.", "error");
    } finally {
      setConfirming(null);
    }
  }

  const groups: { label: string; chats: Chat[] }[] = [];
  for (const chat of chats) {
    const label = groupLabel(chat.updatedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.chats.push(chat);
    else groups.push({ label, chats: [chat] });
  }

  return (
    <div className="p-4 sm:p-5">
      <button
        type="button"
        disabled={streaming}
        onClick={() => {
          newChat();
          onClose();
        }}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-50"
      >
        <Plus className="size-4" aria-hidden /> New chat
      </button>
      {streaming && <p className="mt-2 text-center text-xs text-gray-500">Wait for the reply to finish, or press stop, to switch chats.</p>}

      {chats.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-gray-500">Your conversations will be saved here.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="mb-1.5 px-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">{g.label}</h3>
              <ul className="space-y-1">
                {g.chats.map((chat) => {
                  const active = chat.id === activeId;
                  return (
                    <li key={chat.id} className={cn("flex items-center gap-1 rounded-2xl pr-1.5 transition", active ? "bg-brand-50" : "hover:bg-gray-50")}>
                      <button
                        type="button"
                        disabled={streaming && !active}
                        onClick={() => {
                          void openChat(chat.id);
                          onClose();
                        }}
                        aria-current={active ? "true" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 text-left focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none disabled:opacity-50"
                      >
                        <MessageCircle className={cn("size-4 shrink-0", active ? "text-brand-600" : "text-gray-400")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900">{chat.title}</span>
                          <span className="block text-xs text-gray-500">{when(chat.updatedAt)}</span>
                        </span>
                      </button>
                      {confirming === chat.id ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs">
                          <button type="button" onClick={() => void remove(chat)} className="rounded-full bg-red-600 px-3 py-1.5 font-semibold text-white">
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} className="rounded-full px-2.5 py-1.5 text-gray-600 hover:bg-gray-100">
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(chat.id)}
                          disabled={streaming && active}
                          aria-label={`Delete “${chat.title}”`}
                          className="flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
