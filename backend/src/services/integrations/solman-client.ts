import { pool } from "../../config/db.js";

export interface SolmanConfig {
  apiUrl: string;
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
}

export interface SolmanTicket {
  IncidentID: string;
  Title: string;
  Description: string;
  Status: string;
  Priority: string;
  Category: string;
  Requester: string;
  AssignedTo?: string;
  CreatedDate: string;
  ModifiedDate: string;
}

/**
 * Solman API Client (SAP Solution Manager)
 * Note: This is a simplified implementation. Actual Solman API may vary.
 */
export class SolmanClient {
  private config: SolmanConfig;
  private accessToken: string | null = null;

  constructor(config: SolmanConfig) {
    this.config = config;
  }

  /**
   * Authenticate with Solman
   */
  async authenticate(): Promise<string> {
    // Solman typically uses OAuth2 or basic auth
    // This is a placeholder implementation
    const authUrl = `${this.config.apiUrl}/oauth/token`;

    const response = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: this.config.username,
        password: this.config.password,
        ...(this.config.clientId && { client_id: this.config.clientId }),
        ...(this.config.clientSecret && { client_secret: this.config.clientSecret }),
      }),
    });

    if (!response.ok) {
      throw new Error(`Solman authentication failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token || null;
    if (!this.accessToken) {
      throw new Error("Failed to obtain Solman access token");
    }
    return this.accessToken;
  }

  /**
   * Get tickets from Solman
   */
  async getTickets(filters?: Record<string, any>): Promise<SolmanTicket[]> {
    if (this.config.apiUrl.startsWith("mock://")) {
      const now = new Date();
      const iso = (d: Date) => d.toISOString();
      const base: SolmanTicket[] = [
        {
          IncidentID: "SOL-1001",
          Title: "SAP login error",
          Description: "User cannot login to SAP. Error: Invalid credentials / SSO token.",
          Status: "New",
          Priority: "High",
          Category: "BUSINESS_APP_ERP_CRM",
          Requester: "employee@company.com",
          AssignedTo: "",
          CreatedDate: iso(new Date(now.getTime() - 3 * 60 * 60 * 1000)),
          ModifiedDate: iso(new Date(now.getTime() - 60 * 60 * 1000)),
        },
        {
          IncidentID: "SOL-1002",
          Title: "VPN disconnects frequently",
          Description: "VPN drops every 10 minutes. Happens on WiFi.",
          Status: "In Progress",
          Priority: "Medium",
          Category: "NETWORK_VPN_WIFI",
          Requester: "employee@company.com",
          AssignedTo: "",
          CreatedDate: iso(new Date(now.getTime() - 6 * 60 * 60 * 1000)),
          ModifiedDate: iso(new Date(now.getTime() - 2 * 60 * 60 * 1000)),
        },
      ];

      if (!filters) return base;
      // Minimal filter support for demo
      const f = Object.entries(filters);
      return base.filter((t) => f.every(([k, v]) => String((t as any)[k] ?? "") === String(v)));
    }

    if (!this.accessToken) {
      await this.authenticate();
    }

    const queryParams = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        queryParams.append(key, String(value));
      });
    }

    const url = `${this.config.apiUrl}/api/incidents?${queryParams.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Solman API error: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : data.value || [];
  }

  /**
   * Get ticket by ID
   */
  async getTicket(ticketId: string): Promise<SolmanTicket | null> {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const response = await fetch(`${this.config.apiUrl}/api/incidents/${ticketId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Solman API error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Update ticket in Solman
   */
  async updateTicket(ticketId: string, updates: Partial<SolmanTicket>): Promise<SolmanTicket> {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const response = await fetch(`${this.config.apiUrl}/api/incidents/${ticketId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Solman API error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Create ticket in Solman
   */
  async createTicket(ticket: Partial<SolmanTicket>): Promise<SolmanTicket> {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const response = await fetch(`${this.config.apiUrl}/api/incidents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(ticket),
    });

    if (!response.ok) {
      throw new Error(`Solman API error: ${response.statusText}`);
    }

    return await response.json();
  }
}

/**
 * Map Solman ticket to internal ticket format
 */
export function mapSolmanTicketToInternal(solmanTicket: SolmanTicket): {
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  externalId: string;
  externalData: Record<string, any>;
} {
  // Map Solman priority to internal priority
  const priorityMap: Record<string, "LOW" | "MEDIUM" | "HIGH"> = {
    Low: "LOW",
    Medium: "MEDIUM",
    High: "HIGH",
    Critical: "HIGH",
  };

  // Map Solman status to internal status
  const statusMap: Record<string, "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"> = {
    New: "OPEN",
    "In Progress": "IN_PROGRESS",
    Resolved: "RESOLVED",
    Closed: "CLOSED",
  };

  return {
    title: solmanTicket.Title || "Solman Ticket",
    description: solmanTicket.Description || "",
    priority: priorityMap[solmanTicket.Priority] || "MEDIUM",
    status: statusMap[solmanTicket.Status] || "OPEN",
    externalId: solmanTicket.IncidentID,
    externalData: {
      solmanId: solmanTicket.IncidentID,
      solmanStatus: solmanTicket.Status,
      solmanPriority: solmanTicket.Priority,
      solmanCategory: solmanTicket.Category,
    },
  };
}
