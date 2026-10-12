"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isChatList, isMessageList, readCache, writeCache } from "@/lib/cache";
import { createChat, deleteChat, loadChat, loadChats, renameChat as renameChatRow, saveChat, touchChat } from "@/lib/db";
import { LlmError, streamChatAny, type LlmMessage } from "@/lib/llm";
import { profileForPrompt } from "@/lib/profile";
import { buildSystemPrompt, toLlmHistory } from "@/lib/prompt";
import { getConfigChain, getRolling } from "@/lib/settings";
import type { Chat, ChatMessage } from "@/lib/types";
import { ACTIVE_CHAT_KEY } from "@/lib/forget";
import { newId } from "@/lib/utils";
import { loadWeather, readPlace, weatherForPrompt } from "@/lib/weather";
import { useProfile } from "./ProfileProvider";
import { useWardrobe } from "./WardrobeProvider";

type ChatContextValue = {
  /** The open conversation's messages. */
  messages: ChatMessage[];
  /** Every conversation, most recent first. */
  chats: Chat[];
  /** The open conversation, or null for a fresh one that hasn't been started yet. */
  activeId: string | null;
  ready: boolean;
  streaming: boolean;
  send: (text: string) => void;
  stop: () => void;
  regenerate: () => void;
  /** Starts a blank conversation; the old one stays in your history. */
  newChat: () => void;
  openChat: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  /** Deletes every conversation. */
  clear: () => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

const ACTIVE_KEY = ACTIVE_CHAT_KEY;

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage blocked: the chat list still works, it just won't remember which one was open
  }
}

/** A conversation's title: the first thing you asked, tidied and shortened. */
function titleFrom(text: string): string {
  const clean = text.replace(/\[\[[^\]\n]*\]\]/g, "").replace(/\s+/g, " ").trim();
  return (clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean) || "New chat";
}

/** Lives above the pages, so a reply keeps streaming if you switch tabs mid-answer. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { items } = useWardrobe();
  const { profile } = useProfile();
  const itemsRef = useRef(items);
  const aboutRef = useRef("");
  useEffect(() => {
    itemsRef.current = items;
    aboutRef.current = profileForPrompt(profile);
  }, [items, profile]);

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const chatsRef = useRef<Chat[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  /** Saves run one after another so a late reply never overtakes the question that came before it. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Set once you send something, so a slow first load never wipes out what you just typed. */
  const touchedRef = useRef(false);

  const commit = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const setChatList = useCallback((next: Chat[]) => {
    chatsRef.current = next;
    setChats(next);
    writeCache("chats", next);
  }, []);

  const activate = useCallback((id: string | null) => {
    chatIdRef.current = id;
    setActiveId(id);
    writeActive(id);
  }, []);

  const tell = useCallback(() => {
    try {
      channelRef.current?.postMessage("chat");
    } catch {
      // channel closed
    }
  }, []);

  /** Saves the open conversation (without any half-streamed reply), lifts it to the top of the list, and tells other tabs. */
  const persist = useCallback(() => {
    const chatId = chatIdRef.current;
    if (!chatId) return;
    const snapshot = messagesRef.current;
    writeCache(`chat:${chatId}`, snapshot.filter((m) => !m.pending));
    chainRef.current = chainRef.current
      .then(() => saveChat(chatId, snapshot))
      .then(() => touchChat(chatId))
      .then(() => {
        const now = Date.now();
        const list = chatsRef.current;
        const current = list.find((c) => c.id === chatId);
        if (current) setChatList([{ ...current, updatedAt: now }, ...list.filter((c) => c.id !== chatId)]);
        tell();
      })
      .catch(() => {});
  }, [setChatList, tell]);

  /** Picks up changes made in another tab or device — but never while this tab is mid-reply. */
  const reload = useCallback(async () => {
    if (streamingRef.current) return;
    try {
      const list = await loadChats();
      if (streamingRef.current) return;
      if (JSON.stringify(list) !== JSON.stringify(chatsRef.current)) setChatList(list);
      const id = chatIdRef.current;
      if (!id) return;
      if (!list.some((c) => c.id === id)) {
        // The open conversation was deleted elsewhere.
        activate(null);
        commit([]);
        return;
      }
      const fresh = await loadChat(id);
      if (streamingRef.current) return;
      const sig = (ms: ChatMessage[]) => JSON.stringify(ms.map((m) => [m.id, m.content.length, m.error ?? ""]));
      if (sig(fresh) !== sig(messagesRef.current)) commit(fresh);
    } catch {
      // offline — keep what we have
    }
  }, [activate, commit, setChatList]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("drape-chat-sync");
      channel.onmessage = (e) => {
        if (e.data === "chat") void reload();
      };
      channelRef.current = channel;
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
      channelRef.current = null;
    };
  }, [reload]);

  // First load: the conversation list, then the one that was open last (or the most recent).
  useEffect(() => {
    let cancelled = false;
    // Show the conversation list and the open chat from last time at once; the network copy follows.
    const cachedChats = readCache("chats", isChatList);
    if (cachedChats) {
      queueMicrotask(() => {
        if (cancelled || touchedRef.current) return;
        chatsRef.current = cachedChats;
        setChats(cachedChats);
        const id = cachedChats.find((c) => c.id === readActive())?.id ?? cachedChats[0]?.id ?? null;
        if (id) {
          activate(id);
          const cachedMessages = readCache(`chat:${id}`, isMessageList);
          if (cachedMessages) commit(cachedMessages);
        }
        setReady(true);
      });
    }
    (async () => {
      try {
        const list = await loadChats();
        if (cancelled) return;
        setChatList(list);
        if (touchedRef.current) return;
        const wanted = readActive();
        const id = list.find((c) => c.id === wanted)?.id ?? list[0]?.id ?? null;
        if (id) {
          const first = await loadChat(id);
          if (cancelled || touchedRef.current) return;
          activate(id);
          commit(first);
          writeCache(`chat:${id}`, first.filter((m) => !m.pending));
        }
      } catch {
        // offline or not set up: start with an empty chat
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activate, commit, setChatList]);

  /** Creates the conversation row for the first message of a new chat. */
  const startChat = useCallback(
    (firstText: string): string => {
      const now = Date.now();
      const chat: Chat = { id: newId(chatsRef.current.map((c) => c.id)), title: titleFrom(firstText), createdAt: now, updatedAt: now };
      activate(chat.id);
      setChatList([chat, ...chatsRef.current]);
      // The messages reference this row, so their save waits for it.
      chainRef.current = chainRef.current.then(() => createChat(chat)).catch(() => {});
      return chat.id;
    },
    [activate, setChatList]
  );

  /** Streams a reply to `history` (which must end with a user message). */
  const run = useCallback(
    async (history: ChatMessage[]) => {
      touchedRef.current = true;
      if (!chatIdRef.current) startChat(history[0]?.content ?? "");

      const assistantId = newId(history.map((m) => m.id));
      const configs = getConfigChain();
      if (configs.length === 0) {
        commit([
          ...history,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: Date.now(),
            error: "Add your free API key in Settings to start chatting.",
            errorKind: "auth",
          },
        ]);
        persist();
        return;
      }

      commit([...history, { id: assistantId, role: "assistant", content: "", createdAt: Date.now(), pending: true }]);
      streamingRef.current = true;
      // Save right away so a reload mid-reply keeps the question (the unfinished reply is never stored).
      persist();
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      // Today's weather (if the user set a city) — never worth waiting more than a couple of seconds for.
      let weatherLine: string | undefined;
      try {
        const limit = new AbortController();
        const timer = setTimeout(() => limit.abort(), 2500);
        const weather = await loadWeather(readPlace(), limit.signal);
        clearTimeout(timer);
        if (weather) weatherLine = weatherForPrompt(weather);
      } catch {
        // no weather is fine
      }

      const llmMessages: LlmMessage[] = [
        { role: "system", content: buildSystemPrompt(itemsRef.current, new Date(), weatherLine, aboutRef.current) },
        ...toLlmHistory(history),
      ];

      let text = "";
      let model: string | undefined;
      let failure: string | undefined;
      let failureKind: string | undefined;
      let flushTimer: ReturnType<typeof setTimeout> | undefined;

      const patch = (changes: Partial<ChatMessage>) =>
        commit(messagesRef.current.map((m) => (m.id === assistantId ? { ...m, ...changes } : m)));
      // A timer (not requestAnimationFrame) so updates keep flowing even in a background tab.
      const flush = () => {
        flushTimer = undefined;
        patch({ content: text, model });
      };

      try {
        for await (const event of streamChatAny(configs, llmMessages, controller.signal, getRolling())) {
          if (event.type === "model") {
            model = event.model;
          } else {
            text += event.text;
            if (flushTimer === undefined) flushTimer = setTimeout(flush, 60);
          }
        }
        if (!text.trim()) {
          failure = "The model sent back an empty reply. Try again, or pick another model in Settings.";
        }
      } catch (e) {
        if (!(e instanceof LlmError && e.kind === "aborted")) {
          failure = e instanceof Error ? e.message : "Something went wrong.";
          failureKind = e instanceof LlmError ? e.kind : undefined;
        }
      } finally {
        if (flushTimer !== undefined) clearTimeout(flushTimer);
        abortRef.current = null;
        streamingRef.current = false;
        setStreaming(false);
      }

      const finalText = text.trim();
      if (!finalText && !failure) {
        // Stopped before anything arrived: drop the empty placeholder.
        commit(messagesRef.current.filter((m) => m.id !== assistantId));
      } else {
        patch({ content: finalText, model, pending: false, error: failure, errorKind: failureKind });
      }
      persist();
    },
    [commit, persist, startChat]
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || streamingRef.current) return;
      const user: ChatMessage = {
        id: newId(messagesRef.current.map((m) => m.id)),
        role: "user",
        content,
        createdAt: Date.now(),
      };
      void run([...messagesRef.current, user]);
    },
    [run]
  );

  const regenerate = useCallback(() => {
    if (streamingRef.current) return;
    const history = [...messagesRef.current];
    while (history.length && history[history.length - 1].role === "assistant") history.pop();
    if (history.length) void run(history);
  }, [run]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    if (streamingRef.current) return;
    activate(null);
    commit([]);
  }, [activate, commit]);

  const openChat = useCallback(
    async (id: string) => {
      if (streamingRef.current || id === chatIdRef.current) return;
      try {
        const loaded = await loadChat(id);
        if (streamingRef.current) return;
        activate(id);
        commit(loaded);
      } catch {
        // couldn't load it; stay where we are
      }
    },
    [activate, commit]
  );

  const removeChat = useCallback(
    async (id: string) => {
      if (streamingRef.current && id === chatIdRef.current) return;
      await deleteChat(id);
      const rest = chatsRef.current.filter((c) => c.id !== id);
      setChatList(rest);
      if (id === chatIdRef.current) {
        const next = rest[0];
        if (next) {
          activate(next.id);
          commit(await loadChat(next.id).catch(() => []));
        } else {
          activate(null);
          commit([]);
        }
      }
      tell();
    },
    [activate, commit, setChatList, tell]
  );

  const renameChat = useCallback(
    async (id: string, title: string) => {
      const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!clean) return;
      await renameChatRow(id, clean);
      setChatList(chatsRef.current.map((c) => (c.id === id ? { ...c, title: clean } : c)));
      tell();
    },
    [setChatList, tell]
  );

  const clear = useCallback(async () => {
    abortRef.current?.abort();
    await Promise.all(chatsRef.current.map((c) => deleteChat(c.id)));
    setChatList([]);
    activate(null);
    commit([]);
    tell();
  }, [activate, commit, setChatList, tell]);

  const value = useMemo(
    () => ({ messages, chats, activeId, ready, streaming, send, stop, regenerate, newChat, openChat, removeChat, renameChat, clear }),
    [messages, chats, activeId, ready, streaming, send, stop, regenerate, newChat, openChat, removeChat, renameChat, clear]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
