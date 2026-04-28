import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserAvatar } from "../UserAvatar";

vi.mock("../../services/auth", async () => {
  const actual = await vi.importActual<typeof import("../../services/auth")>("../../services/auth");
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: "1",
        email: "user@example.com",
        role: "EMPLOYEE",
        name: "Alice",
        team_id: null,
        phone: null,
        department: null,
        location: null,
        bio: null,
        avatar_url: "https://example.com/avatar.jpg",
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

describe("UserAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders authenticated user avatar image when avatar_url exists", () => {
    render(<UserAvatar size={32} />);
    const img = screen.getByRole("img", { name: /alice/i }) as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain("https://example.com/avatar.jpg");
  });

  it("falls back to initial when no avatar_url", () => {
    render(
      <UserAvatar
        size={32}
        user={{
          id: "2",
          email: "bob@example.com",
          role: "EMPLOYEE",
          name: "Bob",
          team_id: null,
          phone: null,
          department: null,
          location: null,
          bio: null,
          avatar_url: null,
          availability_status: "ONLINE",
          max_concurrent_tickets: 5,
          certifications: [],
          hire_date: null,
        }}
      />
    );
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("uses provided user prop when given", () => {
    render(
      <UserAvatar
        size={40}
        user={{
          id: "3",
          email: "carol@example.com",
          role: "EMPLOYEE",
          name: "Carol",
          team_id: null,
          phone: null,
          department: null,
          location: null,
          bio: null,
          avatar_url: "https://example.com/carol.jpg",
          availability_status: "ONLINE",
          max_concurrent_tickets: 5,
          certifications: [],
          hire_date: null,
        }}
      />
    );

    const img = screen.getByRole("img", { name: /carol/i }) as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain("https://example.com/carol.jpg");
  });
});
