import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Theme,
  TextField,
  Chip,
  Stack,
} from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

const PaletteItem = styled(ListItemButton)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  borderRadius: theme.spacing(1.25),
  marginBottom: theme.spacing(0.75),
  paddingTop: theme.spacing(0.75),
  paddingBottom: theme.spacing(0.75),
  '&:hover': {
    background: '#F8FAFC',
    borderColor: alpha(theme.palette.primary.main, 0.4),
    transform: 'translateY(-1px)',
  },
  '&:active': {
    transform: 'scale(0.995)',
  },
  transition: 'all 0.18s ease-in-out',
}));

interface ToolboxProps {
  onAddNode: (type: string, data?: any) => void;
}

const nodeCatalog = [
  {
    type: 'start',
    label: 'Start',
    description: 'Entry point for manual, API, or ticket triggers.',
    icon: <PlayArrowRoundedIcon sx={{ color: '#10B981' }} />,
    color: '#10B981',
    group: 'Core',
    defaults: { label: 'Start', description: 'Begin workflow execution.' },
  },
  {
    type: 'action',
    label: 'Action',
    description: 'Assign tickets, update priority, send emails, or call webhooks.',
    icon: <SettingsRoundedIcon sx={{ color: '#2563EB' }} />,
    color: '#2563EB',
    group: 'Automation',
    defaults: { label: 'Action', actionType: 'assign_ticket', description: 'Perform a workflow action.' },
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Branch the workflow based on ticket or execution data.',
    icon: <CallSplitRoundedIcon sx={{ color: '#F59E0B' }} />,
    color: '#F59E0B',
    group: 'Logic',
    defaults: { label: 'Condition', expression: "ticket.priority == 'HIGH'", description: 'Evaluate a branching rule.' },
  },
  {
    type: 'delay',
    label: 'Delay',
    description: 'Pause the run before moving to the next step.',
    icon: <ScheduleRoundedIcon sx={{ color: '#0EA5E9' }} />,
    color: '#0EA5E9',
    group: 'Timing',
    defaults: { label: 'Delay', durationSeconds: 60, description: 'Wait before continuing.' },
  },
  {
    type: 'notification',
    label: 'Notification',
    description: 'Create an in-app notification for the requester, manager, or assigned agent.',
    icon: <NotificationsActiveRoundedIcon sx={{ color: '#14B8A6' }} />,
    color: '#14B8A6',
    group: 'Messaging',
    defaults: { label: 'Notify', recipientMode: 'requester', type: 'TICKET_STATUS_CHANGED', message: 'Workflow update available.' },
  },
  {
    type: 'end',
    label: 'End',
    description: 'Mark the terminal point of the workflow path.',
    icon: <StopRoundedIcon sx={{ color: '#EF4444' }} />,
    color: '#EF4444',
    group: 'Core',
    defaults: { label: 'End', description: 'End workflow execution.' },
  },
] as const;

export const Toolbox: React.FC<ToolboxProps> = ({ onAddNode }) => {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<'All' | 'Core' | 'Automation' | 'Logic' | 'Timing' | 'Messaging'>('All');

  const filteredNodeCatalog = useMemo(() => {
    return nodeCatalog.filter((nodeType) => {
      const matchesGroup = activeGroup === 'All' || nodeType.group === activeGroup;
      const haystack = `${nodeType.label} ${nodeType.description} ${nodeType.group}`.toLowerCase();
      const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
      return matchesGroup && matchesQuery;
    });
  }, [activeGroup, query]);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
          Workflow Components
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Build governed flows with reusable nodes that map to the execution engine.
        </Typography>
      </Box>

      <TextField
        fullWidth
        size="small"
        placeholder="Search nodes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        InputProps={{
          startAdornment: <SearchRoundedIcon sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />,
        }}
        sx={{
          mb: 1.25,
          '& .MuiOutlinedInput-root': {
            background: '#FFFFFF',
            borderRadius: 2,
          },
        }}
      />

      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
        {(['All', 'Core', 'Automation', 'Logic', 'Timing', 'Messaging'] as const).map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            clickable
            color={activeGroup === tag ? 'primary' : 'default'}
            variant={activeGroup === tag ? 'filled' : 'outlined'}
            onClick={() => setActiveGroup(tag)}
          />
        ))}
      </Stack>

      <List dense sx={{ flex: 1, overflowY: 'auto', pr: 0.5 }}>
        {filteredNodeCatalog.map((nodeType) => (
          <Tooltip key={nodeType.type} title={nodeType.description} placement="right" arrow enterDelay={300}>
            <PaletteItem
              onClick={() => onAddNode(nodeType.type, nodeType.defaults)}
              draggable
              onDragStart={(event) => onDragStart(event, nodeType.type)}
              sx={{
                borderLeft: 4,
                borderColor: nodeType.color,
                cursor: 'grab',
              }}
            >
              <ListItemIcon>{nodeType.icon}</ListItemIcon>
              <ListItemText
                primary={nodeType.label}
                secondary={`${nodeType.group} - ${nodeType.description}`}
                primaryTypographyProps={{ fontWeight: 700, fontSize: '0.86rem' }}
                secondaryTypographyProps={{ fontSize: '0.72rem', color: 'text.secondary' }}
              />
            </PaletteItem>
          </Tooltip>
        ))}
      </List>

      <Box sx={{ mt: 'auto', pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          Drag onto the canvas or click to drop a node into the current draft.
        </Typography>
      </Box>
    </Box>
  );
};

