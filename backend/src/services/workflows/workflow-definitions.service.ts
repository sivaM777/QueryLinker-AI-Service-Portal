/**
 * Workflow Definitions - Maps AI categories to automation workflows
 * These are the intermediate-level auto-resolution workflows that execute
 * real actions after user approval
 */

import { Workflow, WorkflowStep } from "./auto-resolution.service.js";
import { pool } from "../../config/db.js";

/**
 * Generate a UUID from a string (deterministic)
 */
function stringToUUID(str: string): string {
  // Create a deterministic UUID v5-like hash from string
  const hex = Buffer.from(str).toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Convert workflow steps to a Workflow object and ensure it exists in DB
 */
export async function workflowToObject(steps: WorkflowStep[], category: string): Promise<Workflow> {
  const id = stringToUUID(`wf_${category}`);
  const name = `Auto-resolution for ${category}`;
  
  // Insert workflow into database if it doesn't exist (to satisfy FK constraint)
  try {
    await pool.query(
      `INSERT INTO workflows (id, name, description, enabled, priority, auto_resolve, create_ticket, steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        name,
        `Auto-resolution workflow for ${category} issues`,
        true,
        100,
        true,
        false,
        JSON.stringify(steps),
      ]
    );
  } catch (err) {
    console.error("Failed to insert workflow:", err);
  }
  
  return {
    id,
    name,
    enabled: true,
    priority: 100,
    intent_filter: null,
    category_filter: [category],
    keyword_filter: null,
    auto_resolve: true,
    create_ticket: false,
    steps,
  };
}

/**
 * Get workflow steps for a specific category/issue type
 * Also checks title/description for keyword matching when category doesn't match
 */
export function getWorkflowForCategory(category: string, text?: string): WorkflowStep[] | null {
  const normalized = category.toUpperCase().replace(/[-_\s]/g, "_");
  const normalizedText = (text || "").toUpperCase();

  // Access request workflow (manager approval → mock grant → resolve)
  const accessTextHit = ["ACCESS", "PERMISSION", "FOLDER ACCESS", "GRANT", "LICENSE", "ROLE"].some((k) =>
    normalizedText.includes(k)
  );
  const accessCategoryHit = ["IDENTITY_ACCESS"].some((k) => normalized.includes(k));
  const softwareLicenseHit =
    normalized.includes("SOFTWARE_INSTALL_LICENSE") && ["LICENSE", "ENTITLEMENT", "ACTIVATION", "ACCESS"].some((k) => normalizedText.includes(k));

  if (accessTextHit || accessCategoryHit || softwareLicenseHit) {
    return [
      {
        type: "approval",
        name: "manager_approval_access",
        config: {
          title: "Manager approval required",
          body: "This looks like an access request. With approval from your manager, IT can grant access automatically.",
          expiresInHours: 48,
          approver: "manager",
        },
      },
      {
        type: "api_call",
        name: "grant_access",
        config: {
          url: "http://localhost:8000/api/v1/automation/access/grant",
          method: "POST",
          body: {
            ticket_id: "{{ticketId}}",
          },
          responsePath: "success",
        },
        onFailure: "escalate_access",
      },
      {
        type: "script",
        name: "resolve_access",
        config: {
          script: "{ success: true, message: 'Access request processed', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_access",
        config: {
          script: "{ success: false, message: 'Access automation failed - escalated', action: 'escalate' }",
        },
      },
    ];
  }

  // VPN Issues Workflow
  if (["VPN", "NETWORK", "CONNECTIVITY", "REMOTE_ACCESS"].some((k) => normalized.includes(k)) ||
      ["VPN", "NETWORK", "CONNECTIVITY", "REMOTE ACCESS"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_vpn_reset",
        config: {
          title: "Reset VPN Session",
          body: "AI detected a VPN connectivity issue. I can reset your VPN session to fix this. This will clear your current VPN connection and allow you to reconnect fresh.",
          expiresInHours: 24,
        },
      },
      {
        type: "api_call",
        name: "reset_vpn",
        config: {
          url: "http://localhost:8000/api/v1/automation/vpn/reset",
          method: "POST",
          body: {
            action: "vpn_reset",
          },
          responsePath: "success",
        },
        onFailure: "escalate_vpn",
      },
      {
        type: "approval",
        name: "verify_vpn_fix",
        config: {
          title: "Verify VPN Fix",
          body: "The VPN session has been reset. Can you confirm your VPN is now working?",
          expiresInHours: 48,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_vpn",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'VPN issue resolved', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_vpn",
        config: {
          script: "{ success: false, message: 'VPN auto-fix failed - escalating to network team', action: 'escalate' }",
        },
      },
    ];
  }

  // Password Issues Workflow
  if (["PASSWORD", "LOGIN", "AUTHENTICATION", "ACCOUNT_LOCK", "CREDENTIALS"].some((k) => normalized.includes(k)) ||
      ["PASSWORD", "LOGIN", "AUTHENTICATION", "ACCOUNT LOCK", "CREDENTIALS"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_password_reset",
        config: {
          title: "Reset Account Password",
          body: "AI detected you may be having password issues. I can reset your password and send a temporary password to your email. You'll need to change it on your next login.",
          expiresInHours: 4,
        },
      },
      {
        type: "api_call",
        name: "reset_password",
        config: {
          url: "http://localhost:8000/api/v1/automation/password/reset",
          method: "POST",
          body: {
            action: "password_reset",
          },
          responsePath: "success",
        },
        onFailure: "escalate_password",
      },
      {
        type: "delay",
        name: "wait_for_email",
        config: {
          durationMs: 3000,
        },
      },
      {
        type: "approval",
        name: "verify_password_fix",
        config: {
          title: "Verify Password Reset",
          body: "A temporary password has been sent to your email. Please check your inbox and confirm you can log in.",
          expiresInHours: 24,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_password",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'Password reset successful', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_password",
        config: {
          script: "{ success: false, message: 'Password reset failed - escalating to IT team', action: 'escalate' }",
        },
      },
    ];
  }

  // Account Unlock Workflow
  if (["LOCKED", "LOCKOUT", "SUSPENDED", "DISABLED"].some((k) => normalized.includes(k)) ||
      ["LOCKED", "LOCKOUT", "SUSPENDED", "DISABLED"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_unlock",
        config: {
          title: "Unlock Account",
          body: "AI detected your account may be locked due to failed login attempts. I can unlock your account immediately.",
          expiresInHours: 2,
        },
      },
      {
        type: "api_call",
        name: "unlock_account",
        config: {
          url: "http://localhost:8000/api/v1/automation/account/unlock",
          method: "POST",
          body: {
            action: "account_unlock",
          },
          responsePath: "success",
        },
        onFailure: "escalate_unlock",
      },
      {
        type: "approval",
        name: "verify_unlock",
        config: {
          title: "Verify Account Access",
          body: "Your account has been unlocked. Please try logging in now.",
          expiresInHours: 24,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_unlock",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'Account unlocked successfully', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_unlock",
        config: {
          script: "{ success: false, message: 'Account unlock failed - escalating to IT security', action: 'escalate' }",
        },
      },
    ];
  }

  // Email Issues Workflow
  if (["EMAIL", "OUTLOOK", "MAILBOX", "EXCHANGE"].some((k) => normalized.includes(k)) ||
      ["EMAIL", "OUTLOOK", "MAILBOX", "EXCHANGE"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_email_sync",
        config: {
          title: "Sync Email Account",
          body: "AI detected email synchronization issues. I can sync your email account and refresh connections. This will not delete any emails.",
          expiresInHours: 24,
        },
      },
      {
        type: "api_call",
        name: "sync_email",
        config: {
          url: "http://localhost:8000/api/v1/automation/email/sync",
          method: "POST",
          body: {
            action: "email_sync",
          },
          responsePath: "success",
        },
        onFailure: "escalate_email",
      },
      {
        type: "approval",
        name: "verify_email_fix",
        config: {
          title: "Verify Email Fix",
          body: "Email sync has been completed. Please restart your email client and check if emails are now syncing properly.",
          expiresInHours: 48,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_email",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'Email sync successful', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_email",
        config: {
          script: "{ success: false, message: 'Email sync failed - escalating to messaging team', action: 'escalate' }",
        },
      },
    ];
  }

  // Software Issues Workflow
  if (["SOFTWARE", "APPLICATION", "APP", "INSTALL", "CRASH"].some((k) => normalized.includes(k)) ||
      ["SOFTWARE", "APPLICATION", "APP", "INSTALL", "CRASH"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_software_repair",
        config: {
          title: "Repair Software",
          body: "AI detected software issues. I can attempt to repair the software installation. This may require a restart after completion.",
          expiresInHours: 24,
        },
      },
      {
        type: "api_call",
        name: "repair_software",
        config: {
          url: "http://localhost:8000/api/v1/automation/software/repair",
          method: "POST",
          body: {
            action: "software_repair",
          },
          responsePath: "success",
        },
        onFailure: "escalate_software",
      },
      {
        type: "approval",
        name: "verify_software_fix",
        config: {
          title: "Verify Software Fix",
          body: "Software repair has been completed. Please restart the application and confirm it's working properly.",
          expiresInHours: 48,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_software",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'Software repair successful', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_software",
        config: {
          script: "{ success: false, message: 'Software repair failed - escalating to desktop support', action: 'escalate' }",
        },
      },
    ];
  }

  // Printer Issues Workflow
  if (["PRINTER", "PRINTING", "SPOOLER"].some((k) => normalized.includes(k)) ||
      ["PRINTER", "PRINTING", "SPOOLER"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_printer_reset",
        config: {
          title: "Reset Printer Queue",
          body: "AI detected printer issues. I can clear the print queue and restart the print spooler service.",
          expiresInHours: 24,
        },
      },
      {
        type: "api_call",
        name: "reset_printer",
        config: {
          url: "http://localhost:8000/api/v1/automation/printer/reset",
          method: "POST",
          body: {
            action: "printer_reset",
          },
          responsePath: "success",
        },
        onFailure: "escalate_printer",
      },
      {
        type: "approval",
        name: "verify_printer_fix",
        config: {
          title: "Verify Printer Fix",
          body: "Printer queue has been cleared. Please try printing a test page.",
          expiresInHours: 48,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_printer",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'Printer reset successful', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_printer",
        config: {
          script: "{ success: false, message: 'Printer reset failed - escalating to hardware support', action: 'escalate' }",
        },
      },
    ];
  }

  // Web/App Issues Workflow
  if (["WEB", "BROWSER", "CACHE", "SLOW", "LOADING"].some((k) => normalized.includes(k)) ||
      ["WEB", "BROWSER", "CACHE", "SLOW", "LOADING"].some((k) => normalizedText.includes(k))) {
    return [
      {
        type: "approval",
        name: "approve_clear_cache",
        config: {
          title: "Clear Browser Cache",
          body: "AI detected web performance issues. I can guide you through clearing your browser cache which often resolves loading issues.",
          expiresInHours: 24,
        },
      },
      {
        type: "api_call",
        name: "clear_cache_instructions",
        config: {
          url: "http://localhost:8000/api/v1/automation/browser/clear-cache",
          method: "POST",
          body: {
            action: "clear_browser_cache",
          },
          responsePath: "success",
        },
        onFailure: "escalate_web",
      },
      {
        type: "approval",
        name: "verify_cache_fix",
        config: {
          title: "Verify Web Fix",
          body: "Please clear your browser cache using the provided instructions, then reload the page. Is the issue resolved?",
          expiresInHours: 48,
        },
      },
      {
        type: "condition",
        name: "check_verification",
        config: {
          condition: "approved == true",
          thenStep: "resolve_ticket",
          elseStep: "escalate_web",
        },
      },
      {
        type: "script",
        name: "resolve_ticket",
        config: {
          script: "{ success: true, message: 'Browser cache cleared successfully', action: 'auto_resolve' }",
        },
      },
      {
        type: "script",
        name: "escalate_web",
        config: {
          script: "{ success: false, message: 'Web issue persists - escalating to application support', action: 'escalate' }",
        },
      },
    ];
  }

  // No matching workflow found
  return null;
}

/**
 * Get all available workflow categories
 */
export function getWorkflowCategories(): { id: string; name: string; description: string }[] {
  return [
    { id: "VPN", name: "VPN & Network", description: "Reset VPN sessions and fix connectivity issues" },
    { id: "PASSWORD", name: "Password & Login", description: "Reset passwords and unlock accounts" },
    { id: "ACCOUNT", name: "Account Issues", description: "Account lockouts and access problems" },
    { id: "EMAIL", name: "Email & Outlook", description: "Sync email and fix mailbox issues" },
    { id: "SOFTWARE", name: "Software", description: "Repair applications and fix crashes" },
    { id: "PRINTER", name: "Printers", description: "Clear print queues and fix spooler issues" },
    { id: "WEB", name: "Web & Browser", description: "Clear cache and fix loading issues" },
  ];
}

/**
 * Check if a category has an auto-resolution workflow available
 */
export function hasAutoResolutionWorkflow(category: string): boolean {
  return getWorkflowForCategory(category) !== null;
}
