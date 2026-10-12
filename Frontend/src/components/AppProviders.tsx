"use client";

import type { ReactNode } from "react";
import { ChatProvider } from "./ChatProvider";
import { ItemViewerProvider } from "./ItemViewer";
import { OutfitsProvider } from "./OutfitsProvider";
import { ProfileProvider } from "./ProfileProvider";
import { ToastProvider } from "./Toaster";
import { WardrobeProvider } from "./WardrobeProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <WardrobeProvider>
        <ProfileProvider>
          <OutfitsProvider>
            <ChatProvider>
              <ItemViewerProvider>{children}</ItemViewerProvider>
            </ChatProvider>
          </OutfitsProvider>
        </ProfileProvider>
      </WardrobeProvider>
    </ToastProvider>
  );
}
