import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from '../components/Toolbar';

describe('Toolbar', () => {
  const defaultProps = {
    workflowName: 'Test Workflow',
    workflowDescription: 'Test description',
    onWorkflowNameChange: vi.fn(),
    onWorkflowDescriptionChange: vi.fn(),
    hasChanges: true,
    statusLabel: 'Unsaved draft',
    statusDetail: 'Auto-saved just now',
    onSave: vi.fn(),
    onRefresh: vi.fn(),
    onCreateNew: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onExecute: vi.fn(),
    onOpenTemplates: vi.fn(),
    onSaveAsTemplate: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: true,
    canRedo: true,
    onHelp: vi.fn(),
    workflowOptions: [{ id: 'wf-1', name: 'Saved WF', triggerType: 'manual', enabled: true }],
    selectedWorkflowId: '',
    onSelectWorkflow: vi.fn(),
    triggerType: 'manual',
    onTriggerTypeChange: vi.fn(),
    enabled: true,
    onEnabledChange: vi.fn(),
    canPersist: true,
    isRefreshing: false,
    isSaving: false,
    isExecuting: false,
    isTemplateBusy: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders primary controls', () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByPlaceholderText('Workflow name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Describe what this workflow automates/i)).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('handles workflow name change', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);
    const input = screen.getByPlaceholderText('Workflow name');
    await user.clear(input);
    await user.type(input, 'New Name');
    expect(defaultProps.onWorkflowNameChange).toHaveBeenCalled();
  });

  it('calls onExecute when run is clicked', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    render(<Toolbar {...defaultProps} onExecute={onExecute} />);
    await user.click(screen.getByText('Run'));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('disables save when cannot persist', () => {
    render(<Toolbar {...defaultProps} canPersist={false} />);
    expect(screen.getByText('Save')).toBeDisabled();
  });
});
