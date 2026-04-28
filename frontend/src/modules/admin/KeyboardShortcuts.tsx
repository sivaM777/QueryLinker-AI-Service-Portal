import React from 'react';
import { Box, Typography, Grid, Paper, Divider } from '@mui/material';

export const KeyboardShortcuts: React.FC = () => {
  const shortcuts = [
    { category: "General", items: [
      { key: "Ctrl + K", action: "Open Command Palette" },
      { key: "Esc", action: "Close Dialogs / Menus" },
      { key: "?", action: "Show Keyboard Shortcuts" },
    ]},
    { category: "Navigation", items: [
      { key: "G then H", action: "Go to Home / Dashboard" },
      { key: "G then T", action: "Go to Tickets" },
      { key: "G then K", action: "Go to Knowledge Base" },
      { key: "G then R", action: "Go to Reports" },
    ]},
    { category: "Tickets", items: [
      { key: "C", action: "Create New Ticket" },
      { key: "/", action: "Focus Search" },
      { key: "J / K", action: "Next / Previous Ticket" },
    ]}
  ];

  return (
    <Box sx={{ p: 4, maxWidth: 1000, margin: '0 auto' }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Keyboard Shortcuts
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        Boost your productivity with these keyboard shortcuts.
      </Typography>

      <Grid container spacing={3} sx={{ mt: 2 }}>
        {shortcuts.map((section) => (
          <Grid item xs={12} md={6} key={section.category}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom color="primary">
                {section.category}
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {section.items.map((item) => (
                <Box key={item.key} sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, alignItems: 'center' }}>
                  <Typography variant="body2">{item.action}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {item.key.split(' ').map((k, i) => (
                      <React.Fragment key={i}>
                        {k === '+' || k === 'then' || k === '/' ? (
                           <Typography variant="caption" sx={{ mx: 0.5, color: 'text.secondary', alignSelf: 'center' }}>{k}</Typography>
                        ) : (
                          <Box component="span" sx={{ 
                            px: 1, 
                            py: 0.5, 
                            bgcolor: 'action.selected', 
                            borderRadius: 1, 
                            fontFamily: 'monospace', 
                            fontWeight: 'bold',
                            fontSize: '0.8rem',
                            border: '1px solid',
                            borderColor: 'divider'
                          }}>
                            {k}
                          </Box>
                        )}
                      </React.Fragment>
                    ))}
                  </Box>
                </Box>
              ))}
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};
