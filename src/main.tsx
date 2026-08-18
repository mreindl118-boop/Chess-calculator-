import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import App from './App';
import './styles.css';

if (Capacitor.isNativePlatform()) {
  void StatusBar.setBackgroundColor({ color: '#16191d' }).catch(() => {});
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
