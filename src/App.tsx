import React from 'react';
import { DataProvider } from '@dhis2/app-runtime';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssReset, CssVariables } from '@dhis2/ui';
import { AppShell } from './pages/AppShell';
import './styles.css';

/**
 * Root. @dhis2/app-runtime's DataProvider injects auth + base URL from the
 * d2 manifest at runtime, so no credentials live in code. React Query owns
 * server-state caching; Zustand owns ephemeral UI state.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 60_000 },
  },
});

const App: React.FC = () => (
  <DataProvider>
    <QueryClientProvider client={queryClient}>
      <CssReset />
      <CssVariables colors spacers theme />
      <AppShell />
    </QueryClientProvider>
  </DataProvider>
);

export default App;
