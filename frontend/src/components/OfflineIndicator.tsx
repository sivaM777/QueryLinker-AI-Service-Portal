import React, { useState, useEffect } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { WifiOff, Wifi } from '@mui/icons-material';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowBackOnline(true);
      // Hide the "back online" message after 3 seconds
      setTimeout(() => setShowBackOnline(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <>
      <Snackbar 
        open={!isOnline} 
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert 
          severity="error" 
          icon={<WifiOff fontSize="inherit" />}
          variant="filled"
          sx={{ width: '100%', boxShadow: 3 }}
        >
          You are offline. Some features may not be available.
        </Alert>
      </Snackbar>

      <Snackbar 
        open={showBackOnline} 
        autoHideDuration={3000} 
        onClose={() => setShowBackOnline(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert 
          severity="success" 
          icon={<Wifi fontSize="inherit" />}
          variant="filled"
          sx={{ width: '100%', boxShadow: 3 }}
        >
          You are back online!
        </Alert>
      </Snackbar>
    </>
  );
};
