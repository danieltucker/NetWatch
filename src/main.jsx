import './watchtower.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EmbedView }  from './components/EmbedView';
import { LoginPage }  from './components/LoginPage';
import { SetupPage }  from './components/SetupPage';
import { ThemeProvider } from './hooks/useTheme';
import { AuthProvider, useAuth } from './hooks/useAuth';

const path           = window.location.pathname;
const isEmbed        = path === '/embed' || path.startsWith('/embed/');
const embedMonitorId = path.startsWith('/embed/monitor/')
  ? path.replace('/embed/monitor/', '').split('/')[0]
  : null;

function Root() {
  const { user, setupRequired } = useAuth();

  if (isEmbed) return <EmbedView monitorId={embedMonitorId} />;

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen wt-mono"
        style={{ fontSize: 'var(--wt-text-xs)', color: 'var(--wt-text-muted)',
                 backgroundColor: 'var(--wt-bg)' }}>
        Loading…
      </div>
    );
  }

  if (setupRequired) return <SetupPage />;
  if (!user)         return <LoginPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
