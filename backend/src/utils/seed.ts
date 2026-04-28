import "dotenv/config";
import { pool } from "../config/db.js";
import { hashPassword } from "../services/auth/auth.service.js";

const run = async () => {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
    console.log("Seed skipped (NODE_ENV is not development)");
    return;
  }

  const adminPasswordHash = await hashPassword("admin123");
  const agentPasswordHash = await hashPassword("agent123");
  const employeePasswordHash = await hashPassword("employee123");
  const managerPasswordHash = await hashPassword("manager123");

  // Create L1 Support Team
  const l1TeamRes = await pool.query<{ id: string }>(
    "INSERT INTO teams (name, support_level, auto_escalate_minutes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
    ["L1 Support", "L1", 30]
  );
  let l1TeamId = l1TeamRes.rows[0]?.id ?? null;
  if (!l1TeamId) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM teams WHERE name = $1", ["L1 Support"]);
    l1TeamId = existing.rows[0]?.id ?? null;
  }

  // Create L2 Technical Support Team
  const l2TeamRes = await pool.query<{ id: string }>(
    "INSERT INTO teams (name, support_level, auto_escalate_minutes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
    ["L2 Technical Support", "L2", 60]
  );
  let l2TeamId = l2TeamRes.rows[0]?.id ?? null;
  if (!l2TeamId) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM teams WHERE name = $1", ["L2 Technical Support"]);
    l2TeamId = existing.rows[0]?.id ?? null;
  }

  // Create L3 Expert Team
  const l3TeamRes = await pool.query<{ id: string }>(
    "INSERT INTO teams (name, support_level, auto_escalate_minutes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
    ["L3 Expert Team", "L3", 120]
  );
  let l3TeamId = l3TeamRes.rows[0]?.id ?? null;
  if (!l3TeamId) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM teams WHERE name = $1", ["L3 Expert Team"]);
    l3TeamId = existing.rows[0]?.id ?? null;
  }

  // Create Escalations Team (for critical issues)
  const escTeamRes = await pool.query<{ id: string }>(
    "INSERT INTO teams (name, support_level, auto_escalate_minutes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
    ["Escalations", "L3", 15]
  );
  let escalationsTeamId = escTeamRes.rows[0]?.id ?? null;
  if (!escalationsTeamId) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM teams WHERE name = $1", ["Escalations"]);
    escalationsTeamId = existing.rows[0]?.id ?? null;
  }

  // Set up escalation paths: L1 -> L2 -> L3
  if (l1TeamId && l2TeamId) {
    await pool.query(
      "INSERT INTO escalation_paths (from_team_id, to_team_id, auto_escalate_minutes, enabled) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [l1TeamId, l2TeamId, 30, true]
    );
  }

  if (l2TeamId && l3TeamId) {
    await pool.query(
      "INSERT INTO escalation_paths (from_team_id, to_team_id, auto_escalate_minutes, enabled) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [l2TeamId, l3TeamId, 60, true]
    );
  }

  // Update teams with escalation references
  if (l1TeamId && l2TeamId) {
    await pool.query("UPDATE teams SET escalation_team_id = $1 WHERE id = $2 AND escalation_team_id IS NULL", [l2TeamId, l1TeamId]);
  }
  if (l2TeamId && l3TeamId) {
    await pool.query("UPDATE teams SET escalation_team_id = $1 WHERE id = $2 AND escalation_team_id IS NULL", [l3TeamId, l2TeamId]);
  }

  const orgRes = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, subscription_tier) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    ["Demo Organization", "FREE"]
  );
  let orgId = orgRes.rows[0]?.id ?? null;
  if (!orgId) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM organizations WHERE name = $1", ["Demo Organization"]);
    orgId = existing.rows[0]?.id ?? null;
  }

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ["Admin User", "admin@company.com", adminPasswordHash, "ADMIN", null, orgId]
  );

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ["Agent User", "agent@company.com", agentPasswordHash, "AGENT", l1TeamId, orgId]
  );

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ["L2 Agent", "l2agent@company.com", agentPasswordHash, "AGENT", l2TeamId, orgId]
  );

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ["L3 Expert", "l3expert@company.com", agentPasswordHash, "AGENT", l3TeamId, orgId]
  );

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ["Employee User", "employee@company.com", employeePasswordHash, "EMPLOYEE", null, orgId]
  );

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ["Manager User", "manager@company.com", managerPasswordHash, "MANAGER", null, orgId]
  );

  // Set a default manager mapping for demo (employee -> admin)
  const adminRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "admin@company.com",
  ]);
  const managerRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "manager@company.com",
  ]);
  const employeeRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "employee@company.com",
  ]);
  const agentRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "agent@company.com",
  ]);
  const l2AgentRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "l2agent@company.com",
  ]);
  const l3AgentRes = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 LIMIT 1", [
    "l3expert@company.com",
  ]);

  const adminId = adminRes.rows[0]?.id;
  const managerId = managerRes.rows[0]?.id;
  const employeeId = employeeRes.rows[0]?.id;
  const agentId = agentRes.rows[0]?.id;
  const l2AgentId = l2AgentRes.rows[0]?.id;
  const l3AgentId = l3AgentRes.rows[0]?.id;
  const demoManagerId = managerId ?? adminId;

  if (employeeId) {
    if (demoManagerId) {
      await pool.query("UPDATE users SET manager_id = $1 WHERE id = $2 AND manager_id IS NULL", [demoManagerId, employeeId]);
    }
  }

  // Create comprehensive professional agents for each support level
  const professionalAgents = [
    // L1 Support Team - Frontline agents
    {
      name: "Sarah Johnson",
      email: "sarah.johnson@company.com",
      role: "AGENT",
      team: "L1 Support",
      skills: [
        { category: "IDENTITY_ACCESS", level: 8 },
        { category: "EMAIL_COLLAB", level: 7 },
        { category: "HARDWARE_PERIPHERAL", level: 6 },
        { category: "PASSWORD_RESET", level: 9 }
      ]
    },
    {
      name: "Mike Chen",
      email: "mike.chen@company.com", 
      role: "AGENT",
      team: "L1 Support",
      skills: [
        { category: "EMAIL_COLLAB", level: 8 },
        { category: "HARDWARE_PERIPHERAL", level: 7 },
        { category: "PRINTER_SETUP", level: 6 },
        { category: "BASIC_SOFTWARE", level: 5 }
      ]
    },
    {
      name: "Emily Rodriguez",
      email: "emily.rodriguez@company.com",
      role: "AGENT", 
      team: "L1 Support",
      skills: [
        { category: "IDENTITY_ACCESS", level: 7 },
        { category: "EMAIL_COLLAB", level: 6 },
        { category: "PHONE_SYSTEM", level: 8 },
        { category: "HARDWARE_PERIPHERAL", level: 5 }
      ]
    },
    
    // L2 Technical Support Team
    {
      name: "David Kim",
      email: "david.kim@company.com",
      role: "AGENT",
      team: "L2 Technical Support", 
      skills: [
        { category: "NETWORK_VPN_WIFI", level: 9 },
        { category: "SOFTWARE_INSTALL_LICENSE", level: 8 },
        { category: "BUSINESS_APP_ERP_CRM", level: 7 },
        { category: "ACTIVE_DIRECTORY", level: 8 }
      ]
    },
    {
      name: "Lisa Thompson",
      email: "lisa.thompson@company.com",
      role: "AGENT",
      team: "L2 Technical Support",
      skills: [
        { category: "NETWORK_VPN_WIFI", level: 8 },
        { category: "SOFTWARE_INSTALL_LICENSE", level: 9 },
        { category: "MOBILE_DEVICE_MGMT", level: 7 },
        { category: "BACKUP_RESTORE", level: 6 }
      ]
    },
    {
      name: "James Wilson",
      email: "james.wilson@company.com",
      role: "AGENT",
      team: "L2 Technical Support", 
      skills: [
        { category: "BUSINESS_APP_ERP_CRM", level: 9 },
        { category: "DATABASE_BASIC", level: 7 },
        { category: "SOFTWARE_INSTALL_LICENSE", level: 8 },
        { category: "SCRIPT_AUTOMATION", level: 6 }
      ]
    },

    // L3 Expert Team
    {
      name: "Dr. Robert Chang",
      email: "robert.chang@company.com",
      role: "AGENT",
      team: "L3 Expert Team",
      skills: [
        { category: "SECURITY_INCIDENT", level: 10 },
        { category: "INFRASTRUCTURE", level: 9 },
        { category: "DATABASE_ADVANCED", level: 9 },
        { category: "CLOUD_SERVICES", level: 8 }
      ]
    },
    {
      name: "Maria Garcia",
      email: "maria.garcia@company.com",
      role: "AGENT",
      team: "L3 Expert Team",
      skills: [
        { category: "SECURITY_INCIDENT", level: 9 },
        { category: "NETWORK_VPN_WIFI", level: 10 },
        { category: "FIREWALL_SECURITY", level: 9 },
        { category: "COMPLIANCE_AUDIT", level: 8 }
      ]
    },
    {
      name: "Alex Kumar",
      email: "alex.kumar@company.com",
      role: "AGENT", 
      team: "L3 Expert Team",
      skills: [
        { category: "INFRASTRUCTURE", level: 10 },
        { category: "DATABASE_ADVANCED", level: 8 },
        { category: "CLOUD_SERVICES", level: 9 },
        { category: "DISASTER_RECOVERY", level: 8 }
      ]
    }
  ];

  // Create professional agents with their skills
  for (const agent of professionalAgents) {
    const teamResult = await pool.query<{ id: string }>(
      "SELECT id FROM teams WHERE name = $1",
      [agent.team]
    );
    const teamId = teamResult.rows[0]?.id;

    if (teamId) {
      const agentPasswordHash = await hashPassword("agent123");
      
      const agentResult = await pool.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, team_id, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [agent.name, agent.email.toLowerCase(), agentPasswordHash, agent.role, teamId, orgId]
      );
      
      const agentId = agentResult.rows[0]?.id;
      
      if (agentId) {
        // Add comprehensive skills for each agent
        for (const skill of agent.skills) {
          await pool.query(
            `INSERT INTO agent_skills (agent_id, category, skill_level)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, category) DO UPDATE SET
             skill_level = EXCLUDED.skill_level`,
            [agentId, skill.category, skill.level]
          );
        }
      }
    }
  }

  await pool.query(
    `INSERT INTO kb_articles (title, body, category, tags)
     SELECT $1, $2, $3, $4::text[]
     WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE title = $1)`,
    [
      "VPN not connecting (basic checks)",
      "1) Confirm internet connectivity.\n2) Confirm credentials.\n3) Reboot device.\n4) Reinstall VPN client if needed.\n5) If still failing, attach error screenshot and contact support.",
      "NETWORK_VPN_WIFI",
      ["vpn", "connectivity", "client"],
    ]
  );

  await pool.query(
    `INSERT INTO kb_articles (title, body, category, tags)
     SELECT $1, $2, $3, $4::text[]
     WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE title = $1)`,
    [
      "Email account locked: unlock procedure",
      "If your email account is locked, wait 15 minutes and retry. If the lock persists, contact IT support with your username and last successful login time.",
      "IDENTITY_ACCESS",
      ["email", "account", "locked"],
    ]
  );

  await pool.query(
    `INSERT INTO kb_articles (title, body, category, tags)
     SELECT $1, $2, $3, $4::text[]
     WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE title = $1)`,
    [
      "Wi-Fi connected but no internet",
      "1) Forget and rejoin Wi-Fi.\n2) Disable/enable adapter.\n3) Check captive portal.\n4) Flush DNS.\n5) If multiple users impacted, report as network incident.",
      "NETWORK_VPN_WIFI",
      ["wifi", "dns", "internet"],
    ]
  );

  await pool.query(
    `INSERT INTO kb_articles (title, body, category, tags)
     SELECT $1, $2, $3, $4::text[]
     WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE title = $1)`,
    [
      "Software installation request policy",
      "Software installation requires manager approval and a valid license. Submit a ticket with software name, version, business justification, and device details.",
      "SOFTWARE_INSTALL_LICENSE",
      ["software", "install", "license", "policy"],
    ]
  );

  // Comprehensive Knowledge Base Articles for all question types
  const kbArticles = [
    // Getting Started
    {
      title: "Getting Started: Submit Your First Ticket",
      body: "To submit your first ticket:\n1. Go to Create Ticket\n2. Add a clear subject and detailed description\n3. Choose the correct category\n4. Attach screenshots or logs if available\n5. Submit and track updates from My Tickets",
      category: "KB_GENERAL",
      tags: ["getting-started", "tickets", "help"],
    },
    {
      title: "How to Track Ticket Status",
      body: "You can track ticket status by:\n1. Opening My Tickets\n2. Checking the status badge for each request\n3. Opening a ticket to see updates and comments\n4. Enabling notifications for status changes",
      category: "KB_GENERAL",
      tags: ["getting-started", "tickets", "status"],
    },
    {
      title: "Understanding Priority Levels",
      body: "Priority levels help us respond quickly:\n- Low: non-urgent issues\n- Medium: normal business impact\n- High: major impact or deadline risk\n- Critical: business outage or security incident\nIf you are unsure, select Medium and add details.",
      category: "KB_GENERAL",
      tags: ["getting-started", "priority", "sla"],
    },
    {
      title: "Self-Service Basics",
      body: "Before opening a ticket, try these quick wins:\n1. Restart the affected app/device\n2. Check VPN connection\n3. Verify your password or unlock steps\n4. Search the Knowledge Base\nIf the issue persists, submit a ticket.",
      category: "KB_GENERAL",
      tags: ["getting-started", "self-service", "kb"],
    },
    // Password & Account Access
    {
      title: "How to Reset Your Password",
      body: "To reset your password:\n1. Go to the password reset portal\n2. Enter your username or email\n3. Follow the verification steps\n4. Create a new strong password\n5. If you're locked out, wait 15 minutes or contact IT support",
      category: "IDENTITY_ACCESS",
      tags: ["password", "reset", "account"],
    },
    {
      title: "Account Locked - How to Unlock",
      body: "If your account is locked:\n1. Wait 15 minutes and try again\n2. If still locked, contact IT support\n3. Provide your username and last successful login time\n4. We'll verify your identity and unlock your account",
      category: "IDENTITY_ACCESS",
      tags: ["account", "locked", "unlock"],
    },
    // VPN & Network
    {
      title: "How to Connect to VPN",
      body: "To connect to VPN:\n1. Open the VPN client application\n2. Enter your username and password\n3. Select the appropriate server location\n4. Click Connect\n5. If connection fails, check your internet connection and credentials",
      category: "NETWORK_VPN_WIFI",
      tags: ["vpn", "remote", "connect"],
    },
    {
      title: "WiFi Connection Troubleshooting",
      body: "If WiFi is not working:\n1. Forget the network and reconnect\n2. Restart your device\n3. Check if other devices can connect\n4. Move closer to the router\n5. Update WiFi drivers\n6. Contact IT if issue persists",
      category: "NETWORK_VPN_WIFI",
      tags: ["wifi", "wireless", "connection"],
    },
    // Email
    {
      title: "Email Not Sending - Troubleshooting",
      body: "If emails aren't sending:\n1. Check your internet connection\n2. Verify recipient email address\n3. Check if attachment is too large (max 25MB)\n4. Clear Outlook cache\n5. Restart Outlook\n6. Check if you're over quota",
      category: "EMAIL_COLLAB",
      tags: ["email", "outlook", "sending"],
    },
    {
      title: "Setting Up Email on Mobile Device",
      body: "To set up email on your phone:\n1. Go to Settings > Accounts > Add Account\n2. Select Exchange/Office 365\n3. Enter your email and password\n4. Server: outlook.office365.com\n5. Complete setup and sync",
      category: "EMAIL_COLLAB",
      tags: ["email", "mobile", "setup"],
    },
    // Hardware
    {
      title: "Printer Not Printing - Solutions",
      body: "If printer won't print:\n1. Check if printer is powered on\n2. Verify printer is connected to network\n3. Check printer queue for errors\n4. Restart print spooler service\n5. Reinstall printer driver\n6. Try printing from another device",
      category: "HARDWARE_PERIPHERAL",
      tags: ["printer", "printing", "hardware"],
    },
    {
      title: "Laptop Overheating - What to Do",
      body: "If laptop is overheating:\n1. Shut down and let it cool\n2. Clean vents and fans\n3. Use on hard surface (not bed/couch)\n4. Check for background processes\n5. Update BIOS and drivers\n6. If persists, contact IT for hardware check",
      category: "HARDWARE_PERIPHERAL",
      tags: ["laptop", "overheating", "hardware"],
    },
    // Software
    {
      title: "How to Request Software Installation",
      body: "To request software:\n1. Get manager approval\n2. Submit ticket with software name and version\n3. Provide business justification\n4. Include device information\n5. Wait for license approval\n6. IT will install remotely or provide instructions",
      category: "SOFTWARE_INSTALL_LICENSE",
      tags: ["software", "install", "request"],
    },
    // Security
    {
      title: "What to Do If You Receive a Phishing Email",
      body: "If you receive a suspicious email:\n1. DO NOT click any links or attachments\n2. Forward the email to security@company.com\n3. Delete the email\n4. If you clicked something, immediately contact IT security\n5. Change your password if compromised",
      category: "SECURITY_INCIDENT",
      tags: ["phishing", "security", "email"],
    },
    // Business Apps
    {
      title: "SAP Login Issues - Troubleshooting",
      body: "If you can't login to SAP:\n1. Verify your SAP credentials\n2. Check if your account is active\n3. Clear browser cache\n4. Try different browser\n5. Check VPN connection if remote\n6. Contact SAP support team",
      category: "BUSINESS_APP_ERP_CRM",
      tags: ["sap", "login", "erp"],
    },
    // AI & Modern Features
    {
      title: "Using the AI Assistant for Quick Help",
      body: "# AI Assistant Guide\n\nOur new AI assistant is available 24/7 to help you with common IT issues.\n\n## capabilities:\n- Reset passwords instantly\n- Troubleshoot VPN connections\n- Check ticket status\n- Answer policy questions\n\nTo start, simply click the chat icon in the bottom right corner.",
      category: "BASIC_SOFTWARE",
      tags: ["ai", "assistant", "help", "chat"],
    },
    {
      title: "Remote Work Best Practices",
      body: "# Working Remotely\n\nTo ensure a productive remote work experience:\n\n## Connectivity\n- Use a stable internet connection (ethernet preferred)\n- Always connect to VPN for internal resources\n\n## Security\n- Lock your screen when away\n- Do not share devices with family members\n- Report suspicious emails immediately",
      category: "NETWORK_VPN_WIFI",
      tags: ["remote", "wfh", "policy", "security"],
    },
  ];

  for (const article of kbArticles) {
    await pool.query(
      `INSERT INTO kb_articles (title, body, category, tags)
       SELECT $1, $2, $3, $4::text[]
       WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE title = $1)`,
      [article.title, article.body, article.category, article.tags]
    );
  }

  const workflows = [
    {
      name: "PASSWORD_RESET",
      description: "AI-assisted password reset (requires employee approval)",
      enabled: true,
      priority: 100,
      intent_filter: ["ACCOUNT_ACCESS"],
      category_filter: ["IDENTITY_ACCESS"],
      keyword_filter: ["password"],
      steps: [
        {
          type: "approval",
          name: "Employee approval",
          config: {
            title: "Confirm password reset",
            body: "AI can reset your password and send a reset message. Approve to proceed.",
            expiresInHours: 24,
          },
        },
        {
          type: "ldap_query",
          name: "Password reset",
          config: { action: "password_reset" },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
    {
      name: "ACCOUNT_UNLOCK",
      description: "AI-assisted account unlock (requires employee approval)",
      enabled: true,
      priority: 90,
      intent_filter: ["ACCOUNT_ACCESS"],
      category_filter: ["IDENTITY_ACCESS"],
      keyword_filter: ["unlock"],
      steps: [
        {
          type: "approval",
          name: "Employee approval",
          config: {
            title: "Confirm account unlock",
            body: "AI can unlock your account. Approve to proceed.",
            expiresInHours: 24,
          },
        },
        {
          type: "ldap_query",
          name: "Account unlock",
          config: { action: "account_unlock" },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
    {
      name: "VPN_BASIC_FIX",
      description: "Automated VPN troubleshooting and resolution",
      enabled: true,
      priority: 70,
      intent_filter: null,
      category_filter: ["NETWORK_VPN_WIFI"],
      keyword_filter: ["vpn"],
      steps: [
        {
          type: "approval",
          name: "Employee approval",
          config: {
            title: "Confirm VPN troubleshooting",
            body: "AI can automatically diagnose and fix common VPN issues. Approve to proceed.",
            expiresInHours: 24,
          },
        },
        {
          type: "script",
          name: "VPN diagnostics",
          config: {
            script: `
// Automated VPN troubleshooting script
const issues = [];
const fixes = [];

// Check network connectivity
const networkOk = true; // In real implementation, ping external host
if (!networkOk) {
  issues.push("No internet connectivity");
  fixes.push("Check network cable/wifi connection");
}

// Check VPN client status
const vpnClientOk = true; // In real implementation, check VPN service
if (!vpnClientOk) {
  issues.push("VPN client not running");
  fixes.push("Restart VPN client application");
}

// Check credentials
const credentialsOk = true; // In real implementation, validate credentials
if (!credentialsOk) {
  issues.push("Invalid VPN credentials");
  fixes.push("Verify username and password");
}

// Simulate VPN connection test
const vpnConnectionOk = Math.random() > 0.3; // 70% success rate
if (!vpnConnectionOk) {
  issues.push("VPN connection failed");
  fixes.push("Try alternative VPN server");
}

return {
  diagnosed: true,
  issuesFound: issues.length,
  issues: issues,
  fixes: fixes,
  canAutoFix: issues.length <= 1,
  resolutionSteps: fixes.length > 0 ? fixes : ["VPN connection successful - no issues detected"]
};
            `,
          },
        },
        {
          type: "condition",
          name: "Check if auto-fix possible",
          config: {
            condition: "VPN_diagnostics.canAutoFix == true",
            thenStep: "Apply fixes",
            elseStep: "Provide guidance",
          },
        },
        {
          type: "script",
          name: "Apply fixes",
          config: {
            script: `
// Apply automated fixes
const diagnostics = context.VPN_diagnostics;
const fixesApplied = [];

if (diagnostics.issues.includes("VPN client not running")) {
  fixesApplied.push("Restarted VPN service");
}

if (diagnostics.issues.includes("VPN connection failed")) {
  fixesApplied.push("Connected to backup VPN server");
}

// Simulate successful fix
const fixSuccessful = Math.random() > 0.2; // 80% success rate

return {
  fixesApplied: fixesApplied,
  fixSuccessful: fixSuccessful,
  message: fixSuccessful ? 
    "VPN issues automatically resolved" : 
    "Automated fixes attempted - manual intervention may be required"
};
            `,
          },
        },
        {
          type: "script",
          name: "Provide guidance",
          config: {
            script: `
// Provide manual troubleshooting guidance
const diagnostics = context.VPN_diagnostics;

return {
  guidanceProvided: true,
  manualSteps: [
    "Check your internet connection",
    "Verify VPN credentials are correct",
    "Try restarting your VPN client",
    "Contact IT support if issues persist"
  ],
  nextSteps: diagnostics.issuesFound > 0 ? 
    "Follow the troubleshooting steps above" :
    "VPN appears to be working correctly"
};
            `,
          },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
    {
      name: "PRINTER_TROUBLESHOOT",
      description: "AI-guided printer troubleshooting (requires employee approval)",
      enabled: true,
      priority: 60,
      intent_filter: null,
      category_filter: ["HARDWARE_PERIPHERAL"],
      keyword_filter: ["printer"],
      steps: [
        {
          type: "approval",
          name: "Employee approval",
          config: {
            title: "Confirm printer troubleshooting",
            body: "AI can guide you through printer troubleshooting steps. Approve to proceed.",
            expiresInHours: 24,
          },
        },
        {
          type: "script",
          name: "Printer steps",
          config: {
            script:
              "({ steps: [\"Check printer power and network\", \"Clear print queue\", \"Restart print spooler\", \"Reinstall printer driver\"], note: \"If the issue continues, share printer model and any error code shown.\" })",
          },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
    {
      name: "EMAIL_TROUBLESHOOT_BASIC",
      description: "AI-guided basic email troubleshooting (L1 automation)",
      enabled: true,
      priority: 50,
      intent_filter: null,
      category_filter: ["EMAIL_COLLAB"],
      keyword_filter: ["email", "outlook", "sending", "receiving"],
      steps: [
        {
          type: "approval",
          name: "Employee approval",
          config: {
            title: "Run email diagnostics",
            body: "AI can automatically diagnose and fix common email issues. Approve to proceed.",
            expiresInHours: 24,
          },
        },
        {
          type: "script",
          name: "Email diagnostics",
          config: {
            script: `
// Basic email troubleshooting script
const issues = [];
const fixes = [];
const text = context.ticket.title + " " + context.ticket.description;

// Check for common email issues
if (text.includes("not sending") || text.includes("can't send")) {
  issues.push("Email sending issues detected");
  fixes.push("Check internet connection and recipient address");
}

if (text.includes("not receiving") || text.includes("can't receive")) {
  issues.push("Email receiving issues detected");
  fixes.push("Check spam folder and email filters");
}

if (text.includes("attachment")) {
  issues.push("Attachment related issue");
  fixes.push("Check attachment size limit (25MB max)");
}

// Simulate diagnostic success
const canAutoFix = issues.length <= 1 && Math.random() > 0.3;

return {
  diagnosed: true,
  issuesFound: issues.length,
  issues: issues,
  fixes: fixes,
  canAutoFix: canAutoFix,
  resolutionSteps: canAutoFix ? fixes : ["Manual intervention required - please contact L2 support"]
};
            `,
          },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
    {
      name: "HARDWARE_BASIC_TROUBLESHOOT",
      description: "AI-guided basic hardware troubleshooting (L1 automation)",
      enabled: true,
      priority: 45,
      intent_filter: null,
      category_filter: ["HARDWARE_PERIPHERAL"],
      keyword_filter: ["printer", "monitor", "keyboard", "mouse"],
      steps: [
        {
          type: "approval",
          name: "Employee approval",
          config: {
            title: "Run hardware diagnostics",
            body: "AI can guide you through basic hardware troubleshooting steps. Approve to proceed.",
            expiresInHours: 24,
          },
        },
        {
          type: "script",
          name: "Hardware troubleshooting steps",
          config: {
            script: `
// Basic hardware troubleshooting script
const text = context.ticket.title + " " + context.ticket.description;
let steps = [];

if (text.includes("printer")) {
  steps = [
    "Check printer power and connection",
    "Clear print queue",
    "Restart print spooler service",
    "Reinstall printer driver",
    "Test with different document"
  ];
} else if (text.includes("monitor")) {
  steps = [
    "Check monitor power and cables",
    "Verify display input source",
    "Update display drivers",
    "Test with different device"
  ];
} else if (text.includes("keyboard") || text.includes("mouse")) {
  steps = [
    "Check device connection",
    "Replace batteries if wireless",
    "Test on different USB port",
    "Update device drivers"
  ];
}

return {
  stepsProvided: true,
  troubleshootingSteps: steps,
  requiresEscalation: Math.random() > 0.6,
  nextSteps: steps.length > 0 ? "Follow the troubleshooting steps above" : "Contact L2 support for hardware issues"
};
            `,
          },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
    {
      name: "ACCOUNT_UNLOCK_AUTOMATED",
      description: "Fully automated account unlock (L1 self-service)",
      enabled: true,
      priority: 95,
      intent_filter: ["ACCOUNT_ACCESS"],
      category_filter: ["IDENTITY_ACCESS"],
      keyword_filter: ["unlock", "locked", "account"],
      steps: [
        {
          type: "approval",
          name: "Employee confirmation",
          config: {
            title: "Confirm account unlock",
            body: "AI can automatically unlock your account if it was locked due to failed attempts. Approve to proceed.",
            expiresInHours: 2,
          },
        },
        {
          type: "script",
          name: "Account unlock verification",
          config: {
            script: `
// Account unlock verification and execution
const text = context.ticket.title + " " + context.ticket.description;

// Check if this is a simple unlock request
const isSimpleUnlock = text.includes("unlock") || text.includes("locked");

if (isSimpleUnlock) {
  // Simulate account unlock process
  const unlockSuccessful = Math.random() > 0.2; // 80% success rate
  
  return {
    processed: true,
    unlockSuccessful: unlockSuccessful,
    action: unlockSuccessful ? "Account unlocked successfully" : "Account unlock failed - please contact support",
    requiresEscalation: !unlockSuccessful
  };
} else {
  return {
    processed: false,
    reason: "Complex account issue - requires human review",
    requiresEscalation: true
  };
}
            `,
          },
        },
      ],
      auto_resolve: true,
      create_ticket: false,
    },
  ];

  const visualWorkflowTemplates = [
    {
      name: "Auto Triage and Assignment",
      description: "Automatically route newly created tickets to the right team, notify the manager, and leave a workflow audit comment.",
      category: "Incident Management",
      icon: "account_tree",
      isSystem: true,
      templateData: {
        name: "Auto Triage and Assignment",
        description: "Auto-route tickets when they enter the queue.",
        enabled: true,
        categoryFilter: [],
        triggerType: "ticket_created",
        triggerConfig: {},
        priority: 90,
        nodes: [
          { id: "start-1", type: "start", position: { x: 80, y: 140 }, data: { label: "Ticket Created", description: "Entry point for new tickets." } },
          { id: "condition-1", type: "condition", position: { x: 320, y: 140 }, data: { label: "Check Priority", expression: "ticket.priority == 'HIGH'", description: "Branch critical incidents." } },
          { id: "action-1", type: "action", position: { x: 600, y: 70 }, data: { label: "Assign Escalations", actionType: "assign_ticket", description: "Send urgent issues to the escalation team.", config: { assignedTeamId: null } } },
          { id: "action-2", type: "action", position: { x: 600, y: 220 }, data: { label: "Assign L1 Queue", actionType: "assign_ticket", description: "Send standard issues to L1.", config: { assignedTeamId: null } } },
          { id: "notify-1", type: "notification", position: { x: 860, y: 140 }, data: { label: "Notify Manager", recipientMode: "team_manager", type: "TICKET_ASSIGNED", title: "Ticket routed by workflow", message: "A new ticket has been routed into your team queue." } },
          { id: "end-1", type: "end", position: { x: 1120, y: 140 }, data: { label: "Done", description: "Workflow complete." } },
        ],
        edges: [
          { id: "e1", source: "start-1", target: "condition-1" },
          { id: "e2", source: "condition-1", target: "action-1", condition: "true" },
          { id: "e3", source: "condition-1", target: "action-2", condition: "false" },
          { id: "e4", source: "action-1", target: "notify-1" },
          { id: "e5", source: "action-2", target: "notify-1" },
          { id: "e6", source: "notify-1", target: "end-1" },
        ],
      },
    },
    {
      name: "SLA Risk Outreach",
      description: "Watch ticket updates, add a note, and notify the assigned agent when work needs attention.",
      category: "SLA Governance",
      icon: "schedule",
      isSystem: true,
      templateData: {
        name: "SLA Risk Outreach",
        description: "Keep aging tickets visible to support staff.",
        enabled: true,
        categoryFilter: [],
        triggerType: "ticket_updated",
        triggerConfig: {},
        priority: 80,
        nodes: [
          { id: "start-1", type: "start", position: { x: 80, y: 140 }, data: { label: "Ticket Updated", description: "React to ticket movement." } },
          { id: "condition-1", type: "condition", position: { x: 320, y: 140 }, data: { label: "Waiting For Customer?", expression: "ticket.status == 'WAITING_FOR_CUSTOMER'", description: "Skip agent outreach if we are waiting on the employee." } },
          { id: "delay-1", type: "delay", position: { x: 600, y: 70 }, data: { label: "Short Delay", durationSeconds: 30, description: "Give the queue a small buffer." } },
          { id: "notify-1", type: "notification", position: { x: 860, y: 70 }, data: { label: "Notify Agent", recipientMode: "assigned_agent", type: "TICKET_SLA_RISK", title: "Ticket needs attention", message: "A workflow noticed this ticket may be drifting toward an SLA breach." } },
          { id: "action-1", type: "action", position: { x: 860, y: 220 }, data: { label: "Add Follow-up Note", actionType: "add_comment", description: "Document the outreach in the ticket.", config: { body: "Workflow review: this ticket was checked after an update to keep SLA ownership visible.", isInternal: true } } },
          { id: "end-1", type: "end", position: { x: 1120, y: 140 }, data: { label: "Done", description: "Workflow complete." } },
        ],
        edges: [
          { id: "e1", source: "start-1", target: "condition-1" },
          { id: "e2", source: "condition-1", target: "end-1", condition: "true" },
          { id: "e3", source: "condition-1", target: "delay-1", condition: "false" },
          { id: "e4", source: "delay-1", target: "notify-1" },
          { id: "e5", source: "notify-1", target: "action-1" },
          { id: "e6", source: "action-1", target: "end-1" },
        ],
      },
    },
    {
      name: "Scheduled Ticket Health Check",
      description: "Run a recurring governance check against a designated ticket and notify the requester with a clean status message.",
      category: "Operations",
      icon: "event_repeat",
      isSystem: true,
      templateData: {
        name: "Scheduled Ticket Health Check",
        description: "Recurring workflow for scheduled governance checks.",
        enabled: false,
        categoryFilter: [],
        triggerType: "scheduled",
        triggerConfig: { intervalMinutes: 60, ticketId: "" },
        priority: 50,
        nodes: [
          { id: "start-1", type: "start", position: { x: 80, y: 140 }, data: { label: "Scheduled Run", description: "Runs on the configured interval." } },
          { id: "action-1", type: "action", position: { x: 340, y: 140 }, data: { label: "Add Review Note", actionType: "add_comment", description: "Record the scheduled check.", config: { body: "Scheduled workflow check completed successfully.", isInternal: true } } },
          { id: "notify-1", type: "notification", position: { x: 620, y: 140 }, data: { label: "Notify Requester", recipientMode: "requester", type: "TICKET_STATUS_CHANGED", title: "Scheduled service update", message: "Your ticket was reviewed during the latest scheduled service check." } },
          { id: "end-1", type: "end", position: { x: 900, y: 140 }, data: { label: "Done", description: "Workflow complete." } },
        ],
        edges: [
          { id: "e1", source: "start-1", target: "action-1" },
          { id: "e2", source: "action-1", target: "notify-1" },
          { id: "e3", source: "notify-1", target: "end-1" },
        ],
      },
    },
  ];

  for (const wf of workflows) {
    await pool.query(
      `INSERT INTO workflows
       (name, description, enabled, priority, intent_filter, category_filter, keyword_filter, steps, auto_resolve, create_ticket)
       SELECT $1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8::jsonb, $9, $10
       WHERE NOT EXISTS (SELECT 1 FROM workflows WHERE name = $1)`,
      [
        wf.name,
        wf.description,
        wf.enabled,
        wf.priority,
        wf.intent_filter,
        wf.category_filter,
        wf.keyword_filter,
        JSON.stringify(wf.steps),
        wf.auto_resolve,
        wf.create_ticket,
      ]
    );
  }

  for (const template of visualWorkflowTemplates) {
    await pool.query(
      `INSERT INTO workflow_templates (name, description, category, icon, template_data, is_system)
       SELECT $1::varchar, $2::text, $3::varchar, $4::varchar, $5::jsonb, $6::boolean
       WHERE NOT EXISTS (SELECT 1 FROM workflow_templates WHERE name = $1::varchar)`,
      [
        template.name,
        template.description,
        template.category,
        template.icon,
        JSON.stringify(template.templateData),
        template.isSystem,
      ]
    );
  }

  // System Escalation Workflow (Fixed ID for SLA Monitor)
  await pool.query(
    `INSERT INTO workflows (id, name, description, enabled, priority, steps, auto_resolve, create_ticket)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      "00000000-0000-0000-0000-000000000000",
      "SYSTEM_ESCALATION",
      "System workflow for SLA escalations",
      true,
      0,
      JSON.stringify([{ type: "approval", name: "Manager Escalation", config: { title: "SLA Breach", body: "Ticket breached SLA", expiresInHours: 24 } }]),
      false,
      false
    ]
  );

  // Seed GLPI Configuration
  if (process.env.GLPI_API_URL && process.env.GLPI_APP_TOKEN && process.env.GLPI_USER_TOKEN) {
    const glpiRes = await pool.query("SELECT id FROM external_system_configs WHERE system_type = 'GLPI' LIMIT 1");
    
    if (glpiRes.rows.length === 0) {
      await pool.query(
        `INSERT INTO external_system_configs (system_type, name, api_url, app_token, user_token, enabled, sync_interval_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          'GLPI',
          'GLPI Local',
          process.env.GLPI_API_URL,
          process.env.GLPI_APP_TOKEN,
          process.env.GLPI_USER_TOKEN,
          true,
          15
        ]
      );
      console.log("Seeded GLPI configuration from environment variables");
    } else {
      await pool.query(
        `UPDATE external_system_configs 
         SET api_url = $1, app_token = $2, user_token = $3, enabled = $4 
         WHERE id = $5`,
        [
          process.env.GLPI_API_URL,
          process.env.GLPI_APP_TOKEN,
          process.env.GLPI_USER_TOKEN,
          true,
          glpiRes.rows[0].id
        ]
      );
      console.log("Updated existing GLPI configuration from environment variables");
    }
  }

  // Create Enterprise Teams with hierarchy
  const enterpriseTeams = [
    {
      name: "L1 - Global Service Desk",
      level: "L1",
      desc: "Frontline support for all IT related issues and requests.",
      resps: ["First contact resolution", "Incident logging", "Service request fulfillment", "Basic troubleshooting"]
    },
    {
      name: "L2 - Infrastructure Support",
      level: "L2",
      desc: "Technical escalations for infrastructure, server, and networking issues.",
      resps: ["Complex technical troubleshooting", "Server maintenance", "Network configuration", "System administration"]
    },
    {
      name: "L3 - Engineering & Strategy",
      level: "L3",
      desc: "Expert level support and architectural strategy.",
      resps: ["Root cause analysis", "System architecture", "Strategic planning", "Security auditing"]
    }
  ];

  const teamIds: Record<string, string> = {};

  for (const t of enterpriseTeams) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, support_level, description, roles_and_responsibilities) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (name) DO UPDATE SET 
         support_level = EXCLUDED.support_level,
         description = EXCLUDED.description,
         roles_and_responsibilities = EXCLUDED.roles_and_responsibilities
       RETURNING id`,
      [t.name, t.level, t.desc, JSON.stringify(t.resps)]
    );
    teamIds[t.name] = res.rows[0].id;
  }

  // Create Sub-teams
  const subTeams = [
    {
      name: "L1 - North America Service Desk",
      parent: "L1 - Global Service Desk",
      level: "L1",
      desc: "Regional support for North American business units.",
      resps: ["Regional hardware support", "Local network troubleshooting"]
    },
    {
      name: "L1 - EMEA Service Desk",
      parent: "L1 - Global Service Desk",
      level: "L1",
      desc: "Regional support for Europe, Middle East, and Africa.",
      resps: ["Multi-language support", "Regional compliance"]
    },
    {
      name: "L2 - Cloud & Virtualization",
      parent: "L2 - Infrastructure Support",
      level: "L2",
      desc: "Management of cloud platforms and virtual environments.",
      resps: ["AWS/Azure management", "VMware administration", "Storage optimization"]
    },
    {
      name: "L3 - DevOps Engineering",
      parent: "L3 - Engineering & Strategy",
      level: "L3",
      desc: "CI/CD pipelines, automation, and developer experience.",
      resps: ["Pipeline automation", "Kubernetes orchestration", "Infrastructure as Code"]
    }
  ];

  for (const st of subTeams) {
    await pool.query(
      `INSERT INTO teams (name, parent_team_id, support_level, description, roles_and_responsibilities) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (name) DO UPDATE SET 
         parent_team_id = EXCLUDED.parent_team_id,
         support_level = EXCLUDED.support_level,
         description = EXCLUDED.description,
         roles_and_responsibilities = EXCLUDED.roles_and_responsibilities`,
      [st.name, teamIds[st.parent], st.level, st.desc, JSON.stringify(st.resps)]
    );
  }

  await pool.query(
    `UPDATE teams
     SET parent_team_id = $1
     WHERE name = 'L1 Support'`,
    [teamIds["L1 - Global Service Desk"]]
  );

  await pool.query(
    `UPDATE teams
     SET parent_team_id = $1
     WHERE name = 'L2 Technical Support'`,
    [teamIds["L2 - Infrastructure Support"]]
  );

  await pool.query(
    `UPDATE teams
     SET parent_team_id = $1
     WHERE name = 'L3 Expert Team'`,
    [teamIds["L3 - Engineering & Strategy"]]
  );

  if (demoManagerId) {
    await pool.query(
      `UPDATE teams
       SET manager_id = $1
       WHERE manager_id IS NULL`,
      [demoManagerId]
    );

    await pool.query(
      `UPDATE users u
       SET manager_id = t.manager_id
       FROM teams t
       WHERE u.team_id = t.id
         AND u.role = 'AGENT'
         AND u.manager_id IS NULL
         AND t.manager_id IS NOT NULL`
    );
  }

  console.log("Enterprise teams seeded successfully.");
  await pool.end();
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed", err);
  process.exit(1);
});
