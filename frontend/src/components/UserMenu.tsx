import React, { useState } from "react";
import {
  Box,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Badge,
  Tooltip,
  useTheme
} from "@mui/material";
import {
  Logout,
  Person,
  Help,
  Keyboard,
  Circle
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { useAuth, type User } from "../services/auth";
import { UserAvatar } from "./UserAvatar";
import { api } from "../services/api";

export const UserMenu: React.FC = () => {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleClose();
    logout();
  };

  type AvailabilityStatus = NonNullable<User["availability_status"]>;

  const handleStatusChange = async (status: AvailabilityStatus) => {
    if (!user) return;
    try {
        const res = await api.patch(`/users/me`, { availability_status: status });
        if (res?.data?.availability_status) {
          updateUser({ availability_status: res.data.availability_status });
        } else {
          updateUser({ availability_status: status });
        }
    } catch (e) {
        console.error("Failed to update status", e);
    }
  };

  const statusColor = (status: string | undefined | null) => {
    switch (status) {
        case "ONLINE": return "success.main";
        case "BUSY": return "error.main";
        case "AWAY": return "warning.main";
        case "ON_BREAK": return "info.main";
        default: return "text.disabled";
    }
  };

  return (
    <>
      <IconButton
        onClick={handleOpen}
        size="small"
        sx={{ ml: 2 }}
        aria-controls={open ? "account-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
      >
        <Badge
            overlap="circular"
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            variant="dot"
            sx={{
                '& .MuiBadge-badge': {
                    backgroundColor: statusColor(user?.availability_status),
                    color: statusColor(user?.availability_status),
                    boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
                    '&::after': {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        animation: user?.availability_status === 'ONLINE' ? 'ripple 1.2s infinite ease-in-out' : 'none',
                        border: '1px solid currentColor',
                        content: '""',
                    },
                },
                '@keyframes ripple': {
                    '0%': { transform: 'scale(.8)', opacity: 1 },
                    '100%': { transform: 'scale(2.4)', opacity: 0 },
                },
            }}
        >
            <UserAvatar size={32} />
        </Badge>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        id="account-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        PaperProps={{
          elevation: 0,
          sx: {
            overflow: "visible",
            filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
            mt: 1.5,
            width: 320,
            "& .MuiAvatar-root": {
              width: 32,
              height: 32,
              ml: -0.5,
              mr: 1,
            },
            "&:before": {
              content: '""',
              display: "block",
              position: "absolute",
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: "background.paper",
              transform: "translateY(-50%) rotate(45deg)",
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <UserAvatar size={48} />
                <Box>
                    <Typography variant="subtitle1" fontWeight="bold" noWrap>
                        {user?.name || "User"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                        {user?.email}
                    </Typography>
                    <Typography variant="caption" sx={{ 
                        display: 'inline-block', 
                        bgcolor: 'primary.main', 
                        color: 'white', 
                        px: 0.8, 
                        py: 0.2, 
                        borderRadius: 1,
                        mt: 0.5,
                        fontSize: '0.65rem',
                        fontWeight: 600
                    }}>
                        {user?.role}
                    </Typography>
                </Box>
            </Box>
        </Box>
        
        <Divider />

        <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight="bold">
                STATUS
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Tooltip title="Available">
                    <IconButton 
                        size="small" 
                        onClick={(e) => { e.stopPropagation(); handleStatusChange("ONLINE"); }}
                        sx={{ border: user?.availability_status === 'ONLINE' ? `2px solid ${theme.palette.success.main}` : '1px solid transparent' }}
                    >
                        <Circle sx={{ color: "success.main", fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
                <Tooltip title="On Break">
                    <IconButton 
                        size="small" 
                        onClick={(e) => { e.stopPropagation(); handleStatusChange("ON_BREAK"); }}
                        sx={{ border: user?.availability_status === 'ON_BREAK' ? `2px solid ${theme.palette.info.main}` : '1px solid transparent' }}
                    >
                        <Circle sx={{ color: "info.main", fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Away">
                    <IconButton 
                        size="small" 
                        onClick={(e) => { e.stopPropagation(); handleStatusChange("AWAY"); }}
                        sx={{ border: user?.availability_status === 'AWAY' ? `2px solid ${theme.palette.warning.main}` : '1px solid transparent' }}
                    >
                        <Circle sx={{ color: "warning.main", fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Do Not Disturb">
                    <IconButton 
                        size="small" 
                        onClick={(e) => { e.stopPropagation(); handleStatusChange("BUSY"); }}
                        sx={{ border: user?.availability_status === 'BUSY' ? `2px solid ${theme.palette.error.main}` : '1px solid transparent' }}
                    >
                        <Circle sx={{ color: "error.main", fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
            </Box>
        </Box>

        <Divider />

        <MenuItem onClick={() => { handleClose(); navigate(user?.role === 'EMPLOYEE' ? '/app/profile' : '/admin/profile'); }}>
          <ListItemIcon>
            <Person fontSize="small" />
          </ListItemIcon>
          <ListItemText>My Profile</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => { handleClose(); navigate(user?.role === 'EMPLOYEE' ? '/app/shortcuts' : '/admin/shortcuts'); }}>
          <ListItemIcon>
            <Keyboard fontSize="small" />
          </ListItemIcon>
          <ListItemText>Keyboard Shortcuts</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => { handleClose(); navigate(user?.role === 'EMPLOYEE' ? '/app/help' : '/admin/help'); }}>
          <ListItemIcon>
            <Help fontSize="small" />
          </ListItemIcon>
          <ListItemText>Help & Documentation</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          <ListItemText>Logout</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};
