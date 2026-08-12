import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";
import { AppProviders } from "./app-providers";

export default function AuthenticatedAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <WalletRuntimeProviders>
      <AppProviders>{children}</AppProviders>
    </WalletRuntimeProviders>
  );
}
