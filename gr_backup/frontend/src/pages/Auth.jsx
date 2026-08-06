import React, { useState } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  TextField, 
  Button, 
  Alert,
  InputAdornment,
  IconButton,
  Grid,
  Chip
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp } from '../context/AppContext';

const Auth = () => {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all credentials.');
      return;
    }
    
    setLoading(true);
    setError('');
    
    const result = await login(email, password);
    setLoading(false);
    
    if (!result.success) {
      setError(result.message);
    }
  };

  const fillCredentials = (demoEmail, demoPass) => {
    setEmail(demoEmail);
    setPassword(demoPass);
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at 10% 20%, rgb(15, 23, 42) 0%, rgb(30, 41, 59) 90.1%)',
      p: 2,
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Decorative Rings */}
      <Box sx={{
        position: 'absolute',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(37,99,235,0.12) 0%, rgba(0,0,0,0) 70%)',
        top: '-10%',
        left: '-10%',
        zIndex: 0
      }} />
      <Box sx={{
        position: 'absolute',
        width: '600px',
        height: '600px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, rgba(0,0,0,0) 70%)',
        bottom: '-10%',
        right: '-10%',
        zIndex: 0
      }} />

      {/* Main Glass login Container */}
      <Grid container spacing={0} sx={{ maxWidth: 1000, zIndex: 10, borderRadius: '24px', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        
        {/* Left Side: Branding and Art */}
        <Grid item xs={12} md={6} sx={{ 
          background: 'linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)', 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between',
          p: 6,
          color: '#FFFFFF'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Box component="img" src="/logo.jpg" alt="Gagan Realtech Logo" sx={{ 
              height: 70, 
              objectFit: 'contain',
              borderRadius: '8px'
            }} />
          </Box>

          <Box my={4}>
            <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '36px', mb: 2, lineHeight: 1.2, fontFamily: 'Poppins' }}>
              Premium Enterprise <span style={{ color: '#3B82F6' }}>ERP & CRM</span> portal.
            </Typography>
            <Typography variant="body1" sx={{ color: '#94A3B8', fontWeight: 400 }}>
              Complete metadata-driven relationship management, project inventories, lead nurturing pathways, site visit logs, attendance schedules, and real-time Google Sheets synchronization.
            </Typography>
          </Box>

        </Grid>

        {/* Right Side: Form Sheet */}
        <Grid item xs={12} md={6} sx={{ backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
          <Card sx={{ border: 'none', background: 'transparent', height: '100%', display: 'flex', alignItems: 'center', boxShadow: 'none', borderRadius: 0 }}>
            <CardContent sx={{ p: 6, width: '100%' }}>
              <Typography variant="h3" sx={{ fontWeight: 700, fontSize: '28px', color: '#FFFFFF', mb: 1, fontFamily: 'Poppins' }}>
                Welcome back
              </Typography>
              <Typography variant="body2" sx={{ color: '#94A3B8', mb: 4 }}>
                Enter your Gagan Realtech credentials to access your terminal
              </Typography>

              {error && (
                <Alert severity="error" icon={<Icons.AlertCircle size={20} />} sx={{ mb: 3, borderRadius: '8px' }}>
                  {error}
                </Alert>
              )}

              <form onSubmit={handleSubmit}>
                <Box mb={2.5}>
                  <Typography variant="body2" sx={{ color: '#E2E8F0', fontWeight: 600, mb: 1 }}>
                    Registered Email Address
                  </Typography>
                  <TextField
                    placeholder="name@gaganrealtech.com"
                    fullWidth
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Icons.Mail size={18} color="#64748B" />
                        </InputAdornment>
                      ),
                      style: { color: '#FFFFFF', backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px' }
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                        '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                        '&.Mui-focused fieldset': { borderColor: '#2563EB' }
                      }
                    }}
                  />
                </Box>

                <Box mb={4}>
                  <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography variant="body2" sx={{ color: '#E2E8F0', fontWeight: 600 }}>
                      Password Token
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#3B82F6', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                      Request reset?
                    </Typography>
                  </Box>
                  <TextField
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    fullWidth
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Icons.Lock size={18} color="#64748B" />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" sx={{ color: '#64748B' }}>
                            {showPassword ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
                          </IconButton>
                        </InputAdornment>
                      ),
                      style: { color: '#FFFFFF', backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px' }
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                        '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                        '&.Mui-focused fieldset': { borderColor: '#2563EB' }
                      }
                    }}
                  />
                </Box>

                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={loading}
                  sx={{ 
                    py: 1.5, 
                    borderRadius: '8px', 
                    fontWeight: 700, 
                    backgroundColor: '#2563EB',
                    '&:hover': { backgroundColor: '#1D4ED8', boxShadow: '0 4px 14px rgba(37,99,235,0.4)' }
                  }}
                >
                  {loading ? 'Securing Terminal Connection...' : 'Secure Authorization Sign In'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Auth;
