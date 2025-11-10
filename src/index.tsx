import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
// Axios is used for API calls; enable credentials for session cookies
import axios from 'axios';

// Send cookies with cross-origin requests (frontend 3000 -> backend 8080)
axios.defaults.withCredentials = true;
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
