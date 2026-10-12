"use client";

import { CircleAlert, Loader2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DeleteAccountError, deleteAccount } from "@/lib/auth";
import { forgetAccountState } from "@/lib/forget";
import { Modal } from "../ui/Modal";

const FIELD =
  "w-full rounded-xl border border-gray-200 bg-surface px-3.5 py-2.5 text-base shadow-sm transition placeholder:text-gray-400 focus:border-red-400 focus:ring-4 focus:ring-red-100 focus:outline-none sm:text-sm";

function Body({ email, onClose }: { email: string; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toUpperCase() === "DELETE" && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return; // one request at a time
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      forgetAccountState(); // the account is gone: nothing of it stays in this browser. The gate now shows the sign-in screen.
    } catch (err) {
      setError(err instanceof DeleteAccountError || err instanceof Error ? err.message : "Couldn't delete the account.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 p-5">
      <p className="text-sm leading-relaxed text-gray-700">
        This permanently deletes <strong className="font-semibold">{email || "your account"}</strong> and:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
        <li>every piece in your wardrobe and all of its photos,</li>
        <li>your saved outfits, stylist chats and profile,</li>
        <li>your sign-in. You&apos;d have to create a new account to use Drape again.</li>
      </ul>
      <p className="text-sm text-gray-700">
        There is no undo and no way for anyone to recover it. If you might want it later, export a backup first (Settings → Your data).
      </p>

      <div>
        <label htmlFor="delete-password" className="mb-1.5 block text-sm font-medium text-gray-800">
          Your password
        </label>
        <input id="delete-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={FIELD} disabled={busy} />
      </div>
      <div>
        <label htmlFor="delete-confirm" className="mb-1.5 block text-sm font-medium text-gray-800">
          Type <span className="font-mono font-semibold">DELETE</span> to confirm
        </label>
        <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} className={FIELD} disabled={busy} />
      </div>

      {error && (
        <p id="delete-error" role="alert" className="flex items-start gap-1.5 text-sm text-red-700">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Deleting your account and photos. This can take a moment; keep this page open.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!confirmed || busy}
          className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-50"
        >
          <Trash2 className="size-4" aria-hidden /> Delete my account
        </button>
      </div>
    </form>
  );
}

export function DeleteAccountDialog({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  // Remounted on every open, so a previous password or error never lingers.
  return (
    <Modal open={open} onClose={onClose} title="Delete your account?" className="sm:max-w-md">
      {open && <Body email={email} onClose={onClose} />}
    </Modal>
  );
}
