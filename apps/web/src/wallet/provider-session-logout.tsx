"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode
} from "react";

type ProviderSessionLogout = () => Promise<void>;

interface ProviderSessionLogoutContextValue {
  logoutProviderSessions: ProviderSessionLogout;
  registerProviderLogout: (provider: string, logout: ProviderSessionLogout) => () => void;
}

const ProviderSessionLogoutContext = createContext<ProviderSessionLogoutContextValue | null>(null);

export function ProviderSessionLogoutProvider({ children }: Readonly<{ children: ReactNode }>) {
  const handlers = useRef(new Map<string, ProviderSessionLogout>());

  const registerProviderLogout = useCallback((provider: string, logout: ProviderSessionLogout) => {
    handlers.current.set(provider, logout);

    return () => {
      if (handlers.current.get(provider) === logout) {
        handlers.current.delete(provider);
      }
    };
  }, []);

  const logoutProviderSessions = useCallback(async () => {
    await Promise.allSettled([...handlers.current.values()].map((logout) => logout()));
  }, []);

  const value = useMemo(
    () => ({ logoutProviderSessions, registerProviderLogout }),
    [logoutProviderSessions, registerProviderLogout]
  );

  return (
    <ProviderSessionLogoutContext.Provider value={value}>
      {children}
    </ProviderSessionLogoutContext.Provider>
  );
}

export function useProviderSessionLogout() {
  const context = useContext(ProviderSessionLogoutContext);

  if (!context) {
    throw new Error("Provider session logout must be used inside WalletRuntimeProviders");
  }

  return context.logoutProviderSessions;
}

export function useProviderSessionLogoutRegistration(provider: string, logout: ProviderSessionLogout) {
  const context = useContext(ProviderSessionLogoutContext);

  if (!context) {
    throw new Error("Provider session logout registration must be used inside WalletRuntimeProviders");
  }

  useEffect(
    () => context.registerProviderLogout(provider, logout),
    [context, logout, provider]
  );
}
