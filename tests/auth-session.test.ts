import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, requireUser } from "@/lib/auth/session";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

let mockUser: { id: string; email: string } | null = null;
let mockAuthError: { message: string } | null = null;
const mockGetUser = vi.fn(async () => ({
  data: { user: mockUser },
  error: mockAuthError,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

describe("lib/auth/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockAuthError = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("requireUser", () => {
    it("returns user and supabase client when authenticated", async () => {
      mockUser = { id: "user-123", email: "creator@example.com" };

      const result = await requireUser();

      expect(result.user).toEqual({ id: "user-123", email: "creator@example.com" });
      expect(result.supabase).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("redirects to /auth/sign-in when unauthenticated (no user)", async () => {
      mockUser = null;

      await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/auth/sign-in");
      expect(mockRedirect).toHaveBeenCalledWith("/auth/sign-in");
    });

    it("redirects to /auth/sign-in with encoded redirect param when redirectTo is provided", async () => {
      mockUser = null;

      await expect(
        requireUser({ redirectTo: "/dashboard?tab=analytics" })
      ).rejects.toThrow("NEXT_REDIRECT:/auth/sign-in?redirect=%2Fdashboard%3Ftab%3Danalytics");

      expect(mockRedirect).toHaveBeenCalledWith(
        "/auth/sign-in?redirect=%2Fdashboard%3Ftab%3Danalytics"
      );
    });

    it("redirects when supabase returns an auth error", async () => {
      mockUser = null;
      mockAuthError = { message: "Invalid JWT token" };

      await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/auth/sign-in");
      expect(mockRedirect).toHaveBeenCalledWith("/auth/sign-in");
    });

    it("uses custom supabase client when passed in options", async () => {
      const customGetUser = vi.fn(async () => ({
        data: { user: { id: "custom-user", email: "custom@example.com" } },
        error: null,
      }));
      const customClient = {
        auth: { getUser: customGetUser },
      } as unknown as Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

      const result = await requireUser({ client: customClient });

      expect(customGetUser).toHaveBeenCalledTimes(1);
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(result.user.id).toBe("custom-user");
      expect(result.supabase).toBe(customClient);
    });
  });

  describe("getCurrentUser", () => {
    it("returns user and client when authenticated without redirecting", async () => {
      mockUser = { id: "user-456", email: "user@example.com" };

      const result = await getCurrentUser();

      expect(result.user).toEqual({ id: "user-456", email: "user@example.com" });
      expect(result.supabase).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("returns null user when unauthenticated without throwing", async () => {
      mockUser = null;

      const result = await getCurrentUser();

      expect(result.user).toBeNull();
      expect(result.supabase).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
