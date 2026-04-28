import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";

import { LoginScreen } from "./src/screens/LoginScreen";
import { EmployeeHomeScreen } from "./src/screens/EmployeeHomeScreen";
import { MyTicketsScreen } from "./src/screens/MyTicketsScreen";
import { TicketDetailScreen } from "./src/screens/TicketDetailScreen";
import { AuthProvider, useAuth } from "./src/state/auth";
import { theme } from "./src/ui/theme";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  MyTickets: undefined;
  TicketDetail: { ticketId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNav = () => {
  const { isAuthenticated } = useAuth();
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerShadowVisible: false,
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontWeight: "800" },
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Home" component={EmployeeHomeScreen} options={{ title: "New ticket" }} />
            <Stack.Screen name="MyTickets" component={MyTicketsScreen} options={{ title: "My Tickets" }} />
            <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: "Ticket" }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AppNav />
    </AuthProvider>
  );
}
