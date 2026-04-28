import React from "react";
import {
  Box,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import { useNavigate } from "react-router-dom";
import { useAuth, type User } from "../services/auth";

const roleHome: Record<User["role"], string> = {
  ADMIN: "/admin/dashboard",
  MANAGER: "/admin/manager",
  AGENT: "/admin/agent-dashboard",
  EMPLOYEE: "/app",
};

const roleLabel: Record<User["role"], string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  EMPLOYEE: "Employee",
};

export const DemoRoleSwitcher: React.FC = () => {
  const { user, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [switching, setSwitching] = React.useState(false);

  if (!user?.organization_is_demo) return null;

  const changeRole = async (nextRole: User["role"]) => {
    if (nextRole === user.role || switching) return;
    setSwitching(true);
    try {
      await demoLogin(nextRole);
      navigate(roleHome[nextRole], { replace: true });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        mr: { xs: 0.5, md: 1.2 },
        px: 1,
        py: 0.45,
        borderRadius: 999,
        border: "1px solid rgba(37,99,235,0.18)",
        bgcolor: "rgba(37,99,235,0.07)",
      }}
    >
      <ScienceOutlinedIcon sx={{ fontSize: 18, color: "#2563eb" }} />
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Typography variant="caption" sx={{ color: "#1d4ed8", fontWeight: 900, lineHeight: 1 }}>
          DEMO
        </Typography>
      </Box>
      <FormControl size="small" variant="standard" sx={{ minWidth: { xs: 92, md: 132 } }}>
        <Select
          value={user.role}
          disableUnderline
          onChange={(event) => void changeRole(event.target.value as User["role"])}
          renderValue={(value) => (
            <Typography variant="body2" sx={{ fontWeight: 800, color: "#0f172a" }}>
              {switching ? "Switching..." : roleLabel[value as User["role"]]}
            </Typography>
          )}
          sx={{
            "& .MuiSelect-select": { py: 0.2, pr: "22px !important" },
          }}
        >
          {(Object.keys(roleLabel) as User["role"][]).map((role) => (
            <MenuItem key={role} value={role}>
              {roleLabel[role]}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {switching ? <CircularProgress size={14} /> : null}
    </Stack>
  );
};
