import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserMenu } from '../UserMenu';
import { BrowserRouter } from 'react-router-dom';

// Mock hooks
const mockUser = {
  id: '1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'ADMIN',
  availability_status: 'ONLINE',
};

const mockLogout = vi.fn();
const mockToggleTheme = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../services/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: mockLogout,
  }),
}));

vi.mock('../../context/ThemeContext', () => ({
  useAppTheme: () => ({
    mode: 'light',
    toggleTheme: mockToggleTheme,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user avatar button', () => {
    render(
      <BrowserRouter>
        <UserMenu />
      </BrowserRouter>
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('opens menu on click', () => {
    render(
      <BrowserRouter>
        <UserMenu />
      </BrowserRouter>
    );
    
    fireEvent.click(screen.getByRole('button'));
    
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
  });

  it('toggles theme', () => {
    render(
      <BrowserRouter>
        <UserMenu />
      </BrowserRouter>
    );
    
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Dark Mode'));
    
    expect(mockToggleTheme).toHaveBeenCalled();
  });

  it('calls logout', () => {
    render(
      <BrowserRouter>
        <UserMenu />
      </BrowserRouter>
    );
    
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Logout'));
    
    expect(mockLogout).toHaveBeenCalled();
  });
});
