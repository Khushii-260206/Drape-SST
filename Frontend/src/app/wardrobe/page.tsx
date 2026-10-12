import type { Metadata } from "next";
import WardrobeView from "@/components/wardrobe/WardrobeView";

export const metadata: Metadata = { title: "Wardrobe" };

export default function WardrobePage() {
  return <WardrobeView />;
}
