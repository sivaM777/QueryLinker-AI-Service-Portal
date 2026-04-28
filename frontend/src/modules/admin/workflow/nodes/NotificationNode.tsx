import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Typography, Theme } from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import NotificationsIcon from '@mui/icons-material/Notifications';

const NodeShell = styled(Box)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  borderRadius: theme.spacing(1.25),
  border: `1px solid ${alpha('#14B8A6', 0.35)}`,
  padding: theme.spacing(1),
  minWidth: 155,
  boxShadow: '0 8px 16px rgba(15, 23, 42, 0.07)',
  transition: 'all 0.2s ease',
  '&:hover': {
    boxShadow: '0 12px 22px rgba(15, 23, 42, 0.12)',
    transform: 'translateY(-1px)',
  },
}));

const NodeHeader = styled(Box)(({ theme }: { theme: Theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(0.4, 0.75),
  borderRadius: theme.spacing(0.75),
  background: alpha('#14B8A6', 0.15),
  color: '#0F766E',
  fontWeight: 700,
  textTransform: 'uppercase',
  fontSize: '0.65rem',
  letterSpacing: '0.06em',
}));

export const NotificationNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <NodeShell
      sx={{
        borderColor: selected ? alpha('#14B8A6', 0.6) : alpha('#14B8A6', 0.35),
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#0D9488' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0D9488' }} />

      <NodeHeader>
        <NotificationsIcon sx={{ fontSize: 16 }} />
        Notify
      </NodeHeader>

      <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
        {data.label || 'Notification'}
      </Typography>

      {data.recipient && (
        <Typography variant="caption" color="text.secondary">
          Recipient: {data.recipient}
        </Typography>
      )}
    </NodeShell>
  );
};
