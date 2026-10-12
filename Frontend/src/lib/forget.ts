import { clearCache } from "./cache";
import { clearRecognitionCache } from "./recognize";
import { resetChatSync } from "./db";
import { clearIdentity } from "./identity";
import { forgetAllPhotos } from "./photos";
import { savePlace } from "./weather";

/*
 * What this browser remembers about the signed-in person, as opposed to the device: cached wardrobe/chat/profile data,
 * signed photo links, the display name and photo, which chat was open, the saved city and its forecast, and which
 * account that cache belonged to. Called when the session ends or the account changes.
 *
 * Deliberately NOT cleared: the theme, the provider cooldowns, and AI keys pasted under Settings. Those describe this
 * device rather than the account, and Settings -> "Remove key" is how a key is deleted.
 */
export const ACTIVE_CHAT_KEY = "drape:active-chat";
export const LAST_USER_KEY = "drape:last-user";

export function forgetAccountState(): void {
  clearCache();
  clearRecognitionCache();
  forgetAllPhotos();
  clearIdentity();
  savePlace(null);
  resetChatSync();
  try {
    localStorage.removeItem(ACTIVE_CHAT_KEY);
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // storage blocked: nothing was remembered either
  }
}

/**
 * Called (from an effect in AuthGate, see gate.ts) with the id of whoever is signed in. If this browser last held a different account, what that account left
 * behind goes before anything can read it; the same account again changes nothing, so repeating the call is harmless.
 * The very first sign-in on a browser keeps the display name and city (there is no earlier account to protect).
 */
export function forgetPreviousAccount(userId: string): void {
  try {
    const last = localStorage.getItem(LAST_USER_KEY);
    if (last === userId) return;
    clearCache();
    clearRecognitionCache();
    forgetAllPhotos();
    resetChatSync();
    if (last) {
      clearIdentity();
      savePlace(null);
      localStorage.removeItem(ACTIVE_CHAT_KEY);
    }
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    // storage blocked: nothing was remembered either
  }
}
