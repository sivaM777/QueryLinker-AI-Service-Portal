import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminLayout } from "../AdminLayout";

vi.mock("../../services/auth", async () => {
  const actual = await vi.importActual<typeof import("../../services/auth")>("../../services/auth");
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: "1",
        email: "admin@example.com",
        role: "ADMIN",
        name: "Admin User",
        team_id: null,
        phone: null,
        department: null,
        location: null,
        bio: null,
        avatar_url: "https://example.com/admin.jpg",
        availability_status: "ONLINE",
        max_concurrent_tickets: 5,
        certifications: [],
        hire_date: null,
      },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

vi.mock("../../services/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
  getApiErrorMessage: () => "Error",
}));

vi.mock("../../utils/usePwaInstallPrompt", () => ({
  usePwaInstallPrompt: () => ({ promptInstall: vi.fn(), isSupported: false }),
}));

vi.mock("../../components/chatbot/ChatWidget", () => ({
  ChatWidget: () => <div />,
}));

vi.mock("../../components/CommandMenu", () => ({
  CommandMenu: () => <div />,
}));

describe("Nav avatar integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders admin avatar image in top navigation", async () => {
    render(
      <MemoryRouter>
        <AdminLayout />
      </MemoryRouter>
    );

    const img = await screen.findByRole("img", { name: /admin user/i });
    expect(img).toBeInTheDocument();
    expect((img as HTMLImageElement).src).toContain("https://example.com/admin.jpg");
  });
});
