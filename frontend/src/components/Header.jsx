import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Box, 
  TextField, 
  InputAdornment, 
  IconButton, 
  Badge,
  Chip,
  Menu,
  MenuItem,
  Divider,
  useMediaQuery
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp } from '../context/AppContext';

const Header = ({ onSearchClick, onMenuClick, onReload }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, metadata, activityLogs } = useApp();
  const isMobile = useMediaQuery('(max-width:900px)');

  const [notiAnchor, setNotiAnchor] = React.useState(null);
  const notiOpen = Boolean(notiAnchor);

  const handleNotiClick = (e) => {
    setNotiAnchor(e.currentTarget);
  };
  const handleNotiClose = () => {
    setNotiAnchor(null);
  };

  // Helper to determine title from path
  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard Overview';
    if (path.startsWith('/module/')) {
      const mod = path.split('/')[2];
      return metadata?.modules[mod]?.label || 'Module Viewer';
    }
    if (path === '/pipeline/properties') return 'Property Inventory Pipeline';
    if (path === '/pipeline/property_pitches') return 'Property Interest Pipeline';
    if (path === '/pipeline/customers') return 'Customer Kanban Pipeline';
    if (path === '/pipeline/buyer_query') return 'Buyer Query Pipeline';
    if (path === '/pipeline/seller_query') return 'Seller Query Pipeline';
    if (path === '/settings') return 'Admin Control Center';
    return 'System Portal';
  };

  const handlePageReload = () => {
    onReload();
  };

  if (isMobile) {
    return (
      <AppBar position="sticky" sx={{ zIndex: 1100, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0', boxShadow: 'none' }}>
        <Toolbar sx={{ px: 2, display: 'flex', justifyContent: 'space-between', minHeight: 65 }}>
          {/* Left: Avatar + Greeting */}
          <Box display="flex" alignItems="center" gap={1.5} onClick={() => navigate('/settings')} sx={{ cursor: 'pointer' }}>
            <Box sx={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              backgroundColor: '#2563EB',
              color: '#FFFFFF',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              fontWeight: 700,
              fontFamily: 'Poppins'
            }}>
              {user?.name ? user.name[0].toUpperCase() : 'U'}
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', lineHeight: 1.1 }}>
                Welcome Back,
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A', fontFamily: 'Poppins', lineHeight: 1.1 }}>
                {user?.name?.split(' ')[0] || 'User'}
              </Typography>
            </Box>
          </Box>

          {/* Right: Search, Notification, Quick Add */}
          <Box display="flex" alignItems="center" gap={0.5}>
            <IconButton onClick={onSearchClick} sx={{ color: '#475569' }}>
              <Icons.Search size={20} />
            </IconButton>
            <IconButton onClick={handleNotiClick} sx={{ color: '#475569' }}>
              <Badge color="error" badgeContent={activityLogs?.slice(0, 5).length || 0}>
                <Icons.Bell size={20} />
              </Badge>
            </IconButton>
            <IconButton onClick={() => navigate('/quick-add')} sx={{ color: '#2563EB', backgroundColor: 'rgba(37, 99, 235, 0.1)', '&:hover': { backgroundColor: 'rgba(37, 99, 235, 0.2)' } }}>
              <Icons.Plus size={20} />
            </IconButton>
          </Box>
        </Toolbar>

        <Menu
          anchorEl={notiAnchor}
          open={notiOpen}
          onClose={handleNotiClose}
          PaperProps={{
            sx: {
              borderRadius: '12px',
              mt: 1.5,
              boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
              border: '1px solid #E2E8F0',
              width: 320,
              maxHeight: 400
            }
          }}
        >
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>
              Recent Activities
            </Typography>
            <Chip label="Live Feed" color="success" size="small" sx={{ height: 18, fontSize: '9px', fontWeight: 800 }} />
          </Box>
          <Divider />
          {(!activityLogs || activityLogs.length === 0) ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: '#94A3B8' }}>
                No recent activities recorded.
              </Typography>
            </Box>
          ) : (
            activityLogs.slice(0, 5).map((log, index) => (
              <Box key={index} sx={{ p: 1.5, borderBottom: '1px solid #F1F5F9', '&:last-child': { borderBottom: 'none' } }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', color: '#0F172A' }}>
                  {log.employeeName || log.user || 'System'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#475569', fontSize: '11px', mt: 0.5 }}>
                  {log.action}
                </Typography>
                <Typography variant="caption" sx={{ color: '#94A3B8', fontSize: '9px', display: 'block', mt: 0.5 }}>
                  {log.dateTime || 'Just now'}
                </Typography>
              </Box>
            ))
          )}
        </Menu>
      </AppBar>
    );
  }

  return (
    <AppBar position="sticky" sx={{ zIndex: 1100 }}>
      <Toolbar sx={{ px: 3, display: 'flex', justifyContent: 'space-between', minHeight: 70 }}>
        {/* Title / Breadcrumb / Hamburger */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={onMenuClick}
            sx={{ display: { md: 'none' }, color: '#475569', p: 0.5, mr: 0.5 }}
          >
            <Icons.Menu size={20} />
          </IconButton>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', sm: { fontSize: '20px' }, letterSpacing: '-0.02em', color: '#0F172A', fontFamily: 'Poppins' }}>
            {getPageTitle()}
          </Typography>
        </Box>

        {/* Global Search Bar Trigger */}
        <Box sx={{ width: '40%', maxWidth: 500 }} onClick={onSearchClick}>
          <TextField
            size="small"
            placeholder="Global 360° Search... (Customer ID, Phone, Location, Employee, Remarks...)"
            fullWidth
            InputProps={{
              readOnly: true,
              startAdornment: (
                <InputAdornment position="start">
                  <Icons.Search size={18} color="#64748B" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Chip 
                    label="⌘K" 
                    size="small" 
                    sx={{ 
                      borderRadius: '4px', 
                      height: 20, 
                      fontSize: '10px', 
                      fontWeight: 700, 
                      backgroundColor: '#F1F5F9',
                      border: '1px solid #E2E8F0',
                      color: '#64748B' 
                    }} 
                  />
                </InputAdornment>
              ),
              style: {
                borderRadius: '99px',
                cursor: 'pointer',
                backgroundColor: '#F8FAFC',
              }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: '#E2E8F0' },
                '&:hover fieldset': { borderColor: '#CBD5E1' }
              }
            }}
          />
        </Box>

        {/* Icons / Profile */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton 
            sx={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }} 
            onClick={handlePageReload}
            title="Refresh Page"
          >
            <Icons.RotateCw size={18} color="#64748B" />
          </IconButton>

          <IconButton sx={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }} onClick={() => navigate('/settings')}>
            <Icons.Settings size={18} color="#64748B" />
          </IconButton>
          
          <IconButton 
            sx={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
            onClick={handleNotiClick}
            title="Activity Notifications"
          >
            <Badge color="error" badgeContent={activityLogs?.slice(0, 5).length || 0}>
              <Icons.Bell size={18} color="#64748B" />
            </Badge>
          </IconButton>
          
          <Menu
            anchorEl={notiAnchor}
            open={notiOpen}
            onClose={handleNotiClose}
            PaperProps={{
              sx: {
                borderRadius: '12px',
                mt: 1.5,
                boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
                border: '1px solid #E2E8F0',
                width: 320,
                maxHeight: 400
              }
            }}
          >
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>
                Recent Activities
              </Typography>
              <Chip label="Live Feed" color="success" size="small" sx={{ height: 18, fontSize: '9px', fontWeight: 800 }} />
            </Box>
            <Divider />
            {(!activityLogs || activityLogs.length === 0) ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="caption" sx={{ color: '#94A3B8' }}>
                  No recent activities recorded.
                </Typography>
              </Box>
            ) : (
              activityLogs.slice(0, 5).map((log, index) => (
                <Box key={index} sx={{ p: 1.5, borderBottom: '1px solid #F1F5F9', '&:last-child': { borderBottom: 'none' } }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', color: '#0F172A' }}>
                    {log.user || 'System'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#475569', fontSize: '11px', mt: 0.5 }}>
                    {log.action}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#94A3B8', fontSize: '9px', display: 'block', mt: 0.5 }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Just now'}
                  </Typography>
                </Box>
              ))
            )}
          </Menu>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: 1, borderLeft: '1px solid #E2E8F0' }}>
            <Chip 
              label={user?.role || 'Staff'} 
              color="primary" 
              size="small"
              sx={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', borderRadius: '6px' }}
            />
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
