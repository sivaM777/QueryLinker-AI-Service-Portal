import { env } from "../../config/env.js";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

export interface SmsConfig {
  provider: "twilio" | "aws-sns" | "custom";
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  customApiUrl?: string;
  customApiKey?: string;
}

let smsConfig: SmsConfig | null = null;

/**
 * Initialize SMS service with configuration
 */
export function initSmsService(config: SmsConfig): void {
  smsConfig = config;
}

/**
 * Send SMS message
 */
export async function sendSms(to: string, message: string): Promise<void> {
  if (!smsConfig) {
    console.warn("SMS service not configured");
    return;
  }

  // Validate phone number format (basic)
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(to.replace(/[\s-]/g, ""))) {
    throw new Error(`Invalid phone number format: ${to}`);
  }

  // Limit message length (SMS limit is 160 chars, but we'll allow longer for multi-part)
  const maxLength = 1600; // 10 SMS segments
  if (message.length > maxLength) {
    message = message.substring(0, maxLength - 3) + "...";
  }

  try {
    switch (smsConfig.provider) {
      case "twilio":
        await sendViaTwilio(to, message);
        break;
      case "aws-sns":
        await sendViaAwsSns(to, message);
        break;
      case "custom":
        await sendViaCustom(to, message);
        break;
      default:
        throw new Error(`Unsupported SMS provider: ${smsConfig.provider}`);
    }
  } catch (err) {
    console.error(`Failed to send SMS to ${to}:`, err);
    throw err;
  }
}

/**
 * Send SMS via Twilio
 */
async function sendViaTwilio(to: string, message: string): Promise<void> {
  if (!smsConfig?.twilioAccountSid || !smsConfig?.twilioAuthToken || !smsConfig?.twilioFromNumber) {
    throw new Error("Twilio configuration incomplete");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${smsConfig.twilioAccountSid}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append("To", to);
  formData.append("From", smsConfig.twilioFromNumber);
  formData.append("Body", message);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${smsConfig.twilioAccountSid}:${smsConfig.twilioAuthToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twilio API error: ${error}`);
  }
}

/**
 * Send SMS via AWS SNS
 */
async function sendViaAwsSns(to: string, message: string): Promise<void> {
  if (
    !smsConfig?.awsAccessKeyId ||
    !smsConfig?.awsSecretAccessKey ||
    !smsConfig?.awsRegion
  ) {
    throw new Error("AWS SNS configuration incomplete");
  }

  const client = new SNSClient({
    region: smsConfig.awsRegion,
    credentials: {
      accessKeyId: smsConfig.awsAccessKeyId,
      secretAccessKey: smsConfig.awsSecretAccessKey,
    },
  });

  const cmd = new PublishCommand({
    PhoneNumber: to,
    Message: message,
    MessageAttributes: {
      "AWS.SNS.SMS.SMSType": {
        DataType: "String",
        StringValue: "Transactional",
      },
    },
  });

  await client.send(cmd);
}

/**
 * Send SMS via custom API
 */
async function sendViaCustom(to: string, message: string): Promise<void> {
  if (!smsConfig?.customApiUrl) {
    throw new Error("Custom SMS API URL not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (smsConfig.customApiKey) {
    headers["Authorization"] = `Bearer ${smsConfig.customApiKey}`;
  }

  const response = await fetch(smsConfig.customApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      to,
      message,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Custom SMS API error: ${error}`);
  }
}

/**
 * Format SMS message for ticket notifications
 */
export function formatTicketSms(args: {
  type: "created" | "assigned" | "status_changed" | "sla_breach";
  ticketId: string;
  title: string;
  status?: string;
  priority?: string;
}): string {
  const ticketRef = args.ticketId.substring(0, 8).toUpperCase();

  switch (args.type) {
    case "created":
      return `Ticket ${ticketRef} created: ${args.title}`;
    case "assigned":
      return `Ticket ${ticketRef} assigned to you: ${args.title} (${args.priority || "N/A"})`;
    case "status_changed":
      return `Ticket ${ticketRef} status: ${args.status} - ${args.title}`;
    case "sla_breach":
      return `URGENT: Ticket ${ticketRef} SLA breach - ${args.title}`;
    default:
      return `Ticket ${ticketRef}: ${args.title}`;
  }
}
