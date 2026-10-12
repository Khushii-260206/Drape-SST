import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <LogoMark className="size-14" />
      <h1 className="font-serif text-4xl tracking-tight text-gray-900">Nothing hanging here</h1>
      <p className="text-sm text-gray-500">That page doesn&apos;t exist. Let&apos;s get you back to your stylist.</p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500"
      >
        Back to the stylist
      </Link>
    </div>
  );
}
