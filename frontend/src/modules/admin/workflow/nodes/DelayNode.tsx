import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Typography, Theme } from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import ScheduleIcon from '@mui/icons-material/Schedule';

const NodeShell = styled(Box)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  borderRadius: theme.spacing(1.25),
  border: `1px solid ${alpha('#0EA5E9', 0.35)}`,
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
  background: alpha('#0EA5E9', 0.15),
  color: '#0369A1',
  fontWeight: 700,
  textTransform: 'uppercase',
  fontSize: '0.65rem',
  letterSpacing: '0.06em',
}));

export const DelayNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <NodeShell
      sx={{
        borderColor: selected ? alpha('#0EA5E9', 0.6) : alpha('#0EA5E9', 0.35),
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#0284C7' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0284C7' }} />

      <NodeHeader>
        <ScheduleIcon sx={{ fontSize: 16 }} />
        Delay
      </NodeHeader>

      <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
        {data.label || 'Delay'}
      </Typography>

      {data.duration && (
        <Typography variant="caption" color="text.secondary">
          Duration: {data.duration}
        </Typography>
      )}
    </NodeShell>
  );
};
