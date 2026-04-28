import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  },
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
  routeTicket: vi.fn(),
  applyRouting: vi.fn(),
  classifyTicket: vi.fn(),
  findAndExecuteWorkflow: vi.fn(),
  executeWorkflow: vi.fn(),
  analyzeSentiment: vi.fn(),
  routeTicketBySentiment: vi.fn(),
  findSimilarOpenTicket: vi.fn(),
  analyzeAndExecuteAction: vi.fn(),
}));

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://mock:mock@localhost:5432/mock",
    JWT_SECRET: "mock",
    // Remove AI URL to skip fetch block
    PUBLIC_WEB_URL: "http://mock-web",
  },
}));

vi.mock("../../config/db.js", () => ({
  pool: mocks.pool,
}));

vi.mock("../ai/sentiment-routing.service.js", () => ({
  analyzeSentiment: mocks.analyzeSentiment,
  routeTicketBySentiment: mocks.routeTicketBySentiment,
}));

vi.mock("./ticket-dedupe.service.js", () => ({
  findSimilarOpenTicket: mocks.findSimilarOpenTicket,
}));

vi.mock("../routing/intelligent-routing.service.js", () => ({
  routeTicket: mocks.routeTicket,
  applyRouting: mocks.applyRouting,
}));

vi.mock("../ai/action-taking-ai.service.js", () => ({
  classifyTicket: mocks.classifyTicket,
  analyzeAndExecuteAction: mocks.analyzeAndExecuteAction,
}));

vi.mock("../workflows/auto-resolution.service.js", () => ({
  findAndExecuteWorkflow: mocks.findAndExecuteWorkflow,
  executeWorkflow: mocks.executeWorkflow,
}));

import { createTicket } from "./ticket.service.js";

describe("Ticket Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pool.connect.mockResolvedValue(mocks.client);
    
    // Smart mock for pool.query to handle race conditions
    mocks.pool.query.mockImplementation(async (query: string, params: any[]) => {
      const q = query.trim().toUpperCase();
      
      // 1. Duplicate check
      if (q.includes("SELECT *") && q.includes("FROM TICKETS") && q.includes("CREATED_BY")) {
        return { rows: [] };
      }
      
      // 2. Notification targets (getNotificationTargets)
      if (q.includes("SELECT") && (q.includes("NOTIFICATION_TARGETS") || q.includes("users"))) {
        return { rows: [] }; // No targets to notify
      }
      
      // 3. Insert Notification
      if (q.startsWith("INSERT INTO NOTIFICATIONS")) {
        return { rows: [] };
      }
      
      // 4. Priority Update
      if (q.startsWith("UPDATE TICKETS") && q.includes("SET PRIORITY")) {
        // Return classifiedTicket (which we'll define in scope or closure if needed, but here we can just return a generic object with priority)
        // However, the test expects specific flow.
        // Let's rely on the fact that the specific query for priority update has specific structure.
        return { rows: [{ ...params[1] === "HIGH" ? { priority: "HIGH" } : {} }] };
      }
      
      // 5. Reload ticket
      if (q.startsWith("SELECT * FROM TICKETS WHERE ID = $1")) {
         // Check if this is the final reload after routing
         // We can check if we are in the routing phase?
         // Simpler: If query is SELECT * FROM tickets WHERE id = 'ticket-123'
         // We can return the routed ticket if it matches.
         // But we need access to 'routedTicket' from the test scope.
         // Since we can't easily access 'routedTicket' here, we'll return a basic ticket
         // and rely on the test-specific overrides if needed.
         // But wait, 'it' block defines 'routedTicket'.
         // We can move this implementation inside 'it' block or use variables.
         return { rows: [] }; 
      }

      return { rows: [] };
    });
  });

  describe("createTicket", () => {
    it("should create a ticket and apply intelligent routing", async () => {
      // Setup data
      const mockTicket = {
        id: "ticket-123",
        title: "Test Ticket",
        description: "Test Description",
        priority: "LOW",
        category: "general",
        created_at: new Date(),
        status: "OPEN",
      };

      const classifiedTicket = {
        ...mockTicket,
        priority: "HIGH",
        category: "software",
      };

      const routedTicket = {
        ...classifiedTicket,
        assigned_agent: "agent-1",
        assigned_team: "team-1",
      };

      // Define smart mocks inside the test to access closure variables
      mocks.pool.query.mockImplementation(async (query: string, params: any[]) => {
        const q = (query || "").trim().toUpperCase();
        
        // 1. Duplicate check (recent ticket)
        if (q.includes("FROM TICKETS") && q.includes("CREATED_BY") && q.includes("LIMIT 1")) {
          return { rows: [] };
        }
        
        // 2. Notification targets (getNotificationTargets)
        // It selects from ticket_watchers or users or similar
        // Let's assume it doesn't matter for this test as long as it returns something or nothing
        if (q.includes("FROM TICKET_WATCHERS") || q.includes("FROM USERS")) {
           return { rows: [] };
        }

        // 3. Insert Notification
        if (q.startsWith("INSERT INTO NOTIFICATIONS")) {
          return { rows: [] };
        }
        
        // 4. Priority Update (triggered by routing change)
        if (q.startsWith("UPDATE TICKETS") && q.includes("SET PRIORITY")) {
          return { rows: [classifiedTicket] };
        }
        
        // 5. Reload ticket (final step)
        if (q.startsWith("SELECT * FROM TICKETS WHERE ID = $1")) {
           // If we are reloading the ticket, return the routed ticket
           return { rows: [routedTicket] };
        }

        return { rows: [] };
      });

      // 1. Mock transaction start
      mocks.client.query.mockResolvedValueOnce({}); // BEGIN

      // 2. Mock ticket insertion
      mocks.client.query.mockResolvedValueOnce({ rows: [mockTicket] }); // INSERT tickets
      
      // 3. Mock SLA update
      mocks.client.query.mockResolvedValueOnce({ rows: [mockTicket] }); // UPDATE sla

      // 4. Mock display number generation
      mocks.client.query.mockResolvedValueOnce({ rows: [{ display_number: "INC-123" }] }); // SELECT display_number

      // 5. Mock display number update
      mocks.client.query.mockResolvedValueOnce({ rows: [{ ...mockTicket, display_number: "INC-123" }] }); // UPDATE display_number

      // 6. Mock event insertion
      mocks.client.query.mockResolvedValueOnce({}); // INSERT ticket_events
      
      // 7. Mock COMMIT
      mocks.client.query.mockResolvedValueOnce({}); // COMMIT

      // 4. Mock AI dependencies (skipped fetch block due to missing URL)
      mocks.analyzeSentiment.mockResolvedValue("neutral");
      mocks.routeTicketBySentiment.mockResolvedValue(undefined);
      mocks.analyzeAndExecuteAction.mockResolvedValue({ success: false });
      mocks.findSimilarOpenTicket.mockResolvedValue(null);

      // 5. Mock update after classification (skipped)
      // Since fetch block is skipped, classifiedTicket is still mockTicket
      // But we need to ensure subsequent logic uses the correct priority/category
      // Let's assume the initial ticket has the correct data for routing test
      
      // 6. Mock workflow check (return null/no workflow)
      mocks.findAndExecuteWorkflow.mockResolvedValue(null);

      // 7. Mock routing
      mocks.routeTicket.mockResolvedValue({
        priority: "HIGH",
        confidence: 0.8, // High confidence > 0.6
        teamId: "team-1",
        agentId: "agent-1",
        method: "rule",
      });

      // 8. Mock applyRouting (void)
      mocks.applyRouting.mockResolvedValue(undefined);

      // 9. Mock reload after routing (already mocked above)
      // mocks.pool.query.mockResolvedValueOnce({ rows: [routedTicket] });

      // Execute
      const result = await createTicket({
        title: "Test Ticket",
        description: "Test Description",
        createdBy: "user-1",
        type: "INCIDENT",
        performedBy: "user-1",
      });

      // Assertions
      expect(mocks.client.query).toHaveBeenCalledWith("BEGIN");
      
      // Verify AI classification was skipped
      expect(mocks.classifyTicket).not.toHaveBeenCalled();

      // Verify Routing was called with initial values (since AI skipped)
      expect(mocks.routeTicket).toHaveBeenCalledWith(expect.objectContaining({
        ticketId: "ticket-123",
        priority: "LOW", // Initial priority
      }));

      // Verify Apply Routing was called with ROUTED values
      expect(mocks.applyRouting).toHaveBeenCalledWith(
        "ticket-123",
        expect.objectContaining({ 
          priority: "HIGH", // From routeTicket result
          agentId: "agent-1" 
        }),
        "user-1"
      );

      // Verify final result
      expect(result.assigned_agent).toBe("agent-1");
    });
  });
});
