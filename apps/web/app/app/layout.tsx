import { AppProviders } from "./app-providers";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";

export default function AuthenticatedAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <WalletRuntimeProviders>
      <AppProviders>{children}</AppProviders>
    </WalletRuntimeProviders>
  );
}
