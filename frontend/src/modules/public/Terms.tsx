import React from "react";
import { LegalPage } from "./LegalPage";

export const Terms: React.FC = () => {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="These terms govern access to PG-IT Service Portal and the operational support services delivered through the platform."
      icon="terms"
      updatedOn="April 14, 2026"
      sections={[
        {
          heading: "1. Scope of Service",
          body: [
            "PG-IT Service Portal is an enterprise service management platform designed to support incident reporting, service requests, knowledge discovery, approvals, workflow automation, and internal IT operations across employees, agents, managers, and administrators.",
            "The service may include integrations with third-party tools such as identity providers, communication platforms, analytics services, CMDB systems, and remote support tools. Availability of specific integrations may vary by deployment or environment.",
          ],
        },
        {
          heading: "2. Acceptable Use",
          body: [
            "Users must provide accurate information when creating accounts, submitting tickets, uploading attachments, or interacting with support workflows. Intentional misuse, submission of malicious files, attempts to circumvent access controls, or disruption of service operations are prohibited.",
            "Employees, agents, managers, and administrators are responsible for using the platform only within the scope of their assigned role and business purpose.",
          ],
        },
        {
          heading: "3. Ticketing and Workflow Operations",
          body: [
            "Tickets created in the portal may be classified, routed, escalated, enriched, or synchronized with connected systems to support enterprise service delivery. Resolution timelines, escalations, and approvals may be governed by organizational SLAs and workflow policies.",
            "Submission of a ticket does not guarantee an immediate resolution. Priority, impact, urgency, dependency, and approval requirements may affect the handling of requests.",
          ],
        },
        {
          heading: "4. Attachments and Submitted Content",
          body: [
            "Users may upload screenshots, documents, logs, or other supporting material to help IT teams investigate issues. Uploaded content must be relevant to the business request and must not contain unlawful, harmful, or unauthorized third-party information.",
            "The organization may retain, inspect, or remove uploaded content as part of operational support, security review, compliance obligations, or incident investigation.",
          ],
        },
        {
          heading: "5. Security and Access Control",
          body: [
            "Access to the platform may be protected by enterprise authentication mechanisms including local credentials, session controls, role-based access, and optional single sign-on providers. The organization may revoke access or terminate sessions to protect operational security.",
            "Users are responsible for maintaining the confidentiality of their access credentials and for promptly reporting suspected unauthorized use or suspicious behavior.",
          ],
        },
        {
          heading: "6. Service Availability and Changes",
          body: [
            "The portal may be modified, updated, suspended, or restricted to support maintenance, performance improvements, governance changes, or incident response. Features shown in development or test environments may differ from production availability.",
            "The organization reserves the right to update these terms as the platform evolves. Continued use of the portal after an update constitutes acceptance of the revised terms.",
          ],
        },
      ]}
    />
  );
};
