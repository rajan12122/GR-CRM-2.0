import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Box, CssBaseline, ThemeProvider, Typography, useMediaQuery, BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import * as Icons from 'lucide-react';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import theme from './theme/theme';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import GlobalSearch from './components/GlobalSearch';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import ModuleManager from './pages/ModuleManager';
import PipelineView from './pages/PipelineView';
import EntityDetail from './pages/EntityDetail';
import Attendance from './pages/Attendance';
import Settings from './pages/Settings';
import LocationTracker from './pages/LocationTracker';
import PullToRefresh from './components/PullToRefresh';
import PublicIntake from './pages/PublicIntake';
import QuickAdd from './pages/QuickAdd';
import LeadNotificationListener from './components/LeadNotificationListener';
import Salary from './pages/Salary';
import AppUpdater from './components/AppUpdater';
import AIAssistantDrawer from './components/AIAssistantDrawer';
import { Routes as DomRoutes, Route as DomRoute } from 'react-router-dom';

import { useParams } from 'react-router-dom';

const ModuleRouteGuard = ({ element, moduleName, action = 'view' }) => {
  const { hasPermission } = useApp();
  return hasPermission(moduleName, action) ? element : <Navigate to="/" replace />;
};

const ModuleManagerWrapper = () => {
  const { moduleName } = useParams();
  const { hasPermission } = useApp();
  return hasPermission(moduleName, 'view') ? <ModuleManager key={moduleName} /> : <Navigate to="/" replace />;
};

const EntityDetailWrapper = () => {
  const { moduleName, id } = useParams();
  const { hasPermission } = useApp();
  return hasPermission(moduleName, 'view') ? <EntityDetail key={`${moduleName}-${id}`} /> : <Navigate to="/" replace />;
};

const PipelineViewWrapper = () => {
  const { pipelineType } = useParams();
  const { hasPermission } = useApp();
  const moduleToCheck = (pipelineType === 'buyer_query' || pipelineType === 'customers') ? 'follow_ups' : (pipelineType === 'seller_query' ? 'queries' : (pipelineType === 'property_pitches' ? 'property_pitch_history' : pipelineType));
  return hasPermission(moduleToCheck, 'view') ? <PipelineView key={pipelineType} /> : <Navigate to="/" replace />;
};

const MainLayout = () => {
  const { token, loadingMetadata, reloadKey, triggerAppReload, hasPermission, user } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width:900px)');
  const navigate = useNavigate();
  const location = useLocation();

  // Request location permission on startup for native mobile app
  React.useEffect(() => {
    const requestLocationPermissionOnStartup = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const status = await Geolocation.checkPermissions();
          if (status.location !== 'granted') {
            await Geolocation.requestPermissions();
          }
        } catch (err) {
          console.error('Error requesting location permission on startup:', err);
        }
      }
    };
    requestLocationPermissionOnStartup();
  }, []);

  // Handle Android hardware back button for native mobile app
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let activeListener;
    const setupBackButton = async () => {
      const { App: CapApp } = await import('@capacitor/app');
      activeListener = await CapApp.addListener('backButton', () => {
        // If we are at the dashboard home page, exit the app
        if (window.location.pathname === '/' || window.location.pathname === '') {
          CapApp.exitApp();
        } else {
          // Go back in the React Router / browser history stack
          window.history.back();
        }
      });
    };

    setupBackButton();

    return () => {
      if (activeListener) {
        activeListener.then(l => l.remove()).catch(() => {});
      }
    };
  }, []);

  // Keyboard shortcut listener for Global Search (⌘K / Ctrl+K)
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!token) {
    return <Auth />;
  }

  if (loadingMetadata) {
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        backgroundColor: '#0F172A',
        color: '#E2E8F0'
      }}>
        <Typography variant="h6" sx={{ fontWeight: 600, fontFamily: 'Poppins' }}>
          Configuring Gagan Realtech Terminal...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#F8FAFC', flexDirection: 'row' }}>
      <CssBaseline />
      
      {/* Sidebar Panel - passes mobile toggle states */}
      <Sidebar mobileOpen={mobileOpen} handleDrawerToggle={() => setMobileOpen(!mobileOpen)} />

      {/* Main Panel Content */}
      <Box sx={{ 
        flexGrow: 1, 
        display: 'flex', 
        flexDirection: 'column',
        minWidth: 0
      }}>
        <Header onSearchClick={() => setSearchOpen(true)} onMenuClick={() => setMobileOpen(true)} onReload={triggerAppReload} />
        
        <Box key={reloadKey} component="main" sx={{ flexGrow: 1, overflowY: 'hidden', pb: isMobile ? '80px' : '24px', display: 'flex', flexDirection: 'column' }}>
          <PullToRefresh>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/quick-add" element={<QuickAdd />} />
              <Route path="/module/attendance" element={<ModuleRouteGuard element={<Attendance />} moduleName="attendance" />} />
              <Route path="/module/salary" element={<ModuleRouteGuard element={<Salary />} moduleName="salaries" />} />
              <Route path="/module/location_tracker" element={<ModuleRouteGuard element={<LocationTracker />} moduleName="location_tracker" />} />
              <Route path="/module/:moduleName" element={<ModuleManagerWrapper />} />
              <Route path="/module/:moduleName/:id" element={<EntityDetailWrapper />} />
              <Route path="/pipeline/:pipelineType" element={<PipelineViewWrapper />} />
              <Route path="/settings" element={user?.role === 'Admin' ? <Settings /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PullToRefresh>
        </Box>
      </Box>

      {/* Mobile Bottom Navigation Bar */}
      {isMobile && (
        <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100, borderTop: '1px solid #E2E8F0' }} elevation={3}>
          <BottomNavigation
            value={location.pathname.startsWith('/module/customers') ? '/module/customers' : location.pathname.startsWith('/module/tasks') ? '/module/tasks' : location.pathname}
            onChange={(event, newValue) => {
              if (newValue !== 'menu_trigger') {
                navigate(newValue);
              }
            }}
            showLabels
            sx={{ 
              height: 65,
              '& .MuiBottomNavigationAction-root': {
                minWidth: 'auto',
                padding: '6px 0',
              },
              '& .MuiBottomNavigationAction-label': {
                fontSize: '10px',
                '&.Mui-selected': {
                  fontSize: '10px',
                }
              }
            }}
          >
            <BottomNavigationAction 
              label="Dashboard" 
              value="/" 
              icon={<Icons.LayoutDashboard size={20} />} 
            />
            {hasPermission('customers', 'view') && (
              <BottomNavigationAction 
                label="CRM" 
                value="/module/customers" 
                icon={<Icons.Users size={20} />} 
              />
            )}
            {hasPermission('tasks', 'view') && (
              <BottomNavigationAction 
                label="Tasks" 
                value="/module/tasks" 
                icon={<Icons.CheckSquare size={20} />} 
              />
            )}
            {hasPermission('attendance', 'view') && (
              <BottomNavigationAction 
                label="Attendance" 
                value="/module/attendance" 
                icon={<Icons.Clock size={20} />} 
              />
            )}
            {hasPermission('salaries', 'view') && (
              <BottomNavigationAction 
                label="Salary" 
                value="/module/salary" 
                icon={<Icons.CircleDollarSign size={20} />} 
              />
            )}
            <BottomNavigationAction 
              label="More" 
              value="menu_trigger"
              onClick={() => setMobileOpen(true)}
              icon={<Icons.Menu size={20} />} 
            />
          </BottomNavigation>
        </Paper>
      )}

      {/* Global 360 Search dialog overlay */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      
      {/* Floating AI Copilot assistant */}
      <AIAssistantDrawer />
    </Box>
  );
};

function App() {
  return (
    <ThemeProvider theme={theme}>
      <AppProvider>
        <LeadNotificationListener />
        <AppUpdater />
        <Router>
            <DomRoutes>
              <DomRoute path="/intake" element={<PublicIntake />} />
              <DomRoute path="/*" element={<MainLayout />} />
            </DomRoutes>
        </Router>
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;
