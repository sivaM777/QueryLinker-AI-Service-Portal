import { pool } from "../../config/db.js";
import { findUserByEmail, hashPassword, type DbUser } from "../auth/auth.service.js";

type SupportLevel = "L1" | "L2" | "L3";

type SeedTeam = {
  name: string;
  supportLevel: SupportLevel;
  autoEscalateMinutes: number;
  description: string;
  responsibilities: string[];
};

type SeedUser = {
  name: string;
  email: string;
  password: string;
  role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
  teamName?: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const normalizeDomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

const defaultTeams: SeedTeam[] = [
  {
    name: "L1 Support",
    supportLevel: "L1",
    autoEscalateMinutes: 30,
    description: "Frontline support for employee incidents, service requests, and basic troubleshooting.",
    responsibilities: ["Ticket intake", "Password and access support", "Basic hardware checks", "Knowledge base guidance"],
  },
  {
    name: "L2 Technical Support",
    supportLevel: "L2",
    autoEscalateMinutes: 60,
    description: "Technical escalation team for network, software, device, and collaboration issues.",
    responsibilities: ["Network diagnostics", "Application support", "Device troubleshooting", "Escalation ownership"],
  },
  {
    name: "L3 Expert Team",
    supportLevel: "L3",
    autoEscalateMinutes: 120,
    description: "Expert engineering team for complex root cause analysis and strategic remediation.",
    responsibilities: ["Root cause analysis", "Security review", "Infrastructure changes", "Problem management"],
  },
];

const demoUsers: SeedUser[] = [
  { name: "Admin User", email: "admin@company.com", password: "admin123", role: "ADMIN" },
  { name: "Manager User", email: "manager@company.com", password: "manager123", role: "MANAGER" },
  { name: "Agent User", email: "agent@company.com", password: "agent123", role: "AGENT", teamName: "L1 Support" },
  { name: "Employee User", email: "employee@company.com", password: "employee123", role: "EMPLOYEE" },
];

const getOrCreateOrganization = async (args: {
  name: string;
  domain: string;
  adminEmail: string;
  isDemo: boolean;
}) => {
  const slug = slugify(args.name) || "organization";
  const domain = normalizeDomain(args.domain);
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, domain, admin_email, is_demo, setup_status, subscription_tier)
     VALUES ($1, $2, $3, $4, $5, 'READY', 'FREE')
     ON CONFLICT (name) DO UPDATE SET
       slug = COALESCE(organizations.slug, EXCLUDED.slug),
       domain = COALESCE(organizations.domain, EXCLUDED.domain),
       admin_email = COALESCE(organizations.admin_email, EXCLUDED.admin_email),
       is_demo = organizations.is_demo OR EXCLUDED.is_demo,
       setup_status = 'READY'
     RETURNING id`,
    [args.name.trim(), slug, domain, args.adminEmail.toLowerCase(), args.isDemo]
  );
  return res.rows[0]!.id;
};

const getOrCreateTeam = async (organizationId: string, team: SeedTeam, managerId?: string | null) => {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM teams
     WHERE organization_id = $1 AND lower(name) = lower($2)
     LIMIT 1`,
    [organizationId, team.name]
  );

  if (existing.rows[0]?.id) {
    await pool.query(
      `UPDATE teams
       SET support_level = $2,
           auto_escalate_minutes = $3,
           description = $4,
           roles_and_responsibilities = $5::jsonb,
           manager_id = COALESCE($6, manager_id)
       WHERE id = $1`,
      [
        existing.rows[0].id,
        team.supportLevel,
        team.autoEscalateMinutes,
        team.description,
        JSON.stringify(team.responsibilities),
        managerId ?? null,
      ]
    );
    return existing.rows[0].id;
  }

  const created = await pool.query<{ id: string }>(
    `INSERT INTO teams (
       name,
       support_level,
       auto_escalate_minutes,
       description,
       roles_and_responsibilities,
       manager_id,
       organization_id
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id`,
    [
      team.name,
      team.supportLevel,
      team.autoEscalateMinutes,
      team.description,
      JSON.stringify(team.responsibilities),
      managerId ?? null,
      organizationId,
    ]
  );
  return created.rows[0]!.id;
};

const upsertDemoUser = async (organizationId: string, user: SeedUser, teamId: string | null, managerId: string | null) => {
  const passwordHash = await hashPassword(user.password);
  const res = await pool.query<DbUser>(
    `INSERT INTO users (name, email, password_hash, role, team_id, manager_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       team_id = EXCLUDED.team_id,
       manager_id = EXCLUDED.manager_id,
       organization_id = EXCLUDED.organization_id,
       updated_at = now()
     RETURNING *`,
    [
      user.name,
      user.email.toLowerCase(),
      passwordHash,
      user.role,
      teamId,
      user.role === "AGENT" ? managerId : null,
      organizationId,
    ]
  );
  return res.rows[0]!;
};

const ensureDemoTickets = async (organizationId: string, ids: {
  employeeId: string;
  agentId: string;
  l1TeamId: string;
  l2TeamId: string;
  l3TeamId: string;
}) => {
  const existing = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM tickets WHERE organization_id = $1",
    [organizationId]
  );
  if (Number(existing.rows[0]?.count ?? 0) >= 5) return;

  const samples = [
    {
      title: "VPN disconnects while working from home",
      description: "User reports VPN dropping every 10 minutes during remote work.",
      category: "NETWORK_VPN_WIFI",
      priority: "HIGH",
      status: "IN_PROGRESS",
      teamId: ids.l2TeamId,
      agentId: ids.agentId,
      sourceType: "WEB",
      age: "2 hours",
    },
    {
      title: "New laptop request for onboarding",
      description: "Employee needs a laptop and standard software bundle for new hire onboarding.",
      category: "HARDWARE_PERIPHERAL",
      priority: "MEDIUM",
      status: "OPEN",
      teamId: ids.l1TeamId,
      agentId: null,
      sourceType: "CHATBOT",
      age: "5 hours",
    },
    {
      title: "Outlook not receiving new email",
      description: "Mailbox sync is delayed and employee cannot see recent customer emails.",
      category: "EMAIL_COLLAB",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      teamId: ids.l1TeamId,
      agentId: ids.agentId,
      sourceType: "EMAIL",
      age: "1 day",
    },
    {
      title: "Suspicious sign-in alert",
      description: "Security alert triggered after impossible travel sign-in from an unknown location.",
      category: "SECURITY_INCIDENT",
      priority: "HIGH",
      status: "OPEN",
      teamId: ids.l3TeamId,
      agentId: null,
      sourceType: "WEB",
      age: "30 minutes",
    },
    {
      title: "Printer not printing from finance floor",
      description: "Shared printer queue is stuck for multiple finance employees.",
      category: "HARDWARE_PERIPHERAL",
      priority: "LOW",
      status: "RESOLVED",
      teamId: ids.l1TeamId,
      agentId: ids.agentId,
      sourceType: "WEB",
      age: "3 days",
    },
  ] as const;

  for (const sample of samples) {
    const displayNumberRes = await pool.query<{ display_number: string }>(
      "SELECT generate_display_number('INCIDENT') AS display_number"
    );
    const displayNumber = displayNumberRes.rows[0]?.display_number ?? null;
    const ticketRes = await pool.query<{ id: string }>(
      `INSERT INTO tickets (
         title,
         description,
         created_by,
         organization_id,
         category,
         priority,
         status,
         assigned_team,
         assigned_agent,
         ai_confidence,
         display_number,
         source_type,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::ticket_priority, $7::ticket_status, $8, $9, $10, $11, $12, now() - ($13::interval), now() - ($13::interval))
       RETURNING id`,
      [
        sample.title,
        sample.description,
        ids.employeeId,
        organizationId,
        sample.category,
        sample.priority,
        sample.status,
        sample.teamId,
        sample.agentId,
        0.88,
        displayNumber,
        sample.sourceType,
        sample.age,
      ]
    );

    await pool.query(
      `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by, timestamp)
       VALUES ($1, 'CREATED', NULL, $2::jsonb, $3, now() - ($4::interval))`,
      [
        ticketRes.rows[0]!.id,
        JSON.stringify({
          title: sample.title,
          status: sample.status,
          demo: true,
        }),
        ids.employeeId,
        sample.age,
      ]
    );
  }
};

export const ensureDemoWorkspace = async () => {
  const organizationId = await getOrCreateOrganization({
    name: "Demo Organization",
    domain: "company.com",
    adminEmail: "admin@company.com",
    isDemo: true,
  });

  const managerPasswordHash = await hashPassword("manager123");
  const managerRes = await pool.query<DbUser>(
    `INSERT INTO users (name, email, password_hash, role, organization_id)
     VALUES ('Manager User', 'manager@company.com', $1, 'MANAGER', $2)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       organization_id = EXCLUDED.organization_id,
       updated_at = now()
     RETURNING *`,
    [managerPasswordHash, organizationId]
  );
  const manager = managerRes.rows[0]!;

  const teamIds = new Map<string, string>();
  for (const team of defaultTeams) {
    teamIds.set(team.name, await getOrCreateTeam(organizationId, team, manager.id));
  }

  if (teamIds.get("L1 Support") && teamIds.get("L2 Technical Support")) {
    await pool.query("UPDATE teams SET escalation_team_id = $1 WHERE id = $2", [
      teamIds.get("L2 Technical Support"),
      teamIds.get("L1 Support"),
    ]);
  }
  if (teamIds.get("L2 Technical Support") && teamIds.get("L3 Expert Team")) {
    await pool.query("UPDATE teams SET escalation_team_id = $1 WHERE id = $2", [
      teamIds.get("L3 Expert Team"),
      teamIds.get("L2 Technical Support"),
    ]);
  }

  const users: Record<string, DbUser> = { "manager@company.com": manager };
  for (const user of demoUsers.filter((u) => u.email !== "manager@company.com")) {
    users[user.email] = await upsertDemoUser(
      organizationId,
      user,
      user.teamName ? teamIds.get(user.teamName) ?? null : null,
      manager.id
    );
  }

  await ensureDemoTickets(organizationId, {
    employeeId: users["employee@company.com"].id,
    agentId: users["agent@company.com"].id,
    l1TeamId: teamIds.get("L1 Support")!,
    l2TeamId: teamIds.get("L2 Technical Support")!,
    l3TeamId: teamIds.get("L3 Expert Team")!,
  });

  return {
    organizationId,
    users,
    roleEmails: {
      ADMIN: "admin@company.com",
      MANAGER: "manager@company.com",
      AGENT: "agent@company.com",
      EMPLOYEE: "employee@company.com",
    } as const,
  };
};

export const registerOrganizationWorkspace = async (args: {
  companyName: string;
  domain: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}) => {
  const domain = normalizeDomain(args.domain);
  const existingEmail = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1", [
    args.adminEmail,
  ]);
  if (existingEmail.rows[0]) {
    const err = new Error("Admin email already exists");
    (err as any).statusCode = 409;
    throw err;
  }

  const existingName = await pool.query("SELECT id FROM organizations WHERE lower(name) = lower($1) LIMIT 1", [
    args.companyName.trim(),
  ]);
  if (existingName.rows[0]) {
    const err = new Error("Organization name already exists");
    (err as any).statusCode = 409;
    throw err;
  }

  const existingDomain = await pool.query("SELECT id FROM organizations WHERE lower(domain) = lower($1) LIMIT 1", [
    domain,
  ]);
  if (existingDomain.rows[0]) {
    const err = new Error("Organization domain already exists");
    (err as any).statusCode = 409;
    throw err;
  }

  const organizationId = await getOrCreateOrganization({
    name: args.companyName,
    domain,
    adminEmail: args.adminEmail,
    isDemo: false,
  });

  const passwordHash = await hashPassword(args.adminPassword);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, organization_id)
     VALUES ($1, $2, $3, 'ADMIN', $4)
     RETURNING *`,
    [args.adminName.trim(), args.adminEmail.toLowerCase(), passwordHash, organizationId]
  );
  const admin = await findUserByEmail(args.adminEmail);
  if (!admin) {
    const err = new Error("Organization admin could not be created");
    (err as any).statusCode = 500;
    throw err;
  }

  const createdTeamIds: Record<string, string> = {};
  for (const team of defaultTeams) {
    createdTeamIds[team.name] = await getOrCreateTeam(organizationId, team, admin.id);
  }

  await pool.query("UPDATE teams SET escalation_team_id = $1 WHERE id = $2", [
    createdTeamIds["L2 Technical Support"],
    createdTeamIds["L1 Support"],
  ]);
  await pool.query("UPDATE teams SET escalation_team_id = $1 WHERE id = $2", [
    createdTeamIds["L3 Expert Team"],
    createdTeamIds["L2 Technical Support"],
  ]);

  return { organizationId, admin };
};
