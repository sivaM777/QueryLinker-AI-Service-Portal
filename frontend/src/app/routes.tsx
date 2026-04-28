import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { AuthGuard } from "./auth-guard";
import { RoleGuard } from "./role-guard";
import { EmployeeLayout } from "../layouts/EmployeeLayout";
import { AdminLayout } from "../layouts/AdminLayout";
import { Login } from "../modules/auth/Login";
import { Landing } from "../modules/public/Landing";
import { RegisterOrganization } from "../modules/public/RegisterOrganization";
import { Terms } from "../modules/public/Terms";
import { Privacy } from "../modules/public/Privacy";
import { useAuth } from "../services/auth";
import { Home } from "../modules/employee/Home";
import { MyTickets } from "../modules/employee/MyTickets";
import { TicketDetail as EmployeeTicketDetail } from "../modules/employee/TicketDetail";
import { KbArticleView } from "../modules/kb/KbArticleView";
import { ModernKnowledgeBase } from "../modules/kb/ModernKnowledgeBase";
import { Profile } from "../modules/employee/Profile";
import { Reports as EmployeeReports } from "../modules/employee/Reports";
import { CreateTicket } from "../modules/employee/CreateTicket";
import { Dashboard as AdminDashboard } from "../modules/admin/BentoDashboard";
import { AgentDashboard } from "../modules/admin/AgentDashboard";
import { TicketInbox } from "../modules/admin/TicketInbox";
import { TicketDetail as AdminTicketDetail } from "../modules/admin/TicketDetail";
import { Approvals } from "../modules/admin/Approvals";
import { SlaMonitor } from "../modules/admin/SlaMonitor";
import { KbSuggestions } from "../modules/admin/KbSuggestions";
import { Users } from "../modules/admin/Users";
import { Teams } from "../modules/admin/Teams";
import { Settings } from "../modules/admin/Settings";
import CommandCenter from "../modules/admin/CommandCenter";
import WorkflowBuilder from "../modules/admin/WorkflowBuilder";
import WorkflowStudioPage from "../modules/admin/WorkflowStudioPage";
import AuditLogs from "../modules/admin/AuditLogs";
import { Reports } from "../modules/admin/Reports";
import { AutofixCatalog } from "../modules/admin/AutofixCatalog";
import { Schedule } from "../modules/admin/Schedule";
import { Help } from "../modules/admin/Help";
import { KeyboardShortcuts } from "../modules/admin/KeyboardShortcuts";
import { ManagerDashboard } from "../modules/admin/ManagerDashboard";
import BoardsWorkspace from "../modules/admin/boards/BoardsWorkspace";
import BoardDetail from "../modules/admin/boards/BoardDetail";

const LegacyEmployeeTicketRedirect = () => {
  const { id } = useParams<{ id: string }>();
  if (id === "new") {
    return <Navigate to="/app/create-ticket" replace />;
  }
  return <Navigate to={id ? `/app/tickets/${id}` : "/app/tickets"} replace />;
};

const AdminIndexRedirect = () => {
  const { user } = useAuth();
  
  if (!user) return <Navigate to="/login" replace />;

  console.log("AdminIndexRedirect - User role:", user.role);

  switch (user.role) {
    case "ADMIN":
      return <Navigate to="/admin/dashboard" replace />;
    case "MANAGER":
      return <Navigate to="/admin/manager" replace />;
    case "AGENT":
      return <Navigate to="/admin/agent-dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
};

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Landing />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/register-organization",
    element: <RegisterOrganization />,
  },
  {
    path: "/terms",
    element: <Terms />,
  },
  {
    path: "/privacy",
    element: <Privacy />,
  },
  {
    path: "/tickets",
    element: <Navigate to="/app/tickets" replace />,
  },
  {
    path: "/tickets/:id",
    element: <LegacyEmployeeTicketRedirect />,
  },
  {
    path: "/kb",
    element: <Navigate to="/app/kb" replace />,
  },
  {
    path: "/app",
    element: (
      <AuthGuard>
        <RoleGuard allowedRoles={["EMPLOYEE"]}>
          <EmployeeLayout />
        </RoleGuard>
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: "create-ticket", element: <CreateTicket /> },
      { path: "tickets", element: <MyTickets /> },
      { path: "tickets/:id", element: <EmployeeTicketDetail /> },
      { path: "reports", element: <EmployeeReports /> },
      { path: "kb", element: <ModernKnowledgeBase /> },
      { path: "kb/:id", element: <KbArticleView /> },
      { path: "profile", element: <Profile /> },
      { path: "help", element: <Help /> },
      { path: "shortcuts", element: <KeyboardShortcuts /> },
    ],
  },
  {
    path: "/admin",
    element: (
      <AuthGuard>
        <RoleGuard allowedRoles={["ADMIN", "MANAGER", "AGENT"]}>
          <AdminLayout />
        </RoleGuard>
      </AuthGuard>
    ),
    children: [
      { index: true, element: <AdminIndexRedirect /> },
      { 
        path: "dashboard", 
        element: (
          <RoleGuard allowedRoles={["ADMIN"]}>
            <AdminDashboard />
          </RoleGuard>
        ) 
      },
      { 
        path: "agent-dashboard", 
        element: (
          <RoleGuard allowedRoles={["AGENT"]}>
            <AgentDashboard />
          </RoleGuard>
        ) 
      },
      { 
        path: "manager", 
        element: (
          <RoleGuard allowedRoles={["MANAGER"]}>
            <ManagerDashboard />
          </RoleGuard>
        ) 
      },
      { path: "inbox", element: <TicketInbox /> },
      { path: "tickets", element: <Navigate to="/admin/inbox" replace /> },
      { path: "tickets/:id", element: <AdminTicketDetail /> },
      { path: "approvals", element: <Approvals /> },
      { path: "sla", element: <SlaMonitor /> },
      { path: "kb-suggestions", element: <KbSuggestions /> },
      { 
        path: "users", 
        element: (
          <RoleGuard allowedRoles={["ADMIN", "MANAGER"]}>
            <Users />
          </RoleGuard>
        ) 
      },
      { 
        path: "teams", 
        element: (
          <RoleGuard allowedRoles={["ADMIN", "MANAGER"]}>
            <Teams />
          </RoleGuard>
        ) 
      },
      { path: "settings", element: <Settings /> },
      { 
        path: "command-center", 
        element: (
          <RoleGuard allowedRoles={["ADMIN"]}>
            <CommandCenter />
          </RoleGuard>
        )
      },
      { path: "workflow", element: <WorkflowBuilder /> },
      { path: "workflow/studio", element: <WorkflowStudioPage /> },
      { path: "boards", element: <BoardsWorkspace /> },
      { path: "boards/:id", element: <BoardDetail /> },
      { 
        path: "audit", 
        element: (
          <RoleGuard allowedRoles={["ADMIN"]}>
            <AuditLogs />
          </RoleGuard>
        )
      },
      { path: "reports", element: <Reports /> },
      { path: "autofix", element: <AutofixCatalog /> },
      { path: "schedule", element: <Schedule /> },
      { path: "help", element: <Help /> },
      { path: "shortcuts", element: <KeyboardShortcuts /> },
      { path: "profile", element: <Profile /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
