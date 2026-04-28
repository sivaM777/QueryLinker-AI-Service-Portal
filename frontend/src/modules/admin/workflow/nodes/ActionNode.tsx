import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Typography, Theme } from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import SettingsIcon from '@mui/icons-material/Settings';

const NodeShell = styled(Box)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  borderRadius: theme.spacing(1.25),
  border: `1px solid ${alpha('#2563EB', 0.25)}`,
  padding: theme.spacing(1),
  minWidth: 150,
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
  background: alpha('#2563EB', 0.12),
  color: '#1E3A8A',
  fontWeight: 700,
  textTransform: 'uppercase',
  fontSize: '0.65rem',
  letterSpacing: '0.06em',
}));

export const ActionNode: React.FC<NodeProps> = ({ data, selected }: NodeProps) => {
  return (
    <NodeShell
      sx={{
        borderColor: selected ? alpha('#2563EB', 0.6) : alpha('#2563EB', 0.25),
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#1E40AF' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#1E40AF' }} />

      <NodeHeader>
        <SettingsIcon sx={{ fontSize: 16 }} />
        Action
      </NodeHeader>

      <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
        {data.label || 'Action'}
      </Typography>

      {data.actionType && (
        <Typography variant="caption" color="text.secondary">
          {data.actionType}
        </Typography>
      )}
    </NodeShell>
  );
};
