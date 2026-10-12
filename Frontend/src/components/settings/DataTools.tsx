"use client";

import { Cloud, Download, Loader2, MessageSquareX, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { exportBackup } from "@/lib/db";
import { downloadBlob, formatBytes } from "@/lib/utils";
import { useChat } from "../ChatProvider";
import { useOutfits } from "../OutfitsProvider";
import { useToast } from "../Toaster";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useWardrobe } from "../WardrobeProvider";

const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

const rowButton =
  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-sm ring-1 transition disabled:opacity-60";

export function DataTools() {
  const { items, ready, importFile, clearAll } = useWardrobe();
  const { refresh: refreshOutfits } = useOutfits();
  const chat = useChat();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmChat, setConfirmChat] = useState(false);

  async function doExport() {
    setBusy("export");
    try {
      const { blob, count, skipped } = await exportBackup();
      downloadBlob(blob, `my-wardrobe-backup-${new Date().toISOString().slice(0, 10)}.json`);
      if (skipped > 0) {
        toast(`Backup saved with ${count} ${count === 1 ? "piece" : "pieces"} — ${skipped} left out because their photo is missing.`, "error");
      } else {
        toast(`Backup saved — ${count} ${count === 1 ? "piece" : "pieces"}, ${formatBytes(blob.size)}`);
      }
    } catch {
      toast("Couldn't create the backup. Try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function doImport(file: File) {
    setBusy("import");
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is too large to be one of my backups.");
      const result = await importFile(await file.text());
      const parts = [`${result.added} added`, `${result.updated} updated`];
      if (result.outfits) parts.push(`${result.outfits} ${result.outfits === 1 ? "look" : "looks"}`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      void refreshOutfits();
      toast(`Backup imported — ${parts.join(", ")}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't import that file.", "error");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl bg-gray-50 p-4 text-sm">
        <Cloud className="mt-0.5 size-5 shrink-0 text-gray-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-gray-900">
            {ready ? `${items.length} ${items.length === 1 ? "piece" : "pieces"} saved in the cloud` : "Loading…"}
          </p>
          <p className="text-gray-500">Your wardrobe, photos and chats sync to every device you open this site on.</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900">Backup &amp; restore</h3>
        <p className="mt-1 text-sm text-gray-500">
          Your wardrobe is already saved online. Export a backup file for a copy of your own, or Import one to add
          pieces from it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={doExport}
            disabled={busy !== null || !ready || items.length === 0}
            className={`${rowButton} bg-surface text-gray-800 ring-gray-200 hover:bg-gray-50`}
          >
            {busy === "export" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            Export backup
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null || !ready}
            className={`${rowButton} bg-surface text-gray-800 ring-gray-200 hover:bg-gray-50`}
          >
            {busy === "import" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose a backup file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
            }}
          />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <h3 className="text-sm font-medium text-gray-900">Clean up</h3>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setConfirmChat(true)}
            disabled={chat.chats.length === 0}
            className={`${rowButton} bg-surface text-gray-700 ring-gray-200 hover:bg-gray-50`}
          >
            <MessageSquareX className="size-4" aria-hidden /> Delete all chats
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={!ready}
            className={`${rowButton} bg-surface text-red-600 ring-red-200 hover:bg-red-50`}
          >
            <Trash2 className="size-4" aria-hidden /> Delete everything
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmChat}
        title="Delete all chats?"
        message="Every conversation with the stylist will be erased. Your wardrobe, saved looks and settings stay as they are."
        confirmLabel="Delete all chats"
        onCancel={() => setConfirmChat(false)}
        onConfirm={async () => {
          await chat.clear();
          setConfirmChat(false);
          toast("All chats deleted");
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete everything?"
        message="This permanently removes every piece, photo and chat message from the cloud. Your API key is kept. Export a backup first if you might want any of it back."
        confirmLabel="Delete everything"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await clearAll();
          await chat.clear();
          void refreshOutfits();
          setConfirmDelete(false);
          toast("Everything was deleted");
        }}
      />
    </div>
  );
}
