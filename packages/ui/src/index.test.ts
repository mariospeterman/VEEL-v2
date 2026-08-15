import { describe, expect, it } from "vitest";
import { appShellNavItems, appShellTopActionItems } from "./index";

describe("app shell navigation contract", () => {
  it("keeps exactly five primary app destinations", () => {
    expect(appShellNavItems.map((item) => item.label)).toEqual([
      "Home",
      "Bits",
      "Create",
      "Messages",
      "Profile"
    ]);
    expect(appShellNavItems.map((item) => item.href)).toEqual([
      "/app/home",
      "/app/bits",
      "/app/create",
      "/app/messages",
      "/app/profile"
    ]);
  });

  it("keeps secondary workspaces out of primary navigation", () => {
    expect(appShellTopActionItems.map((item) => item.label)).toEqual([
      "Wallet",
      "Notifications",
      "Subscriptions",
      "Settings"
    ]);
    expect(appShellTopActionItems.map((item) => item.href)).toEqual([
      "/app/wallet",
      "/app/notifications",
      "/app/subscriptions",
      "/app/settings"
    ]);
  });
});
