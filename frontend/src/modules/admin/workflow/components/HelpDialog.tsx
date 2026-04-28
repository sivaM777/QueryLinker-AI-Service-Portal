import React from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Chip,
  Theme,
} from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CloseIcon from '@mui/icons-material/Close';

const CommandDialog = styled(Dialog)(({ theme }: { theme: Theme }) => ({
  '& .MuiDialog-paper': {
    background: '#FFFFFF',
    border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
    borderRadius: theme.spacing(2),
  },
}));

const CommandButton = styled(Button)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
  color: theme.palette.text.primary,
  '&:hover': {
    background: '#F1F5F9',
    borderColor: alpha(theme.palette.primary.main, 0.4),
  },
  textTransform: 'none',
  fontWeight: 600,
}));

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export const HelpDialog: React.FC<HelpDialogProps> = ({ open, onClose }) => {
  const keyboardShortcuts = [
    { keys: ['Ctrl', 'S'], description: 'Save workflow' },
    { keys: ['Ctrl', 'Z'], description: 'Undo last action' },
    { keys: ['Ctrl', 'Y'], description: 'Redo last action' },
    { keys: ['Ctrl', 'Enter'], description: 'Execute workflow' },
    { keys: ['Ctrl', 'E'], description: 'Export workflow' },
    { keys: ['Delete'], description: 'Delete selected node' },
    { keys: ['Escape'], description: 'Deselect current node' },
  ];

  const nodeTypes = [
    { type: 'Start Node', description: 'Beginning of the workflow', color: '#10B981' },
    { type: 'End Node', description: 'End of the workflow', color: '#EF4444' },
    { type: 'Action Node', description: 'Perform an action', color: '#2563EB' },
    { type: 'Condition Node', description: 'Branch based on conditions', color: '#F59E0B' },
    { type: 'Delay Node', description: 'Wait for specified time', color: '#0EA5E9' },
    { type: 'Notification Node', description: 'Send notifications', color: '#14B8A6' },
  ];

  const workflowTips = [
    'Always include a Start node and End node',
    'Connect nodes by dragging from one handle to another',
    'Click nodes to edit configuration in the Inspector',
    'Use conditions to create branching flows',
    'Validate and test before deploying',
    'Export workflows as JSON for backup and sharing',
  ];

  return (
    <CommandDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HelpOutlineIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Workflow Builder Help
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <KeyboardIcon fontSize="small" />
            Keyboard Shortcuts
          </Typography>
          <List dense>
            {keyboardShortcuts.map((shortcut, index) => (
              <ListItem key={index} sx={{ px: 0 }}>
                <ListItemIcon sx={{ minWidth: 120 }}>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {shortcut.keys.map((key, keyIndex) => (
                      <Chip
                        key={keyIndex}
                        label={key}
                        size="small"
                        sx={{
                          background: alpha('#0F172A', 0.08),
                          fontWeight: 600,
                          fontSize: '0.75rem',
                        }}
                      />
                    ))}
                  </Box>
                </ListItemIcon>
                <ListItemText primary={shortcut.description} />
              </ListItem>
            ))}
          </List>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Node Types
          </Typography>
          <List dense>
            {nodeTypes.map((nodeType, index) => (
              <ListItem key={index} sx={{ px: 0 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Box
                    sx={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: nodeType.color,
                    }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={nodeType.type}
                  secondary={nodeType.description}
                />
              </ListItem>
            ))}
          </List>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box>
          <Typography variant="h6" gutterBottom>
            Workflow Tips
          </Typography>
          <List dense>
            {workflowTips.map((tip, index) => (
              <ListItem key={index} sx={{ px: 0 }}>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Typography variant="body2" color="primary">-</Typography>
                </ListItemIcon>
                <ListItemText primary={tip} />
              </ListItem>
            ))}
          </List>
        </Box>
      </DialogContent>

      <DialogActions>
        <CommandButton onClick={onClose} startIcon={<CloseIcon />}>
          Close
        </CommandButton>
      </DialogActions>
    </CommandDialog>
  );
};
