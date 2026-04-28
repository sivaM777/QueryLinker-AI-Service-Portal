# PG-IT Service Portal – Project Report

## Title Page (Edit As Needed)

**PG-IT Service Portal: An Enterprise IT Service Management (ITSM) Web Portal**  
with Ticketing, Knowledge Base, SLA Governance, Workflow Automation, Notifications, and Microsoft Entra ID (Azure AD) SSO

**A Project Report** submitted in partial fulfillment of the requirements for the award of the degree of  
`<YOUR DEGREE (e.g., B.E / B.Tech)>` in `<YOUR BRANCH>`

Submitted by  
- `<Student Name 1>` (`<Register No>`), `<Class/Section>`  
- `<Student Name 2>` (`<Register No>`), `<Class/Section>`  
- `<Student Name 3>` (`<Register No>`), `<Class/Section>`

Under the guidance of  
- `<Guide Name>` – `<Designation / Department>`

`<College Name>`  
`<University Name>`  
`<Month Year>`

---

## Bonafide Certificate (Template)

This is to certify that the project entitled **“PG-IT Service Portal: An Enterprise ITSM Web Portal”** is a bonafide record of the work carried out by `<Student Name(s)>` under my supervision, submitted in partial fulfillment for the award of the degree of `<Degree>` in `<Branch>` during the academic year `<YYYY–YYYY>`.

Guide Signature: ____________________  
Head of Department Signature: ____________________  

---

## Acknowledgement (Edit As Needed)

We express our sincere gratitude to `<College/Department>` for providing us the opportunity to complete this project. We thank our project guide `<Guide Name>` for continuous guidance, encouragement, and valuable suggestions throughout the development. We also thank the faculty members and our friends for their support and feedback.

---

## Abstract

Modern organizations depend on reliable IT operations, yet many service desks still struggle with fragmented communication, weak governance, and limited self-service. The **PG-IT Service Portal** is a role-based enterprise helpdesk platform designed to streamline IT Service Management (ITSM) operations through structured ticketing, knowledge base discovery, SLA monitoring, approvals, workflow automation, and real-time notifications.

The system supports four primary roles—**Employee**, **Agent**, **Manager**, and **Admin**—each with tailored user experiences and access control. Employees can submit incidents and service requests with attachments, track status, and consult the knowledge base to resolve common issues without human intervention. Agents and managers handle triage, assignment, escalation paths (L1/L2/L3), approvals, and operational dashboards. Administrators configure workflows, routing rules, teams, integrations, and governance controls such as audit logs and notification policies.

The portal is implemented using **React + TypeScript** for the frontend, **Fastify + TypeScript** for the backend, and **PostgreSQL** for persistence. **Socket.IO** enables real-time presence, workflow execution streaming, and user-scoped notifications. The application is containerized using **Docker Compose**, making deployment reproducible and portable. Additionally, the platform integrates **Microsoft Entra ID (Azure AD) SSO** to align authentication with enterprise identity management practices.

---

## Table of Contents (Suggested)

- **Chapter 1**: Introduction  
- **Chapter 2**: System Analysis  
- **Chapter 3**: System Design  
- **Chapter 4**: System Development  
- **Chapter 5**: System Testing  
- **Chapter 6**: System Implementation  
- **Chapter 7**: Maintenance  
- **Chapter 8**: Conclusion & Future Enhancements  
- **Chapter 9**: References  
- **Appendices**: Sample Screens, Sample Source Code

---

# CHAPTER 1 – INTRODUCTION

## 1.1 Overview

An enterprise helpdesk is not only a support mailbox—it is an IT Service Management (ITSM) platform that coordinates users, assets, incidents, changes, approvals, and service delivery commitments. A well-designed service portal reduces operational overhead by enabling self-service, enforcing consistent processes, and providing transparency into service status.

The **PG-IT Service Portal** provides an integrated environment for employees to submit and track IT tickets, while enabling agents, managers, and administrators to route, prioritize, escalate, and govern resolution workflows using SLA policies, audit logs, and role-based access control (RBAC).

## 1.2 Problem Statement

In many organizations, IT requests are handled using email threads, spreadsheets, or disconnected tools. This causes:
- Poor visibility of ticket status for employees.
- Manual assignment and slow routing to the correct support group.
- Lack of SLA enforcement and escalation accountability.
- Missing auditability for approvals and administrative actions.
- Repeated issues due to inadequate knowledge base coverage.

The portal addresses these limitations by introducing structured ticket workflows, knowledge-driven self-service, real-time notifications, and enterprise authentication.

## 1.3 Deep Learning / AI (How It Applies in This Project)

This project incorporates AI-assisted capabilities to enhance service desk performance, including:
- Knowledge base suggestion flows to deflect tickets when solutions exist.
- Ticket enrichment/routing helpers (rule-based + AI-assisted where configured).
- Analytics-ready logs for operational insights (e.g., recurring categories).

If your college requires a “Deep Learning” section, present AI as an optional module that enhances routing, recommendations, and self-service—not as a replacement for core ITSM processes.

## 1.4 Aim and Objective

**Aim:** Build an enterprise-grade IT service portal that improves IT request handling, visibility, and governance.

**Objectives:**
- Provide a self-service portal for employees to raise and track tickets.
- Enable agents to resolve issues efficiently with context, assignments, and KB support.
- Enable managers to monitor team workload, approvals, and SLA risk.
- Provide admins tools for workflows, routing, teams, audit logs, and integrations.
- Implement secure authentication and RBAC across the system.
- Provide real-time in-app notifications without cross-user leakage.

## 1.5 Scope of the Project

Included in scope:
- Ticketing (create/update/assign/status, comments, attachments)
- Knowledge base browsing and search
- SLA monitoring and escalation approvals
- Teams (L1/L2/L3) with manager ownership and escalation paths
- Notification system (DB + realtime delivery)
- Workflow Builder (save/load/execute workflow graphs)
- Audit logs for governance
- Microsoft Entra ID (Azure AD) SSO

Out of scope / future:
- Full CMDB (asset relationship mapping and impact analysis)
- Full omnichannel (bi-directional Slack/Teams thread reply)
- Enterprise mobile apps

---

# CHAPTER 2 – SYSTEM ANALYSIS

## 2.1 Existing System

The legacy/typical approach to service desk operations commonly uses:
- Email-based ticket creation with inconsistent templates.
- Manual assignment and escalation through calls/messages.
- Limited reporting, no single dashboard for SLA risk.
- Knowledge sharing via informal documents with poor search.
- Weak governance for approvals and change management actions.

These limitations create delays, repeated incidents, low visibility for users, and lack of audit evidence.

## 2.2 Proposed System

The proposed system is a single portal that provides:
- Role-based dashboards and access control (Employee/Agent/Manager/Admin).
- Ticketing with SLA-aware tracking and escalation.
- Teams with L1/L2/L3 levels and manager ownership.
- Knowledge base for self-service + ticket deflection.
- Workflow automation to standardize response actions.
- Real-time notification system scoped to the correct user only.
- Audit logs for traceability and compliance.
- Enterprise authentication through Microsoft Entra ID (Azure AD) SSO.

## 2.3 System Environment

### 2.3.1 Hardware Configuration (Recommended for Development)
- CPU: Quad-core or above
- RAM: 8 GB minimum (16 GB recommended)
- Storage: 10–20 GB free space
- Network: Stable internet for container image pulls and integrations

### 2.3.2 Software Configuration
- OS: Windows 10/11 (development), Linux recommended for production
- Docker Desktop + Docker Compose
- Node.js (inside containers; optional locally)
- PostgreSQL (inside containers)
- Browser: Chrome/Firefox/Edge

### 2.3.3 About the Software / Tools

- **React + TypeScript:** Component-based UI, fast iteration, strong typing for reliability.
- **Fastify + TypeScript:** High-performance backend, modular routing, clean service-based architecture.
- **PostgreSQL:** ACID database suitable for transactional ticketing data.
- **Socket.IO:** Realtime updates for notifications, presence, and workflow execution feeds.
- **Docker Compose:** Repeatable deployment across machines using consistent containers.

## 2.4 Modules Description

- **Authentication & RBAC:** Local login + Microsoft Entra ID SSO, route guards, role permissions.
- **Ticketing Module:** Ticket create/list/detail, assignments, comments, attachments, relationships.
- **Knowledge Base Module:** Categories, articles, search, featured lists, suggestions.
- **Teams Module:** L1/L2/L3, sub-teams, escalation targets, auto-escalate timers, manager ownership.
- **SLA Module:** SLA due dates, SLA monitor dashboards, breach escalation approvals.
- **Notification Module:** DB-stored notifications + realtime user-scoped delivery and read state.
- **Workflow Builder Module:** Node-edge workflow design, backend persistence, execute against ticket, execution logs.
- **Audit Logs Module:** Governance logging for key actions and compliance reporting.
- **Integrations Module (Extensible):** Email ingestion and external connectors (where configured).

---

# CHAPTER 3 – SYSTEM DESIGN

## 3.1 Database Structure (High-Level)

This section should include a diagram (ER diagram) and a short explanation for each core table.

Suggested key tables and purpose:
- `users`: Stores employee/agent/manager/admin profiles, team mapping, and SSO identity (`azure_ad_id`).
- `teams`: Defines L1/L2/L3 support teams, escalation rules, and `manager_id`.
- `tickets`: Core ITSM entity containing type/status/priority/category/assignment and SLA timestamps.
- `ticket_comments`: Stores conversation history; supports internal notes.
- `ticket_attachments`: Stores file metadata and binary content.
- `notifications`: User-scoped alerts with dedupe keys and read timestamps.
- `workflow_graphs`, `workflow_nodes`, `workflow_edges`: Workflow Builder persistence.
- `workflow_graph_executions`, `workflow_graph_execution_steps`: Execution logs and step-level traceability.
- `audit_logs`: Tracks admin/system actions for compliance and debugging.

Include in your report:
- Primary keys, foreign keys, constraints (status/priority enums), indexes.
- Relationship summary (e.g., ticket → created_by user, ticket → team/agent).

## 3.2 Data Flow Diagram (DFD)

Provide DFD Level 0 and Level 1:
- **Level 0 (Context):** User (Employee/Agent/Manager/Admin) ↔ PG‑IT Portal ↔ Database/Integrations
- **Level 1 (Suggested):**
  - Ticket Submission Flow
  - Ticket Assignment & Escalation Flow
  - Knowledge Base Search Flow
  - Approval Flow
  - Notifications Flow
  - Workflow Execution Flow

## 3.3 System Flow Diagram

Suggested flow (high-level):
1. User authenticates (password or Entra ID SSO).
2. RBAC routes the user to role dashboard.
3. Employee creates ticket → ticket stored in DB → notification events created → SLA timers computed.
4. Agent/Manager/Admin views queues → assigns/escalates → updates status/comments.
5. Workflow Builder can execute standard actions on tickets (assign, notify, email, webhook, delay).
6. Audit logs record governance actions.

---

# CHAPTER 4 – SYSTEM DEVELOPMENT

## 4.1 Development Methodology

Use an iterative approach:
- Requirements → UI wireframes → database schema → API endpoints → UI integration → realtime events → testing.
- Each module is developed as a separate service layer to avoid tight coupling.

## 4.2 Frontend Development

Key UI elements:
- Role-based layouts and route guards.
- Ticket creation page with attachment upload.
- Professional admin console pages (teams, users, workflow builder, audit logs).
- Knowledge base with categories and article discovery.
- Notification center (bell) with read state.

## 4.3 Backend Development

Key backend design:
- Modular Fastify route structure per domain.
- Service layer implementing business rules.
- Zod validation for request payload consistency.
- Realtime socket authentication via session cookies/JWT verification.
- Strong ownership checks to prevent cross-user data leakage.

## 4.4 Workflow Builder Implementation (Important Section)

The Workflow Builder uses a node-edge graph model:
- Nodes represent steps (start/action/condition/delay/notification/end).
- Edges represent execution order and conditional branches.
- Workflows persist in PostgreSQL (`workflow_graphs`, `workflow_nodes`, `workflow_edges`).
- Executions create a traceable record (`workflow_graph_executions` + step logs).
- Socket updates stream execution progress to the UI.

Include screenshots:
- Studio canvas
- Inspector panel
- Run dialog
- Execution feed overlay

---

# CHAPTER 5 – SYSTEM TESTING

## 5.1 Software Testing

Testing types applied:
- **Functional testing:** ticket create/list/detail, comments, assignment, workflow execute.
- **Role-based security testing:** verify employees cannot access admin routes; managers see only team scope.
- **Data isolation testing:** notifications are user-scoped; no cross-user leakage.
- **Integration testing:** docker deployment, DB migrations, API-to-UI flows.
- **UI testing:** form validation, required fields, error visibility.

## 5.2 Test Cases (Sample)

Create a table in your document with columns:
- Test Case ID
- Module
- Steps
- Expected Result
- Actual Result
- Status (Pass/Fail)

Suggested test cases:
- Employee creates ticket with attachment → attachment saved and visible.
- Agent assigns ticket to another agent → assignment reflected in list/detail.
- Manager views team workload → shows only tickets under their teams.
- Workflow Builder: save workflow → appears in workflow list; run workflow → execution events appear.
- Notifications: create ticket → only requester receives “Ticket submitted” notification.
- SSO: login via Entra ID → user is created/linked and routed by RBAC.

## 5.3 Test Reports

Summarize:
- Total cases executed
- Pass percentage
- Critical bugs fixed (e.g., notification leak)
- Remaining limitations and future improvements

---

# CHAPTER 6 – SYSTEM IMPLEMENTATION

## 6.1 Deployment (Docker Compose)

Typical run command:
- `docker compose -p p-itserviceportal up -d --build --no-deps backend frontend`

Runtime access:
- Frontend via Nginx: `http://localhost:3000`
- Backend internal port: `8000` (proxied by Nginx)

## 6.2 User Operation (By Role)

**Employee**
- Login → Create ticket → Upload attachment → Track status → Browse KB

**Agent**
- Login → View ticket inbox → Update status/comments → Resolve/escalate → Use canned responses/KB

**Manager**
- Login → Monitor SLA risk and workload → Approve escalation requests → Manage team flow

**Admin**
- Login → Manage users and teams → Configure workflow builder and governance → Review audit logs → Configure integrations

---

# CHAPTER 7 – MAINTENANCE

Maintenance practices:
- Regular DB backups (tickets + audit logs are critical).
- Log monitoring for errors and failed integrations.
- Rotate secrets (e.g., SSO client secrets) and follow least-privilege.
- Periodic review of workflow definitions and SLA policies.
- Security reviews: validate RBAC, sanitize uploads, limit webhook targets, audit admin actions.

---

# CHAPTER 8 – CONCLUSION & FUTURE ENHANCEMENTS

## 8.1 Conclusion

The PG‑IT Service Portal provides a unified ITSM platform with role-based operations, SLA governance, workflow automation, and realtime communication. By standardizing ticket handling and enabling self-service, the system improves operational efficiency and transparency for both employees and IT teams.

## 8.2 Future Enhancements

- CMDB module to link assets and assess outage impact.
- Bi-directional Slack/Teams omnichannel support (threaded replies and OAuth install).
- Advanced AI triage (intent classification + workload-aware routing).
- Scheduled workflow triggers and automatic execution on ticket_created/ticket_updated.
- Enhanced analytics (CSAT, first-contact resolution, trend clustering).

---

# CHAPTER 9 – REFERENCES

Use a numbered list in your final PDF. Example references:
- Fastify Documentation
- React Documentation
- PostgreSQL Documentation
- Socket.IO Documentation
- Microsoft Entra ID / OAuth2 / OIDC Documentation
- Docker Compose Documentation

---

# APPENDICES

## Appendix 1: Sample Screens (Checklist)

Include screenshots for:
- Login (password + Microsoft SSO)
- Employee create ticket (with attachment box)
- Ticket list and ticket detail
- Knowledge base page
- Teams page (L1/L2/L3)
- Notifications dropdown
- Workflow Builder (studio + run dialog + execution feed)
- Audit logs page

## Appendix 2: Sample Source Code (Checklist)

Include short excerpts (not full code) for:
- Ticket create API schema + handler
- Notification insert + realtime emit
- Workflow save/load/execute route + service logic
- RBAC middleware

