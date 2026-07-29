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

const PropertyMatcher = () => {
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'Poppins', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Home size={20} color="#2563EB" />
        Manual Property Matcher
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: '16px', borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
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
          <Grid item xs={12} sm={4}>
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
          <Grid item xs={12} sm={4}>
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
          <Grid item xs={12} sm={4}>
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
          <Grid item xs={12} sm={4}>
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
          <Grid item xs={12} sm={4}>
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
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#475569' }}>
            Matching Properties ({matchedProperties.length})
          </Typography>
          {matchedProperties.length > 0 ? (
            <Box display="flex" flexDirection="column" gap={2}>
              {matchedProperties.map(p => (
                <Paper
                  key={p.id}
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    borderRadius: '12px',
                    borderColor: '#E2E8F0',
                    transition: 'all 0.2s',
                    '&:hover': {
                      borderColor: '#2563EB',
                      backgroundColor: 'rgba(37, 99, 235, 0.02)'
                    }
                  }}
                >
                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={3}>
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 800, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/module/properties/${p.id}`)}
                      >
                        {p.id}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>
                        {p.propertyName || 'Unnamed Listing'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={2.5}>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Location</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#1E293B' }}>
                        {p.locality || '---'} {p.sector_block ? `(Sec ${p.sector_block})` : ''}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={2}>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Size</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#1E293B' }}>
                        {p.size || '---'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={2.5}>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Demand / Price</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#0F172A' }}>
                        ₹{p.demand || '---'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={2} display="flex" flexDirection="column" gap={0.5} alignItems="flex-end">
                      {p.r_c_i && (
                        <Chip
                          label={p.r_c_i}
                          size="small"
                          sx={{
                            fontWeight: 700,
                            fontSize: '10px',
                            backgroundColor: p.r_c_i === 'Residential' ? '#DBEAFE' : p.r_c_i === 'Commercial' ? '#FEF3C7' : '#D1FAE5',
                            color: p.r_c_i === 'Residential' ? '#1E40AF' : p.r_c_i === 'Commercial' ? '#D97706' : '#065F46'
                          }}
                        />
                      )}
                      {p.dealer_owner_booked && (
                        <Chip
                          label={p.dealer_owner_booked}
                          variant="outlined"
                          size="small"
                          sx={{ fontWeight: 600, fontSize: '9px', height: 18 }}
                        />
                      )}
                    </Grid>
                  </Grid>
                </Paper>
              ))}
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: '16px', borderStyle: 'dashed', borderColor: '#CBD5E1' }}>
              <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                No matching properties found.
              </Typography>
            </Paper>
          )}
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: '16px', borderStyle: 'dashed', borderColor: '#CBD5E1' }}>
          <Typography variant="body2" sx={{ color: '#94A3B8' }}>
            Please fill in at least one search field to see matching properties.
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default PropertyMatcher;
