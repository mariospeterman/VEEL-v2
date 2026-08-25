import { describe, expect, it } from "vitest";
import { browserApiUrl } from "./browser-api-url";

describe("browserApiUrl", () => {
  it("keeps local API cookies on the browser loopback site", () => {
    expect(
      browserApiUrl("/v1/session", "http://localhost:4000", "http://127.0.0.1:3000").toString()
    ).toBe("http://127.0.0.1:4000/v1/session");
    expect(
      browserApiUrl("/v1/session", "http://127.0.0.1:4000", "http://localhost:3000").toString()
    ).toBe("http://localhost:4000/v1/session");
    expect(
      browserApiUrl("/v1/session", "http://localhost:4000", "http://[::1]:3000").toString()
    ).toBe("http://[::1]:4000/v1/session");
  });

  it("does not rewrite deployed API origins", () => {
    expect(
      browserApiUrl("/v1/session", "https://api.staging.wevid.example", "https://staging.wevid.example").toString()
    ).toBe("https://api.staging.wevid.example/v1/session");
  });
});
