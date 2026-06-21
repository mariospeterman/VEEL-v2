"use client";

import { QueryProvider } from "@/query-provider";
import { RealtimeProvider } from "@/realtime-provider";

export function AppProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryProvider>
      <RealtimeProvider />
      {children}
    </QueryProvider>
  );
}
