"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isProfile, readCache, writeCache } from "@/lib/cache";
import { loadProfile, saveProfile } from "@/lib/db";
import { cleanName, saveIdentity, useIdentity } from "@/lib/identity";
import { EMPTY_PROFILE } from "@/lib/profile";
import type { Profile } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";

type ProfileContextValue = {
  profile: Profile;
  ready: boolean;
  save: SaveState;
  /**
   * Changes some fields; saved to the database a moment after you stop typing. The name is the exception: it
   * belongs to this device (see lib/identity.ts) and is never written to the database. Pass a function to build the
   * change from the latest profile (needed for toggles, so two quick taps never overwrite each other).
   */
  update: (patch: Partial<Profile> | ((latest: Profile) => Partial<Profile>)) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}

const SAVE_DELAY_MS = 700;

export function ProfileProvider({ children }: { children: ReactNode }) {
  const identity = useIdentity();
  const [stored, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [ready, setReady] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const ref = useRef<Profile>(EMPTY_PROFILE);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache("profile", isProfile);
    if (cached) {
      queueMicrotask(() => {
        if (cancelled || dirtyRef.current) return;
        ref.current = cached;
        setProfile(cached);
        setReady(true);
      });
    }
    loadProfile()
      .then((p) => {
        // Don't clobber something the user already started typing while this loaded.
        if (cancelled || dirtyRef.current) return;
        ref.current = p;
        setProfile(p);
        writeCache("profile", p);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSave("saving");
    try {
      await saveProfile(ref.current);
      // Edits made while that request was in flight will have set dirty again and scheduled their own save.
      if (!dirtyRef.current) setSave("saved");
    } catch {
      dirtyRef.current = true;
      setSave("error");
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Profile> | ((latest: Profile) => Partial<Profile>)) => {
      const { name, ...rest } = typeof patch === "function" ? patch(ref.current) : patch;
      // A new name goes to this device's identity, not to the shared profile row.
      if (name !== undefined && cleanName(name)) saveIdentity({ name });
      ref.current = { ...ref.current, ...rest };
      setProfile(ref.current);
      writeCache("profile", ref.current);
      dirtyRef.current = true;
      setSave("idle");
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush]
  );

  // Don't lose the last edit when the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  // Everywhere in the app the name is the one chosen on this device.
  const profile = useMemo(() => ({ ...stored, name: identity?.name ?? "" }), [stored, identity?.name]);
  const value = useMemo(() => ({ profile, ready, save, update }), [profile, ready, save, update]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
