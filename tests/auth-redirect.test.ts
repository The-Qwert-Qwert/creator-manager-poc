import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "@/lib/auth/redirect";

describe("safeRedirectPath", () => {
  it("returns safe relative paths unchanged", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard?tab=analytics")).toBe("/dashboard?tab=analytics");
    expect(safeRedirectPath("/api/auth/youtube")).toBe("/api/auth/youtube");
    expect(safeRedirectPath("/auth/sign-in?redirect=%2Fdashboard")).toBe(
      "/auth/sign-in?redirect=%2Fdashboard",
    );
    expect(safeRedirectPath("/a/b/c")).toBe("/a/b/c");
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(safeRedirectPath("https://evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("http://evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("javascript:alert(1)")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("data:text/html,<script>alert(1)</script>")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("rejects protocol-relative targets", () => {
    expect(safeRedirectPath("//evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("//evil.com/path")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects backslash variants because browsers normalise them", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("/foo\\bar")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects control characters", () => {
    expect(safeRedirectPath("/dashboard\n")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("/dashboard\t")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("/dash\u007fboard")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects empty, whitespace-only, null and undefined", () => {
    expect(safeRedirectPath("")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath("   ")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects a bare relative path with no leading slash", () => {
    expect(safeRedirectPath("dashboard")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("falls back to /dashboard by default and honours an explicit fallback", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("https://evil.com", "/auth/sign-in")).toBe("/auth/sign-in");
  });

  it("defaults to the exported DEFAULT_SIGNED_IN_PATH constant", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(DEFAULT_SIGNED_IN_PATH).toBe("/dashboard");
  });
});
