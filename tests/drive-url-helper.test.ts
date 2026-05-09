// Tests for the shell's drive URL helper. Covers the auth-token
// injection that lets <img src=...> in agent comments load
// without JS-fetched blobs.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { driveUrl, withDriveAuth } from "../packages/@boringos/shell/src/screens/Drive/url.js";

beforeEach(() => {
  // jsdom-ish window stub so the helper can read localStorage.
  const store = new Map<string, string>();
  const win: any = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
  vi.stubGlobal("window", win);
});

describe("driveUrl", () => {
  it("appends ?token=<localStorage token> to a path", () => {
    window.localStorage.setItem("boringos.token", "tok-abc");
    expect(driveUrl("tasks/T/chart.png")).toBe(
      "/api/admin/drive/file/tasks/T/chart.png?token=tok-abc",
    );
  });

  it("accepts a full URL and just appends the token", () => {
    window.localStorage.setItem("boringos.token", "tok-abc");
    expect(driveUrl("/api/admin/drive/file/tasks/T/chart.png")).toBe(
      "/api/admin/drive/file/tasks/T/chart.png?token=tok-abc",
    );
  });

  it("does not double-append a token already present", () => {
    window.localStorage.setItem("boringos.token", "tok-abc");
    expect(driveUrl("/api/admin/drive/file/foo.png?token=existing")).toBe(
      "/api/admin/drive/file/foo.png?token=existing",
    );
  });

  it("returns a bare URL when no token is in localStorage", () => {
    expect(driveUrl("foo.png")).toBe("/api/admin/drive/file/foo.png");
  });

  it("URL-encodes path segments", () => {
    window.localStorage.setItem("boringos.token", "t");
    expect(driveUrl("tasks/T/Has Space.png")).toBe(
      "/api/admin/drive/file/tasks/T/Has%20Space.png?token=t",
    );
  });
});

describe("withDriveAuth", () => {
  it("injects the token into drive-file URLs", () => {
    window.localStorage.setItem("boringos.token", "tok-xyz");
    expect(withDriveAuth("/api/admin/drive/file/tasks/T/x.png")).toBe(
      "/api/admin/drive/file/tasks/T/x.png?token=tok-xyz",
    );
  });

  it("leaves non-drive URLs untouched", () => {
    window.localStorage.setItem("boringos.token", "tok-xyz");
    expect(withDriveAuth("https://example.com/cat.png")).toBe(
      "https://example.com/cat.png",
    );
    expect(withDriveAuth("/api/auth/me")).toBe("/api/auth/me");
  });
});
