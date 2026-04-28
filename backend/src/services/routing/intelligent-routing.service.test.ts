import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../config/db.js", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../tickets/ticket.service.js", () => ({
  assignTicket: vi.fn(),
}));

vi.mock("./complexity-scoring.service.js", () => ({
  calculateComplexityScore: vi.fn(),
  updateTicketComplexity: vi.fn(),
}));

import { getAgentWorkload, findLeastLoadedAgent } from "./intelligent-routing.service.js";
import { pool } from "../../config/db.js";

describe("Intelligent Routing Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAgentWorkload", () => {
    it("should calculate weighted score correctly", async () => {
      // Setup mock return value
      (pool.query as any).mockResolvedValueOnce({
        rows: [
          {
            open_tickets_count: 5,
            in_progress_tickets_count: 3,
            high_priority_count: 2,
            medium_priority_count: 3,
            low_priority_count: 3,
          },
        ],
      });

      const agentId = "agent-123";
      const result = await getAgentWorkload(agentId);

      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SELECT"), [agentId]);
      
      // Expected score: (2 * 4) + (3 * 2) + (3 * 1) = 8 + 6 + 3 = 17
      expect(result).toEqual({
        openTickets: 5,
        inProgressTickets: 3,
        highPriority: 2,
        mediumPriority: 3,
        lowPriority: 3,
        totalWorkload: 8,
        weightedScore: 17,
      });
    });

    it("should return zero values if no workload found", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [] });

      const result = await getAgentWorkload("unknown-agent");

      expect(result).toEqual({
        openTickets: 0,
        inProgressTickets: 0,
        highPriority: 0,
        mediumPriority: 0,
        lowPriority: 0,
        totalWorkload: 0,
        weightedScore: 0,
      });
    });
  });

  describe("findLeastLoadedAgent", () => {
    it("should return the agent with the lowest weighted score", async () => {
      (pool.query as any).mockResolvedValueOnce({
        rows: [{ id: "agent-optimus" }],
      });

      const result = await findLeastLoadedAgent();

      expect(result).toBe("agent-optimus");
      
      // Verify the query contains the weighted logic
      const queryCall = (pool.query as any).mock.calls[0][0];
      expect(queryCall).toContain("high_priority_count, 0) * 4");
      expect(queryCall).toContain("medium_priority_count, 0) * 2");
      expect(queryCall).toContain("low_priority_count, 0) * 1");
      expect(queryCall).toContain("ORDER BY");
    });

    it("should return null if no agent found", async () => {
      (pool.query as any).mockResolvedValueOnce({ rows: [] });

      const result = await findLeastLoadedAgent();

      expect(result).toBeNull();
    });
  });
});
