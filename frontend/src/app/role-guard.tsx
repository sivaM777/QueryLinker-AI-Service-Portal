import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../services/auth";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: string[];
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ children, allowedRoles }) => {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    const fallback = user?.role === "ADMIN" || user?.role === "AGENT" || user?.role === "MANAGER" ? "/admin" : "/app";
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
};
