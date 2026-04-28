import React, { createContext, useContext, useState, useMemo } from "react";
import { ThemeProvider as MuiThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useAppTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within an AppThemeProvider");
  }
  return context;
};

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize from local storage or default to 'light'
  const [mode, setModeState] = useState<ThemeMode>("light");

  const setMode = (_mode: ThemeMode) => {
    // Force light mode always
    setModeState("light");
    localStorage.setItem("app-theme", "light");
  };

  const toggleTheme = () => {
    // No-op or force light
    setMode("light");
  };

  // Calculate actual palette mode
  const resolvedMode = "light";

  const theme = useMemo(() => createTheme({
    palette: {
      mode: "light",
      primary: {
        main: "#2563EB", // Primary Blue
        dark: "#1E40AF", // Primary Dark
        light: "#DBEAFE", // Primary Light
      },
      secondary: {
        main: "#10B981", // Success Green
      },
      error: {
        main: "#EF4444", // Danger Red
      },
      warning: {
        main: "#F59E0B", // Warning Orange
      },
      info: {
        main: "#3B82F6", // Info Blue
      },
      background: {
        default: "#F3F4F6",
        paper: "#FFFFFF",
      },
      text: {
        primary: "#111827",
        secondary: "#374151",
      },
      action: {
        active: "rgba(0, 0, 0, 0.54)",
        hover: "rgba(0, 0, 0, 0.04)",
        selected: "rgba(0, 0, 0, 0.08)",
        disabled: "rgba(0, 0, 0, 0.26)",
        disabledBackground: "rgba(0, 0, 0, 0.12)",
      },
    },
    typography: {
      fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      h1: { fontFamily: "'Space Grotesk', Manrope, sans-serif", fontSize: "2rem", fontWeight: 700, lineHeight: 1.2 },
      h2: { fontFamily: "'Space Grotesk', Manrope, sans-serif", fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.3 },
      h3: { fontFamily: "'Space Grotesk', Manrope, sans-serif", fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.4 },
      h4: { fontFamily: "'Space Grotesk', Manrope, sans-serif", fontSize: "1.125rem", fontWeight: 500, lineHeight: 1.4 },
      body1: { fontSize: "1rem", lineHeight: 1.5 },
      body2: { fontSize: "0.875rem", lineHeight: 1.5 },
      button: { fontSize: "0.875rem", fontWeight: 500, textTransform: "none" },
      caption: { fontSize: "0.75rem", lineHeight: 1.4 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            scrollbarWidth: 'thin',
            scrollbarColor: '#CBD5E1 #F1F5F9',
          },
          body: {
            scrollbarWidth: 'thin',
            scrollbarColor: '#CBD5E1 #F1F5F9',
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: '#F1F5F9',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#CBD5E1',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              backgroundColor: '#94A3B8',
            },
          },
        },
      },
        MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            padding: "8px 16px",
            textTransform: "none",
            boxShadow: "none",
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: "inherit",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: "#FFFFFF",
            color: "#111827",
            borderBottom: "1px solid rgba(0,0,0,0.1)",
          },
        },
      },
    },
  }), [resolvedMode]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
