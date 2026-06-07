import './watchtower.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EmbedView } from './components/EmbedView';
import { ThemeProvider } from './hooks/useTheme';

const path    = window.location.pathname;
const isEmbed = path === '/embed' || path.startsWith('/embed/');
const embedMonitorId = path.startsWith('/embed/monitor/')
  ? path.replace('/embed/monitor/', '').split('/')[0]
  : null;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      {isEmbed
        ? <EmbedView monitorId={embedMonitorId} />
        : <App />
      }
    </ThemeProvider>
  </React.StrictMode>
);
