import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Grid, 
  TextField, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  Paper, 
  Typography,
  Chip,
  Button
} from '@mui/material';
import { useApp } from '../context/AppContext';
import { Home } from 'lucide-react';

const getStatusStyles = (status) => {
  const s = String(status || '').trim().toLowerCase();
  if (s.includes('available')) {
    return { bg: '#ECFDF5', text: '#047857' }; // Green
  }
  if (s.includes('token') || s.includes('booking')) {
    return { bg: '#FEF3C7', text: '#D97706' }; // Amber
  }
  if (s.includes('agreement') || s.includes('noc')) {
    return { bg: '#EEF2F6', text: '#4F46E5' }; // Indigo
  }
  if (s.includes('registered') || s.includes('sold') || s.includes('lost')) {
    return { bg: '#FEE2E2', text: '#B91C1C' }; // Red
  }
  return { bg: '#F1F5F9', text: '#475569' }; // Default Grey
};

const PropertyMatcher = ({ variant = 'tab', onPitchProperty }) => {
  const navigate = useNavigate();
  const { moduleData } = useApp();
  const properties = moduleData.properties || [];

  // Form states (immediate updates for input fields)
  const [locality, setLocality] = useState('');
  const [sectorBlock, setSectorBlock] = useState('');
  const [size, setSize] = useState('');
  const [budget, setBudget] = useState('');
  const [rci, setRci] = useState('');
  const [dealType, setDealType] = useState('');

  // Debounced search states
  const [debouncedLocality, setDebouncedLocality] = useState('');
  const [debouncedSectorBlock, setDebouncedSectorBlock] = useState('');
  const [debouncedSize, setDebouncedSize] = useState('');
  const [debouncedBudget, setDebouncedBudget] = useState('');

  // Debouncing effect for text inputs
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedLocality(locality);
      setDebouncedSectorBlock(sectorBlock);
      setDebouncedSize(size);
      setDebouncedBudget(budget);
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [locality, sectorBlock, size, budget]);

  // Check if at least one search field is populated
  const isSearchActive = useMemo(() => {
    return !!(
      debouncedLocality.trim() ||
      debouncedSectorBlock.trim() ||
      debouncedSize.trim() ||
      debouncedBudget.trim() ||
      rci ||
      dealType
    );
  }, [debouncedLocality, debouncedSectorBlock, debouncedSize, debouncedBudget, rci, dealType]);

  // Filter properties live based on search criteria
  const matchedProperties = useMemo(() => {
    if (!isSearchActive) return [];

    return properties.filter(p => {
      // Locality filter: partial, case-insensitive
      if (debouncedLocality.trim()) {
        const pLoc = String(p.locality || '').toLowerCase();
        if (!pLoc.includes(debouncedLocality.trim().toLowerCase())) return false;
      }

      // Sector/Block filter: partial, case-insensitive
      if (debouncedSectorBlock.trim()) {
        const pSec = String(p.sector_block || '').toLowerCase();
        if (!pSec.includes(debouncedSectorBlock.trim().toLowerCase())) return false;
      }

      // Size filter: partial, case-insensitive
      if (debouncedSize.trim()) {
        const pSize = String(p.size || '').toLowerCase();
        if (!pSize.includes(debouncedSize.trim().toLowerCase())) return false;
      }

      // Budget (matching against property demand field) filter: partial, case-insensitive
      if (debouncedBudget.trim()) {
        const pDemand = String(p.demand || '').toLowerCase();
        if (!pDemand.includes(debouncedBudget.trim().toLowerCase())) return false;
      }

      // R/C/I exact filter
      if (rci) {
        if (String(p.r_c_i || '') !== rci) return false;
      }

      // Dealer/Owner/Booked exact filter
      if (dealType) {
        if (String(p.dealer_owner_booked || '') !== dealType) return false;
      }

      return true;
    });
  }, [properties, debouncedLocality, debouncedSectorBlock, debouncedSize, debouncedBudget, rci, dealType, isSearchActive]);

  const handleClear = () => {
    setLocality('');
    setSectorBlock('');
    setSize('');
    setBudget('');
    setRci('');
    setDealType('');
  };

  const isSidebar = variant === 'sidebar';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: isSidebar ? 2 : 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'Poppins', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1, fontSize: isSidebar ? '15px' : '18px' }}>
        <Home size={isSidebar ? 18 : 20} color="#2563EB" />
        Manual Property Matcher
      </Typography>

      <Paper 
        variant="outlined" 
        sx={{ 
          p: isSidebar ? 2 : 3, 
          borderRadius: '16px', 
          borderColor: '#E2E8F0', 
          backgroundColor: isSidebar ? 'white' : '#F8FAFC',
          border: isSidebar ? 'none' : undefined
        }}
      >
        <Grid container spacing={isSidebar ? 1.5 : 2}>
          <Grid item xs={12} sm={isSidebar ? 6 : 4}>
            <TextField
              label="Locality"
              placeholder="e.g. Sector 82"
              fullWidth
              size="small"
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              sx={{ backgroundColor: 'white' }}
            />
          </Grid>
          <Grid item xs={12} sm={isSidebar ? 6 : 4}>
            <TextField
              label="Sector/Block"
              placeholder="e.g. Block A"
              fullWidth
              size="small"
              value={sectorBlock}
              onChange={(e) => setSectorBlock(e.target.value)}
              sx={{ backgroundColor: 'white' }}
            />
          </Grid>
          <Grid item xs={12} sm={isSidebar ? 6 : 4}>
            <TextField
              label="Size"
              placeholder="e.g. 100 Sq.Yd."
              fullWidth
              size="small"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              sx={{ backgroundColor: 'white' }}
            />
          </Grid>
          <Grid item xs={12} sm={isSidebar ? 6 : 4}>
            <TextField
              label="Budget (Demand)"
              placeholder="e.g. 1.90 Cr"
              fullWidth
              size="small"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              sx={{ backgroundColor: 'white' }}
            />
          </Grid>
          <Grid item xs={12} sm={isSidebar ? 6 : 4}>
            <FormControl fullWidth size="small" sx={{ backgroundColor: 'white' }}>
              <InputLabel>R/C/I</InputLabel>
              <Select
                value={rci}
                label="R/C/I"
                onChange={(e) => setRci(e.target.value)}
              >
                <MenuItem value="">-- Select --</MenuItem>
                <MenuItem value="Residential">Residential</MenuItem>
                <MenuItem value="Commercial">Commercial</MenuItem>
                <MenuItem value="Industrial">Industrial</MenuItem>
                <MenuItem value="Land">Land</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={isSidebar ? 6 : 4}>
            <FormControl fullWidth size="small" sx={{ backgroundColor: 'white' }}>
              <InputLabel>Dealer/Owner/Booked</InputLabel>
              <Select
                value={dealType}
                label="Dealer/Owner/Booked"
                onChange={(e) => setDealType(e.target.value)}
              >
                <MenuItem value="">-- Select --</MenuItem>
                <MenuItem value="Dealer">Dealer</MenuItem>
                <MenuItem value="Direct">Direct</MenuItem>
                <MenuItem value="Booked By Us">Booked By Us</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {isSearchActive && (
            <Grid item xs={12} display="flex" justifyContent="flex-end">
              <Button size="small" variant="text" onClick={handleClear} sx={{ textTransform: 'none', fontWeight: 700 }}>
                Clear Filters
              </Button>
            </Grid>
          )}
        </Grid>
      </Paper>

      {isSearchActive ? (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#475569', fontSize: isSidebar ? '12px' : '14px' }}>
            Matching Properties ({matchedProperties.length})
          </Typography>
          {matchedProperties.length > 0 ? (
            <Box display="flex" flexDirection="column" gap={1.5}>
              {matchedProperties.map(p => (
                <Paper
                  key={p.id}
                  variant="outlined"
                  sx={{
                    p: isSidebar ? 1.5 : 2.5,
                    borderRadius: '12px',
                    borderColor: '#E2E8F0',
                    transition: 'all 0.2s',
                    '&:hover': {
                      borderColor: '#2563EB',
                      backgroundColor: 'rgba(37, 99, 235, 0.02)'
                    }
                  }}
                >
                  <Grid container spacing={isSidebar ? 1 : 2} alignItems="center">
                    <Grid item xs={12} sm={isSidebar ? 12 : 2.5}>
                      <Box display="flex" alignItems="center" flexWrap="wrap" gap={0.8}>
                        <Typography
                          variant="subtitle2"
                          sx={{ fontWeight: 800, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline', fontSize: isSidebar ? '13px' : '14px' }}
                          onClick={() => navigate(`/module/properties/${p.id}`)}
                        >
                          {p.id}
                        </Typography>
                        {p.status && (() => {
                          const styles = getStatusStyles(p.status);
                          return (
                            <Chip
                              label={p.status}
                              size="small"
                              sx={{
                                fontWeight: 700,
                                fontSize: '8px',
                                height: 16,
                                backgroundColor: styles.bg,
                                color: styles.text,
                                border: 'none'
                              }}
                            />
                          );
                        })()}
                      </Box>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>
                        {p.propertyName || 'Unnamed Listing'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={isSidebar ? 6 : 2}>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Location</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#1E293B', fontSize: isSidebar ? '11px' : '12px' }}>
                        {p.locality || '---'} {p.sector_block ? `(Sec ${p.sector_block})` : ''}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={isSidebar ? 6 : 1.5}>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Size</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#1E293B', fontSize: isSidebar ? '11px' : '12px' }}>
                        {p.size || '---'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={isSidebar ? 6 : 2}>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Demand / Price</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#0F172A', fontSize: isSidebar ? '12px' : '14px' }}>
                        ₹{p.demand || '---'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={isSidebar ? 6 : 2} display="flex" flexDirection={isSidebar ? 'row' : 'column'} gap={0.5} justifyContent={isSidebar ? 'flex-start' : 'flex-end'} alignItems={isSidebar ? 'center' : 'flex-end'}>
                      {p.r_c_i && (
                        <Chip
                          label={p.r_c_i}
                          size="small"
                          sx={{
                            fontWeight: 700,
                            fontSize: '9px',
                            backgroundColor: p.r_c_i === 'Residential' ? '#DBEAFE' : p.r_c_i === 'Commercial' ? '#FEF3C7' : '#D1FAE5',
                            color: p.r_c_i === 'Residential' ? '#1E40AF' : p.r_c_i === 'Commercial' ? '#D97706' : '#065F46',
                            height: 18
                          }}
                        />
                      )}
                      {p.dealer_owner_booked && (
                        <Chip
                          label={p.dealer_owner_booked}
                          variant="outlined"
                          size="small"
                          sx={{ fontWeight: 600, fontSize: '8px', height: 16 }}
                        />
                      )}
                    </Grid>
                    {onPitchProperty && (
                      <Grid item xs={12} sm={isSidebar ? 12 : 2} display="flex" justifyContent={isSidebar ? 'flex-start' : 'flex-end'}>
                        <Button 
                          variant="contained" 
                          size="small" 
                          onClick={() => onPitchProperty(p.id)}
                          sx={{ 
                            textTransform: 'none', 
                            fontWeight: 700, 
                            fontSize: '11px',
                            backgroundColor: '#2563EB',
                            borderRadius: '8px',
                            px: 1.5,
                            py: 0.5,
                            width: isSidebar ? '100%' : 'auto',
                            mt: isSidebar ? 1 : 0
                          }}
                        >
                          Pitch Property
                        </Button>
                      </Grid>
                    )}
                  </Grid>
                </Paper>
              ))}
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: '16px', borderStyle: 'dashed', borderColor: '#CBD5E1' }}>
              <Typography variant="body2" sx={{ color: '#94A3B8', fontSize: '12px' }}>
                No matching properties found.
              </Typography>
            </Paper>
          )}
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: '16px', borderStyle: 'dashed', borderColor: '#CBD5E1' }}>
          <Typography variant="body2" sx={{ color: '#94A3B8', fontSize: '12px' }}>
            Please fill in at least one search field to see matching properties.
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default PropertyMatcher;
