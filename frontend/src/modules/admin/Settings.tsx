import React from "react";
import { Box, Typography, Tabs, Tab, Paper } from "@mui/material";
import { RoutingRules } from "./RoutingRules";
import { AlertRules } from "./AlertRules";
import { Integrations } from "./Integrations";
import { useAuth } from "../../services/auth";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const Settings: React.FC = () => {
  const { user } = useAuth();
  const [value, setValue] = React.useState(0);

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      <Paper sx={{ mt: 3 }}>
        <Tabs value={value} onChange={handleChange} aria-label="settings tabs">
          <Tab label="Routing Rules" />
          <Tab label="Alert Rules" />
          {user?.role === "ADMIN" ? <Tab label="Integrations" /> : null}
        </Tabs>

        <TabPanel value={value} index={0}>
          <RoutingRules />
        </TabPanel>

        <TabPanel value={value} index={1}>
          <AlertRules />
        </TabPanel>

        {user?.role === "ADMIN" ? (
          <TabPanel value={value} index={2}>
            <Integrations />
          </TabPanel>
        ) : null}
      </Paper>
    </Box>
  );
};
