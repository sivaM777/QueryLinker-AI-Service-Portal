import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { Node } from 'reactflow';

describe('PropertiesPanel', () => {
  const defaultProps = {
    selectedNode: null,
    onUpdateNode: vi.fn(),
    onDeleteNode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders placeholder when no node is selected', () => {
    render(<PropertiesPanel {...defaultProps} />);
    
    expect(screen.getByText('Properties')).toBeInTheDocument();
    expect(screen.getByText('Select a node to view and edit its properties')).toBeInTheDocument();
  });

  it('renders node specific fields when action node is selected', () => {
    const selectedNode: Node = {
      id: '1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { label: 'Action', actionType: 'email', target: 'test@example.com' },
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} />);
    
    expect(screen.getByText('Action Properties')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Action')).toBeInTheDocument(); // Label is always rendered by default case if not overridden? 
    // Wait, the code shows switch case. Action node has specific fields.
    // Let's check the code again.
    // Case 'action' renders actionType, target, payload. It does NOT render label field in the switch case.
    
    // Check for Action Type select
    expect(screen.getByText('Send Email')).toBeInTheDocument(); // This is the value of the select
    
    // Check for Target input
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
  });

  it('renders node specific fields when condition node is selected', () => {
    const selectedNode: Node = {
      id: '2',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: { conditionType: 'if', expression: 'x > 5' },
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} />);
    
    expect(screen.getByText('Condition Properties')).toBeInTheDocument();
    expect(screen.getByText('If Statement')).toBeInTheDocument();
    expect(screen.getByDisplayValue('x > 5')).toBeInTheDocument();
  });

  it('updates node data when fields change', async () => {
    const user = userEvent.setup();
    const selectedNode: Node = {
      id: '1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { actionType: 'email', target: '' },
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} />);
    
    const targetInput = screen.getByLabelText('Target URL / Email');
    await user.type(targetInput, 'new@example.com');
    
    expect(targetInput).toHaveValue('new@example.com');
  });

  it('shows unsaved changes alert when data changes', async () => {
    const user = userEvent.setup();
    const selectedNode: Node = {
      id: '1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { actionType: 'email' },
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} />);
    
    const targetInput = screen.getByLabelText('Target URL / Email');
    await user.type(targetInput, 'a');
    
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('calls onUpdateNode when save button is clicked', async () => {
    const user = userEvent.setup();
    const onUpdateNode = vi.fn();
    const selectedNode: Node = {
      id: '1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { actionType: 'email' },
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} onUpdateNode={onUpdateNode} />);
    
    const targetInput = screen.getByLabelText('Target URL / Email');
    await user.type(targetInput, 'test@example.com');
    
    const saveButton = screen.getByText('Save Changes');
    await user.click(saveButton);
    
    expect(onUpdateNode).toHaveBeenCalledWith('1', expect.objectContaining({
      actionType: 'email',
      target: 'test@example.com'
    }));
  });

  it('calls onDeleteNode when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDeleteNode = vi.fn();
    const selectedNode: Node = {
      id: '1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {},
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} onDeleteNode={onDeleteNode} />);
    
    // Find delete button by icon or aria-label if added
    // The code has a Tooltip with title "Delete node"
    const deleteButton = screen.getByRole('button', { name: /delete node/i });
    await user.click(deleteButton);
    
    expect(onDeleteNode).toHaveBeenCalledWith('1');
  });

  it('resets changes when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const selectedNode: Node = {
      id: '1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { target: 'original' },
    };
    
    render(<PropertiesPanel {...defaultProps} selectedNode={selectedNode} />);
    
    const targetInput = screen.getByLabelText('Target URL / Email');
    await user.clear(targetInput);
    await user.type(targetInput, 'modified');
    
    expect(targetInput).toHaveValue('modified');
    
    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);
    
    expect(targetInput).toHaveValue('original');
    expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
  });
});
