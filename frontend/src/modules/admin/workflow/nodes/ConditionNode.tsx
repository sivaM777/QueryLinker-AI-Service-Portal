import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Box, Typography, Theme } from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import CallSplitIcon from '@mui/icons-material/CallSplit';

const NodeShell = styled(Box)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  borderRadius: theme.spacing(1.25),
  border: `1px solid ${alpha('#F59E0B', 0.35)}`,
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
  background: alpha('#F59E0B', 0.15),
  color: '#B45309',
  fontWeight: 700,
  textTransform: 'uppercase',
  fontSize: '0.65rem',
  letterSpacing: '0.06em',
}));

const ConditionBox = styled(Box)(({ theme }: { theme: Theme }) => ({
  marginTop: theme.spacing(1),
  padding: theme.spacing(0.6),
  borderRadius: theme.spacing(0.75),
  background: '#FEF3C7',
  border: `1px dashed ${alpha('#F59E0B', 0.5)}`,
  fontSize: '0.7rem',
  color: '#92400E',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}));

export const ConditionNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <NodeShell
      sx={{
        borderColor: selected ? alpha('#F59E0B', 0.6) : alpha('#F59E0B', 0.35),
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#D97706' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#D97706' }} />

      <NodeHeader>
        <CallSplitIcon sx={{ fontSize: 16 }} />
        Condition
      </NodeHeader>

      <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
        {data.label || 'Condition'}
      </Typography>

      {data.expression && (
        <ConditionBox>{data.expression}</ConditionBox>
      )}
    </NodeShell>
  );
};
