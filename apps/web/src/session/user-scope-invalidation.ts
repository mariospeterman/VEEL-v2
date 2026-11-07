export const userScopeInvalidationStorageKey = "wevid:session:user-scope-invalidated";
export const userScopeInvalidationEvent = "wevid:user-scope-invalidated";

type MutableStorage = Pick<Storage, "setItem" | "removeItem">;
type SessionShape = {
  authenticated: boolean;
  clientSessionScope: string;
  user?: { id: string } | undefined;
};

export type UserSessionAuthority = {
  clientSessionScope: string;
  userId: string;
};

export function sessionAuthority(session: SessionShape): UserSessionAuthority | null {
  if (!session.authenticated || !session.user) return null;
  return {
    clientSessionScope: session.clientSessionScope,
    userId: session.user.id
  };
}

export function sameSessionAuthority(
  expected: UserSessionAuthority,
  session: SessionShape
): boolean {
  const current = sessionAuthority(session);
  return current?.userId === expected.userId
    && current.clientSessionScope === expected.clientSessionScope;
}

export function notifyUserScopeInvalidation(
  storage: MutableStorage,
  eventTarget?: EventTarget
): void {
  const marker = `${Date.now()}:${randomMarker()}`;
  storage.setItem(userScopeInvalidationStorageKey, marker);
  storage.removeItem(userScopeInvalidationStorageKey);
  eventTarget?.dispatchEvent(new Event(userScopeInvalidationEvent));
}

export function subscribeToUserScopeInvalidation(
  listener: () => void,
  eventTarget: Window = window
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === userScopeInvalidationStorageKey && event.newValue) listener();
  };
  eventTarget.addEventListener("storage", onStorage);
  eventTarget.addEventListener(userScopeInvalidationEvent, listener);
  return () => {
    eventTarget.removeEventListener("storage", onStorage);
    eventTarget.removeEventListener(userScopeInvalidationEvent, listener);
  };
}

function randomMarker() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
