import React from "react";
import { LegalPage } from "./LegalPage";

export const Privacy: React.FC = () => {
  return (
    <LegalPage
      title="Privacy Statement"
      subtitle="This statement explains how PG-IT Service Portal collects, uses, and protects operational and account data within the enterprise support environment."
      icon="privacy"
      updatedOn="April 14, 2026"
      sections={[
        {
          heading: "1. Information We Process",
          body: [
            "PG-IT Service Portal may process account details such as name, email address, department, team, role, location, profile attributes, and authentication-related session metadata to support secure access and role-aware system behavior.",
            "The platform also processes support content including ticket titles, descriptions, comments, approval actions, knowledge base activity, uploaded attachments, and operational workflow records necessary for service delivery.",
          ],
        },
        {
          heading: "2. How Information Is Used",
          body: [
            "Data is used to authenticate users, route tickets, personalize dashboards, monitor SLAs, enforce approvals, maintain audit records, and provide support context to authorized IT staff. Information may also be used to improve workflow automation, analytics, and knowledge recommendations.",
            "Where AI-assisted capabilities are enabled, system content may be analyzed for classification, prioritization, search relevance, or operational insights in accordance with organizational governance controls.",
          ],
        },
        {
          heading: "3. Sharing and Integrations",
          body: [
            "Support data may be shared with authorized internal teams and, where configured, synchronized with approved third-party enterprise systems such as communication platforms, identity providers, CMDB tools, issue trackers, or remote support services.",
            "External sharing is limited to business-necessary integrations and administrative access approved by the organization. The portal is not intended for general public data distribution.",
          ],
        },
        {
          heading: "4. Retention and Monitoring",
          body: [
            "Operational records, audit events, attachments, authentication activity, and service interactions may be retained to support legal obligations, security investigations, service quality review, and internal governance policies.",
            "The organization may monitor platform activity, login behavior, workflow actions, and administrative changes to maintain reliability, detect misuse, and meet compliance or security requirements.",
          ],
        },
        {
          heading: "5. Security Measures",
          body: [
            "The platform uses role-based access control, session controls, authentication safeguards, and internal audit logging to protect enterprise service data. Access is limited to users with a legitimate business need and the permissions required for their role.",
            "No system can guarantee absolute security. Users should avoid uploading unnecessary sensitive content and should report any suspected unauthorized activity immediately.",
          ],
        },
        {
          heading: "6. Your Organization’s Control",
          body: [
            "PG-IT Service Portal is typically operated as an internal enterprise system. Your employer or administering organization may determine what information is required, how long data is retained, which integrations are enabled, and who may access support records.",
            "Questions about data access, correction, deletion, or enterprise policy should be directed to the organization’s IT administration, security team, or designated privacy contact.",
          ],
        },
      ]}
    />
  );
};
