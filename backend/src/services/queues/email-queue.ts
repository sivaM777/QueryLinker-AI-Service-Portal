import { Queue, Worker, Job } from "bullmq";
import { pool } from "../../config/db.js";
import { processEmailToTicket } from "./email-processor.service.js";

// Redis connection configuration
const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

// Email processing queue
export const emailQueue = new Queue("email-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Email job data interface
export interface EmailJobData {
  emailSourceId: string;
  rawEmail: {
    subject: string;
    text: string;
    html: string | null;
    from: string;
    to: string[];
    date: Date;
    messageId: string;
    attachments: Array<{
      filename: string;
      contentType: string;
      content: Buffer;
    }>;
  };
}

// Add email to processing queue
export async function queueEmailForProcessing(
  emailSourceId: string,
  rawEmail: EmailJobData["rawEmail"]
): Promise<Job<EmailJobData>> {
  return emailQueue.add(
    "process-email",
    {
      emailSourceId,
      rawEmail,
    },
    {
      priority: 1,
    }
  );
}

// Worker to process emails
export const emailWorker = new Worker<EmailJobData>(
  "email-processing",
  async (job) => {
    const { emailSourceId, rawEmail } = job.data;

    console.log(`[EmailWorker] Processing job ${job.id} for source ${emailSourceId}`);

    try {
      // Record ingestion event
      await pool.query(
        `INSERT INTO email_ingestion_events (email_source_id, event_type, details)
         VALUES ($1, $2, $3)`,
        [
          emailSourceId,
          "processing_started",
          JSON.stringify({
            jobId: (job as any).id,
            subject: rawEmail.subject,
            from: rawEmail.from,
          }),
        ]
      );

      // Process the email (deduplication, AI classification, ticket creation)
      const result = await processEmailToTicket(emailSourceId, rawEmail);

      // Record completion
      await pool.query(
        `INSERT INTO email_ingestion_events (email_source_id, event_type, details)
         VALUES ($1, $2, $3)`,
        [
          emailSourceId,
          result.success ? "processing_completed" : "processing_failed",
          JSON.stringify({
            jobId: (job as any).id,
            ticketId: result.ticketId,
            error: result.error,
          }),
        ]
      );

      console.log(`[EmailWorker] Job ${(job as any).id} completed:`, result);

      return result;
    } catch (error) {
      console.error(`[EmailWorker] Job ${(job as any).id} failed:`, error);

      // Record failure
      await pool.query(
        `INSERT INTO email_ingestion_events (email_source_id, event_type, details)
         VALUES ($1, $2, $3)`,
        [
          emailSourceId,
          "processing_error",
          JSON.stringify({
            jobId: (job as any).id,
            error: error instanceof Error ? error.message : String(error),
          }),
        ]
      );

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process up to 5 emails concurrently
  }
);

// Worker event handlers
emailWorker.on("completed", (job: Job) => {
  console.log(`[EmailWorker] Job ${(job as any).id} completed successfully`);
});

emailWorker.on("failed", (job: Job | undefined, err: Error) => {
  console.error(`[EmailWorker] Job ${(job as any)?.id} failed:`, err.message);
});

// Graceful shutdown
export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
  await emailWorker.close();
}
