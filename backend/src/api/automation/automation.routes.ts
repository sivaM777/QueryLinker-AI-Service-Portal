import { FastifyPluginAsync } from "fastify";

/**
 * Mock Automation API endpoints
 * These simulate real IT infrastructure actions for the auto-resolution workflow
 */

export const automationRoutes: FastifyPluginAsync = async (server) => {
  // VPN Session Reset
  server.post(
    "/automation/vpn/reset",
    async (request, reply) => {
      const body = request.body as { user_id?: string; email?: string; ticket_id?: string };
      
      // Simulate VPN session reset
      console.log(`[AUTOMATION] Resetting VPN session for user: ${body.user_id || body.email || "unknown"}`);
      
      // Mock processing delay
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      return reply.send({
        success: true,
        action: "vpn_reset",
        message: "VPN session reset successfully. Please wait 2 minutes before reconnecting.",
        details: {
          sessions_cleared: 1,
          cache_refreshed: true,
          user_notified: true,
        },
      });
    }
  );

  // Password Reset
  server.post(
    "/automation/password/reset",
    async (request, reply) => {
      const body = request.body as { user_id?: string; email?: string; username?: string; ticket_id?: string };
      
      // Simulate password reset
      console.log(`[AUTOMATION] Resetting password for: ${body.username || body.email || "unknown"}`);
      
      // Mock processing delay
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      // Generate temporary password
      const tempPassword = `Temp${Math.random().toString(36).substring(2, 8).toUpperCase()}!`;
      
      return reply.send({
        success: true,
        action: "password_reset",
        message: `Password has been reset. Temporary password sent to email.`,
        details: {
          temp_password: tempPassword,
          email_sent: true,
          force_change_on_login: true,
          expiry_hours: 24,
        },
      });
    }
  );

  // Account Unlock
  server.post(
    "/automation/account/unlock",
    async (request, reply) => {
      const body = request.body as { user_id?: string; username?: string; email?: string; ticket_id?: string };
      
      // Simulate account unlock
      console.log(`[AUTOMATION] Unlocking account for: ${body.username || body.email || "unknown"}`);
      
      // Mock processing delay
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      return reply.send({
        success: true,
        action: "account_unlock",
        message: "Account has been unlocked. You can now log in.",
        details: {
          lockout_cleared: true,
          failed_attempts_reset: true,
          unlock_time: new Date().toISOString(),
        },
      });
    }
  );

  // Email Sync/Reconnect
  server.post(
    "/automation/email/sync",
    async (request, reply) => {
      const body = request.body as { user_id?: string; email?: string; ticket_id?: string };
      
      // Simulate email sync
      console.log(`[AUTOMATION] Syncing email for: ${body.email || "unknown"}`);
      
      // Mock processing delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      return reply.send({
        success: true,
        action: "email_sync",
        message: "Email synchronization completed. Please restart your email client.",
        details: {
          mailbox_synced: true,
          cache_cleared: true,
          connections_refreshed: 3,
        },
      });
    }
  );

  // Browser Cache Clear (for web app issues)
  server.post(
    "/automation/browser/clear-cache",
    async (request, reply) => {
      const body = request.body as { user_id?: string; ticket_id?: string };
      
      // This is a client-side action, provide instructions
      return reply.send({
        success: true,
        action: "clear_browser_cache",
        message: "Browser cache clear instructions provided to user.",
        details: {
          requires_user_action: true,
          instructions: [
            "Press Ctrl+Shift+Delete (Windows) or Cmd+Shift+Delete (Mac)",
            "Select 'Cached images and files'",
            "Click 'Clear data'",
            "Restart browser and try again",
          ],
        },
      });
    }
  );

  // Software Install/Repair
  server.post(
    "/automation/software/repair",
    async (request, reply) => {
      const body = request.body as { user_id?: string; software_name?: string; ticket_id?: string };
      
      console.log(`[AUTOMATION] Repairing software: ${body.software_name || "unknown"}`);
      
      await new Promise((resolve) => setTimeout(resolve, 3000));
      
      return reply.send({
        success: true,
        action: "software_repair",
        message: `Software ${body.software_name || "application"} has been repaired.`,
        details: {
          software_name: body.software_name,
          repair_completed: true,
          requires_restart: true,
        },
      });
    }
  );

  // Printer Reset
  server.post(
    "/automation/printer/reset",
    async (request, reply) => {
      const body = request.body as { printer_id?: string; ticket_id?: string };
      
      console.log(`[AUTOMATION] Resetting printer: ${body.printer_id || "default"}`);
      
      await new Promise((resolve) => setTimeout(resolve, 1200));
      
      return reply.send({
        success: true,
        action: "printer_reset",
        message: "Printer queue cleared and spooler restarted.",
        details: {
          queue_cleared: true,
          spooler_restarted: true,
          jobs_cancelled: 5,
        },
      });
    }
  );

  // License Reactivation
  server.post(
    "/automation/license/reactivate",
    async (request, reply) => {
      const body = request.body as { user_id?: string; product?: string; ticket_id?: string };
      
      console.log(`[AUTOMATION] Reactivating license for: ${body.product || "unknown"}`);
      
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      return reply.send({
        success: true,
        action: "license_reactivate",
        message: `License for ${body.product || "product"} has been reactivated.`,
        details: {
          license_key: "XXXX-XXXX-XXXX-XXXX",
          activation_successful: true,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
    }
  );

  // Access Grant (mock)
  server.post("/automation/access/grant", async (request, reply) => {
    const body = request.body as { user_id?: string; email?: string; resource?: string; ticket_id?: string };
    console.log(`[AUTOMATION] Granting access to ${body.resource || "resource"} for ${body.user_id || body.email || "unknown"}`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return reply.send({
      success: true,
      action: "access_grant",
      message: `Access granted for ${body.resource || "requested resource"}.`,
      details: {
        resource: body.resource || null,
        granted_at: new Date().toISOString(),
      },
    });
  });

  // Get automation action status
  server.get(
    "/automation/status/:actionId",
    async (request, reply) => {
      const params = request.params as { actionId: string };
      
      return reply.send({
        action_id: params.actionId,
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    }
  );

  // List available automation actions
  server.get(
    "/automation/actions",
    async (_request, reply) => {
      return reply.send({
        actions: [
          { id: "vpn_reset", name: "VPN Session Reset", category: "VPN", description: "Clear VPN sessions and reset connection" },
          { id: "password_reset", name: "Password Reset", category: "Account", description: "Reset user password and send temp password via email" },
          { id: "account_unlock", name: "Account Unlock", category: "Account", description: "Unlock locked user account" },
          { id: "email_sync", name: "Email Sync", category: "Email", description: "Sync email mailbox and refresh connections" },
          { id: "clear_cache", name: "Clear Browser Cache", category: "Web", description: "Provide instructions to clear browser cache" },
          { id: "software_repair", name: "Software Repair", category: "Software", description: "Repair corrupted software installation" },
          { id: "printer_reset", name: "Printer Reset", category: "Hardware", description: "Clear printer queue and restart spooler" },
          { id: "license_reactivate", name: "License Reactivation", category: "Software", description: "Reactivate software license" },
        ],
      });
    }
  );
};
