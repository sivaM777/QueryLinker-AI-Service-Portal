import React, { useEffect, useRef } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Button,
  Tooltip,
  Theme,
  Chip,
  Stack,
  MenuItem,
  FormControlLabel,
  Switch,
  CircularProgress,
  Typography,
} from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import LibraryBooksRoundedIcon from '@mui/icons-material/LibraryBooksRounded';
import BookmarkAddRoundedIcon from '@mui/icons-material/BookmarkAddRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';

const CommandBar = styled(Box)(({ theme }: { theme: Theme }) => ({
  background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  padding: theme.spacing(1.25, 1.5),
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
  gap: theme.spacing(1.5),
  alignItems: 'center',
}));

const PanelCard = styled(Box)(({ theme }: { theme: Theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.25),
  minWidth: 0,
}));

const CommandButton = styled(Button)(({ theme }: { theme: Theme }) => ({
  borderRadius: 999,
  paddingInline: theme.spacing(1.5),
  textTransform: 'none',
  fontWeight: 700,
  boxShadow: 'none',
}));

const CommandIconButton = styled(IconButton)(({ theme }: { theme: Theme }) => ({
  background: '#FFFFFF',
  border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
  color: theme.palette.text.primary,
  '&:hover': {
    background: '#F1F5F9',
    borderColor: alpha(theme.palette.primary.main, 0.4),
  },
  '&:disabled': {
    background: alpha(theme.palette.action.disabledBackground, 0.3),
    borderColor: alpha(theme.palette.action.disabledBackground, 0.2),
    color: theme.palette.action.disabled,
  },
}));

export interface WorkflowToolbarOption {
  id: string;
  name: string;
  triggerType: string;
  enabled: boolean;
}

interface ToolbarProps {
  mode?: 'full' | 'focus';
  workflowName: string;
  workflowDescription: string;
  onWorkflowNameChange: (name: string) => void;
  onWorkflowDescriptionChange: (description: string) => void;
  hasChanges: boolean;
  statusLabel: string;
  statusDetail: string;
  onSave: () => void;
  onRefresh: () => void;
  onCreateNew: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onExecute: () => void;
  onOpenTemplates: () => void;
  onSaveAsTemplate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onHelp: () => void;
  workflowOptions: WorkflowToolbarOption[];
  selectedWorkflowId: string;
  onSelectWorkflow: (id: string) => void;
  triggerType: string;
  onTriggerTypeChange: (triggerType: string) => void;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  canPersist: boolean;
  isRefreshing: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  isTemplateBusy: boolean;
  importRequestToken?: number;
  onBack?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  mode = 'full',
  workflowName,
  workflowDescription,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  hasChanges,
  statusLabel,
  statusDetail,
  onSave,
  onRefresh,
  onCreateNew,
  onExport,
  onImport,
  onExecute,
  onOpenTemplates,
  onSaveAsTemplate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onHelp,
  workflowOptions,
  selectedWorkflowId,
  onSelectWorkflow,
  triggerType,
  onTriggerTypeChange,
  enabled,
  onEnabledChange,
  canPersist,
  isRefreshing,
  isSaving,
  isExecuting,
  isTemplateBusy,
  importRequestToken,
  onBack,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFocusMode = mode === 'focus';

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImport(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!importRequestToken) return;
    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  }, [importRequestToken]);

  return (
    <CommandBar
      sx={{
        gridTemplateColumns: isFocusMode ? 'minmax(0, 1.25fr) minmax(0, 0.9fr)' : undefined,
      }}
    >
      <PanelCard>
        {isFocusMode && onBack ? (
          <CommandButton variant="outlined" startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ flexShrink: 0 }}>
            Library
          </CommandButton>
        ) : (
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg, rgba(37,99,235,0.14), rgba(14,165,233,0.18))',
              color: '#1D4ED8',
              border: `1px solid ${alpha('#2563EB', 0.16)}`,
              flexShrink: 0,
            }}
          >
            <AccountTreeRoundedIcon />
          </Box>
        )}

        <Box sx={{ minWidth: 0, flex: 1, display: 'grid', gap: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flexWrap: 'wrap' }}>
            <TextField
              value={workflowName}
              onChange={(e) => onWorkflowNameChange(e.target.value)}
              placeholder="Workflow name"
              size="small"
              sx={{
                minWidth: 220,
                maxWidth: isFocusMode ? 420 : 360,
                '& .MuiOutlinedInput-root': {
                  background: '#FFFFFF',
                  borderRadius: 2,
                  fontWeight: 700,
                },
              }}
            />
            <Chip
              label={statusLabel}
              size="small"
              sx={{
                fontWeight: 700,
                background: hasChanges ? alpha('#F59E0B', 0.14) : alpha('#10B981', 0.16),
                color: hasChanges ? '#B45309' : '#047857',
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {statusDetail}
            </Typography>
            {!canPersist && (
              <Chip
                label="View + run only"
                size="small"
                sx={{
                  fontWeight: 700,
                  background: alpha('#2563EB', 0.12),
                  color: '#1D4ED8',
                }}
              />
            )}
          </Stack>

          <TextField
            value={workflowDescription}
            onChange={(e) => onWorkflowDescriptionChange(e.target.value)}
            placeholder="Describe what this workflow automates and why it matters."
            size="small"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                background: '#FFFFFF',
                borderRadius: 2,
              },
            }}
          />
        </Box>
      </PanelCard>

      <Box sx={{ display: 'grid', gap: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" flexWrap="wrap">
          {!isFocusMode && (
            <TextField
              select
              size="small"
              label="Workflow"
              value={selectedWorkflowId}
              onChange={(e) => onSelectWorkflow(e.target.value)}
              sx={{ minWidth: 220, '& .MuiOutlinedInput-root': { background: '#FFFFFF', borderRadius: 2 } }}
            >
              <MenuItem value="">Unsaved draft</MenuItem>
              {workflowOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            select
            size="small"
            label="Trigger"
            value={triggerType}
            onChange={(e) => onTriggerTypeChange(e.target.value)}
            sx={{ minWidth: 156, '& .MuiOutlinedInput-root': { background: '#FFFFFF', borderRadius: 2 } }}
          >
            <MenuItem value="manual">Manual</MenuItem>
            <MenuItem value="ticket_created">Ticket Created</MenuItem>
            <MenuItem value="ticket_updated">Ticket Updated</MenuItem>
            <MenuItem value="scheduled">Scheduled</MenuItem>
            <MenuItem value="api">API</MenuItem>
          </TextField>

          <FormControlLabel
            control={<Switch checked={enabled} onChange={(_, checked) => onEnabledChange(checked)} />}
            label={enabled ? 'Active' : 'Paused'}
            sx={{ mr: 0 }}
          />
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" flexWrap="wrap">
          {!isFocusMode && (
            <Tooltip title="Create a new workflow draft" arrow>
              <span>
                <CommandButton variant="outlined" startIcon={<AddRoundedIcon />} onClick={onCreateNew}>
                  New
                </CommandButton>
              </span>
            </Tooltip>
          )}

          {!isFocusMode && (
            <Tooltip title="Refresh workflow library from the server" arrow>
              <span>
                <CommandButton
                  variant="outlined"
                  startIcon={isRefreshing ? <CircularProgress size={16} /> : <AutorenewRoundedIcon />}
                  onClick={onRefresh}
                  disabled={isRefreshing}
                >
                  Refresh
                </CommandButton>
              </span>
            </Tooltip>
          )}

          <Tooltip title={canPersist ? 'Save to workflow catalog (Ctrl+S)' : 'Only admins can create or update saved workflows'} arrow>
            <span>
              <CommandButton
                variant="contained"
                color="primary"
                startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
                onClick={onSave}
                disabled={!canPersist || !hasChanges || isSaving}
              >
                Save
              </CommandButton>
            </span>
          </Tooltip>

          <Tooltip title="Execute workflow against a ticket (Ctrl+Enter)" arrow>
            <span>
              <CommandButton
                variant="contained"
                color="success"
                startIcon={isExecuting ? <CircularProgress size={16} color="inherit" /> : <PlayArrowRoundedIcon />}
                onClick={onExecute}
                disabled={isExecuting}
              >
                Run
              </CommandButton>
            </span>
          </Tooltip>

          {!isFocusMode && (
            <Tooltip title="Browse starter templates" arrow>
              <span>
                <CommandButton variant="outlined" startIcon={<LibraryBooksRoundedIcon />} onClick={onOpenTemplates}>
                  Templates
                </CommandButton>
              </span>
            </Tooltip>
          )}

          {!isFocusMode && (
            <Tooltip title={canPersist ? 'Save the current workflow as a reusable template' : 'Only admins can save templates'} arrow>
              <span>
                <CommandButton
                  variant="outlined"
                  startIcon={isTemplateBusy ? <CircularProgress size={16} /> : <BookmarkAddRoundedIcon />}
                  onClick={onSaveAsTemplate}
                  disabled={!canPersist || isTemplateBusy}
                >
                  Save Template
                </CommandButton>
              </span>
            </Tooltip>
          )}

          <Tooltip title="Export workflow as JSON" arrow>
            <span>
              <CommandButton variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={onExport}>
                Export
              </CommandButton>
            </span>
          </Tooltip>

          <Tooltip title="Import workflow from JSON" arrow>
            <span>
              <CommandButton variant="outlined" startIcon={<UploadRoundedIcon />} onClick={() => fileInputRef.current?.click()}>
                Import
              </CommandButton>
            </span>
          </Tooltip>

          <Tooltip title="Undo (Ctrl+Z)" arrow>
            <span>
              <CommandIconButton onClick={onUndo} size="small" disabled={!canUndo}>
                <UndoRoundedIcon />
              </CommandIconButton>
            </span>
          </Tooltip>

          <Tooltip title="Redo (Ctrl+Y)" arrow>
            <span>
              <CommandIconButton onClick={onRedo} size="small" disabled={!canRedo}>
                <RedoRoundedIcon />
              </CommandIconButton>
            </span>
          </Tooltip>

          <Tooltip title="Keyboard shortcuts and help" arrow>
            <CommandIconButton onClick={onHelp} size="small">
              <HelpOutlineRoundedIcon />
            </CommandIconButton>
          </Tooltip>
        </Stack>
      </Box>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileImport}
        style={{ display: 'none' }}
      />
    </CommandBar>
  );
};
