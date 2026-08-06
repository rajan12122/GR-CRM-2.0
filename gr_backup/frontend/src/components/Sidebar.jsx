import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Box, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography, 
  Divider,
  Button
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp } from '../context/AppContext';

export const DynamicIcon = ({ name, size = 20, color = 'currentColor', ...props }) => {
  const IconComponent = Icons[name];
  if (!IconComponent) return <Icons.HelpCircle size={size} color={color} {...props} />;
  return <IconComponent size={size} color={color} {...props} />;
};

const DRAWER_WIDTH = 260;

const Sidebar = ({ mobileOpen, handleDrawerToggle }) => {
  const { metadata, logout, user, hasPermission } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  if (!metadata) return null;

  const modules = Object.keys(metadata.modules)
    .filter(key => hasPermission(key, 'view'))
    .map(key => ({
      id: key,
      label: metadata.modules[key].label,
      icon: metadata.modules[key].icon || 'Layers',
      path: `/module/${key}`
    }));

  const activePath = location.pathname;

  const isModuleActive = (modulePath) => {
    return activePath === modulePath || activePath.startsWith(modulePath + '/');
  };

  const handleNavClick = (path) => {
    navigate(path);
    if (mobileOpen) {
      handleDrawerToggle(); // close drawer on mobile click
    }
  };

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
      <Box sx={{ overflowY: 'auto', flex: 1, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: '#334155', borderRadius: '4px' } }}>
        {/* Brand Header */}
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Box component="img" src="/logo.jpg" alt="Gagan Realtech Logo" sx={{ 
            maxWidth: '100%', 
            height: 55,
            objectFit: 'contain',
            borderRadius: '6px'
          }} />
        </Box>

        <Divider sx={{ borderColor: '#1E293B', mb: 2 }} />

        {/* Dashboard Link */}
        <List sx={{ px: 1.5, py: 0 }}>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => handleNavClick('/')}
              selected={activePath === '/'}
              sx={{
                borderRadius: '8px',
                py: 1.2,
                px: 2,
                backgroundColor: activePath === '/' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                color: activePath === '/' ? '#3B82F6' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF'
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                <Icons.LayoutDashboard size={20} />
              </ListItemIcon>
              <ListItemText 
                primary="Dashboard" 
                primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
              />
            </ListItemButton>
          </ListItem>
        </List>

        <Typography variant="caption" sx={{ px: 3.5, py: 1.5, display: 'block', textTransform: 'uppercase', fontSize: '11px', fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
          Modules
        </Typography>

        {/* Dynamic Schema Modules Links */}
        <List sx={{ px: 1.5, py: 0 }}>
          {modules.map((mod) => (
            <ListItem key={mod.id} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => handleNavClick(mod.path)}
                selected={isModuleActive(mod.path)}
                sx={{
                  borderRadius: '8px',
                  py: 1.2,
                  px: 2,
                  backgroundColor: isModuleActive(mod.path) ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                  color: isModuleActive(mod.path) ? '#3B82F6' : '#94A3B8',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: '#FFFFFF'
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                  <DynamicIcon name={mod.icon} size={20} />
                </ListItemIcon>
                <ListItemText 
                  primary={mod.label} 
                  primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        {/* Pipelines Section */}
        <Typography variant="caption" sx={{ px: 3.5, py: 1.5, display: 'block', textTransform: 'uppercase', fontSize: '11px', fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
          Pipelines
        </Typography>
        <List sx={{ px: 1.5, py: 0 }}>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => handleNavClick('/pipeline/properties')}
              selected={activePath === '/pipeline/properties'}
              sx={{
                borderRadius: '8px',
                py: 1.2,
                px: 2,
                backgroundColor: activePath === '/pipeline/properties' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                color: activePath === '/pipeline/properties' ? '#3B82F6' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF'
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                <Icons.Layers size={20} />
              </ListItemIcon>
              <ListItemText 
                primary="Property Pipeline" 
                primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => handleNavClick('/pipeline/property_pitches')}
              selected={activePath === '/pipeline/property_pitches'}
              sx={{
                borderRadius: '8px',
                py: 1.2,
                px: 2,
                backgroundColor: activePath === '/pipeline/property_pitches' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                color: activePath === '/pipeline/property_pitches' ? '#3B82F6' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF'
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                <Icons.CheckSquare size={20} />
              </ListItemIcon>
              <ListItemText 
                primary="Property Interest Pipeline" 
                primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => handleNavClick('/pipeline/customers')}
              selected={activePath === '/pipeline/customers'}
              sx={{
                borderRadius: '8px',
                py: 1.2,
                px: 2,
                backgroundColor: activePath === '/pipeline/customers' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                color: activePath === '/pipeline/customers' ? '#3B82F6' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF'
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                <Icons.GitCommit size={20} />
              </ListItemIcon>
              <ListItemText 
                primary="Customer Pipeline" 
                primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => handleNavClick('/pipeline/buyer_query')}
              selected={activePath === '/pipeline/buyer_query'}
              sx={{
                borderRadius: '8px',
                py: 1.2,
                px: 2,
                backgroundColor: activePath === '/pipeline/buyer_query' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                color: activePath === '/pipeline/buyer_query' ? '#3B82F6' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF'
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                <Icons.TrendingUp size={20} />
              </ListItemIcon>
              <ListItemText 
                primary="Buyer Query Pipeline" 
                primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
              />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              onClick={() => handleNavClick('/pipeline/seller_query')}
              selected={activePath === '/pipeline/seller_query'}
              sx={{
                borderRadius: '8px',
                py: 1.2,
                px: 2,
                backgroundColor: activePath === '/pipeline/seller_query' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                color: activePath === '/pipeline/seller_query' ? '#3B82F6' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF'
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                <Icons.TrendingDown size={20} />
              </ListItemIcon>
              <ListItemText 
                primary="Seller Query Pipeline" 
                primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
              />
            </ListItemButton>
          </ListItem>
        </List>

        <Typography variant="caption" sx={{ px: 3.5, py: 1.5, display: 'block', textTransform: 'uppercase', fontSize: '11px', fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
          Management
        </Typography>

        {/* System Settings */}
        {user?.role === 'Admin' && (
          <List sx={{ px: 1.5, py: 0 }}>
            <ListItem disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => handleNavClick('/settings')}
                selected={activePath === '/settings'}
                sx={{
                  borderRadius: '8px',
                  py: 1.2,
                  px: 2,
                  backgroundColor: activePath === '/settings' ? 'rgba(37, 99, 235, 0.15) !important' : 'transparent',
                  color: activePath === '/settings' ? '#3B82F6' : '#94A3B8',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: '#FFFFFF'
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                  <Icons.Settings size={20} />
                </ListItemIcon>
                <ListItemText 
                  primary="Admin Control Panel" 
                  primaryTypographyProps={{ fontSize: '14px', fontWeight: 600 }} 
                />
              </ListItemButton>
            </ListItem>
          </List>
        )}
      </Box>

      {/* User Session Footer */}
      <Box sx={{ p: 2, backgroundColor: '#020617', borderTop: '1px solid #1E293B' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Box sx={{ 
            width: 36, 
            height: 36, 
            borderRadius: '50%', 
            backgroundColor: '#3B82F6', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '14px'
          }}>
            {user?.name?.split(' ').map(n=>n[0]).join('') || 'U'}
          </Box>
          <Box sx={{ overflow: 'hidden' }}>
            <Typography variant="body2" noWrap sx={{ color: '#FFFFFF', fontWeight: 600 }}>
              {user?.name || 'User Profile'}
            </Typography>
            <Typography variant="caption" noWrap sx={{ color: '#64748B', display: 'block' }}>
              Role: {user?.role || 'Guest'}
            </Typography>
          </Box>
        </Box>
        <Button 
          variant="contained" 
          color="error" 
          fullWidth 
          size="small"
          onClick={logout}
          startIcon={<Icons.LogOut size={16} />}
          sx={{ borderRadius: '6px', py: 1 }}
        >
          Sign Out
        </Button>
      </Box>
    </Box>
  );

  return (
    <>
      {/* 1. Mobile Drawer (Temporary overlay) */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          [`& .MuiDrawer-paper`]: { 
            width: DRAWER_WIDTH, 
            boxSizing: 'border-box',
            backgroundColor: '#0F172A',
            color: '#E2E8F0',
            borderRight: 'none',
            height: '100%'
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* 2. Desktop Drawer (Permanent sidebar) */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { 
            width: DRAWER_WIDTH, 
            boxSizing: 'border-box',
            backgroundColor: '#0F172A',
            color: '#E2E8F0',
            borderRight: 'none',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: '100%'
          },
        }}
        open
      >
        {drawerContent}
      </Drawer>
    </>
  );
};

export default Sidebar;
