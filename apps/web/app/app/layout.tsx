import { AppProviders } from "./app-providers";

export default function AuthenticatedAppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppProviders>{children}</AppProviders>;
}
