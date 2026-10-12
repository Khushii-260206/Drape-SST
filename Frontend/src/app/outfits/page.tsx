import type { Metadata } from "next";
import OutfitsView from "@/components/outfits/OutfitsView";

export const metadata: Metadata = { title: "Outfits" };

export default function OutfitsPage() {
  return <OutfitsView />;
}
