import React, { useState } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  TextField, 
  Button, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  Alert, 
  CircularProgress,
  Grid
} from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../context/AppContext';

const PublicIntake = () => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [locality, setLocality] = useState('');
  const [sector, setSector] = useState('');
  const [propertyType, setPropertyType] = useState('Residential');
  const [optionType, setOptionType] = useState('Kothi');
  const [size, setSize] = useState('');
  const [plc, setPlc] = useState('');
  const [budget, setBudget] = useState('');
  const [queryType, setQueryType] = useState('Buy Property');
  const [landType, setLandType] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handlePropertyTypeChange = (val) => {
    setPropertyType(val);
    if (val === 'Residential') setOptionType('Kothi');
    else if (val === 'Commercial') setOptionType('SCO Plot');
    else if (val === 'Industrial') setOptionType('Plot');
    else if (val === 'Land Parcel') {
      setOptionType('');
      setLandType('Land Zone');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !phone) {
      setErrorMsg('Name and Phone Number are required fields.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await axios.post(`${API_BASE_URL}/public/lead-intake`, {
        name,
        phone,
        locality,
        sector,
        propertyType,
        optionType,
        size,
        plc,
        budget,
        queryType,
        landType
      });

      if (res.data.success) {
        setSuccess(true);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.response?.data?.error || 'Failed to submit the form. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
        p: 3 
      }}>
        <Card sx={{ maxWidth: 500, width: '100%', borderRadius: '24px', textAlign: 'center', p: 4 }}>
          <CardContent>
            <Box sx={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3 }}>
              <Icons.CheckCircle size={36} color="#22C55E" />
            </Box>
            <Typography variant="h4" sx={{ fontWeight: 800, mb: 1.5, fontFamily: 'Poppins' }}>
              Requirements Registered!
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
              Thank you, <strong>{name}</strong>. Your property requirements have been successfully registered in our lead system. Our match engines are already processing property suggestions.
            </Typography>
            <Button 
              variant="contained" 
              fullWidth
              onClick={() => {
                setName('');
                setPhone('');
                setLocality('');
                setSector('');
                setPropertyType('Residential');
                setOptionType('Kothi');
                setSize('');
                setPlc('');
                setBudget('');
                setQueryType('Buy Property');
                setSuccess(false);
              }}
              sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, borderRadius: '12px', py: 1.5, textTransform: 'none', fontWeight: 700 }}
            >
              Submit Another Request
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
      py: 6,
      px: 2
    }}>
      <Card sx={{ maxWidth: 600, width: '100%', borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#FFFFFF' }}>
        <CardContent sx={{ p: 4 }}>
          <Box display="flex" alignItems="center" gap={1.5} mb={2}>
            <Icons.Building2 size={32} style={{ color: '#2563EB' }} />
            <Typography variant="h3" sx={{ fontWeight: 900, fontSize: '24px', fontFamily: 'Poppins', letterSpacing: '-0.5px' }}>
              Gagan Realtech Requirement Form
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748B', mb: 4 }}>
            Fill in your preferred locality, budget, and property specifications to immediately register inside our search network.
          </Typography>

          {errorMsg && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: '12px' }}>
              {errorMsg}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Contact Name"
                  placeholder="Enter full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Phone Number"
                  placeholder="Enter 10-digit number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Query Type (Requirement)</InputLabel>
                  <Select
                    value={queryType}
                    label="Query Type (Requirement)"
                    onChange={(e) => setQueryType(e.target.value)}
                  >
                    <MenuItem value="Buy Property">Buy Property (Looking to Purchase)</MenuItem>
                    <MenuItem value="Sell Property">Sell Property (Looking to List/Sell)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Preferred Locality"
                  placeholder="e.g. Aerocity, Mohali"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Sector / Block"
                  placeholder="e.g. Sector 82"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  fullWidth
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Type of Property</InputLabel>
                  <Select
                    value={propertyType}
                    label="Type of Property"
                    onChange={(e) => handlePropertyTypeChange(e.target.value)}
                  >
                    <MenuItem value="Residential">Residential</MenuItem>
                    <MenuItem value="Commercial">Commercial</MenuItem>
                    <MenuItem value="Industrial">Industrial</MenuItem>
                    <MenuItem value="Land Parcel">Land Parcel</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {propertyType !== 'Land Parcel' && (
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Property Sub-Option</InputLabel>
                    <Select
                      value={optionType}
                      label="Property Sub-Option"
                      onChange={(e) => setOptionType(e.target.value)}
                    >
                      {propertyType === 'Residential' && [
                        <MenuItem key="kothi" value="Kothi">Kothi</MenuItem>,
                        <MenuItem key="plot" value="Plot">Plot</MenuItem>,
                        <MenuItem key="apartments" value="Apartments">Apartments</MenuItem>,
                        <MenuItem key="built_up_plot" value="25% Built Up Plot">25% Built Up Plot</MenuItem>
                      ]}
                      {propertyType === 'Commercial' && [
                        <MenuItem key="sco_plot" value="SCO Plot">SCO Plot</MenuItem>,
                        <MenuItem key="sco_builtup" value="SCO Builtup">SCO Builtup</MenuItem>,
                        <MenuItem key="sco_loi" value="SCO LOI">SCO LOI</MenuItem>,
                        <MenuItem key="bayshop_plot" value="Bay Shop Plot">Bay Shop Plot</MenuItem>,
                        <MenuItem key="bayshop_builtup" value="Bay Shop Builtup">Bay Shop Builtup</MenuItem>,
                        <MenuItem key="bayshop_loi" value="Bay Shop LOI">Bay Shop LOI</MenuItem>,
                        <MenuItem key="booth_plot" value="Booth Plot">Booth Plot</MenuItem>,
                        <MenuItem key="booth_builtup" value="Booth Builtup">Booth Builtup</MenuItem>,
                        <MenuItem key="booth_loi" value="Booth LOI">Booth LOI</MenuItem>,
                        <MenuItem key="officespace" value="Office Space">Office Space</MenuItem>,
                        <MenuItem key="hotelsite" value="Hotel Site">Hotel Site</MenuItem>,
                        <MenuItem key="hotelbuiltup" value="Hotel Builtup">Hotel Builtup</MenuItem>,
                        <MenuItem key="restaurant" value="Restaurant">Restaurant</MenuItem>
                      ]}
                      {propertyType === 'Industrial' && [
                        <MenuItem key="plot" value="Plot">Plot</MenuItem>,
                        <MenuItem key="builtup" value="Builtup">Builtup</MenuItem>,
                        <MenuItem key="loi" value="LOI">LOI</MenuItem>,
                        <MenuItem key="floors" value="Floors">Floors</MenuItem>
                      ]}
                    </Select>
                  </FormControl>
                </Grid>
              )}

              {propertyType === 'Land Parcel' && (
                <>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Zone</InputLabel>
                      <Select
                        value={landType}
                        label="Zone"
                        onChange={(e) => setLandType(e.target.value)}
                      >
                        {['Land Zone', 'R Zone', 'Agriculture Land', 'Baghleani', 'Commercial', 'Industrial'].map(z => (
                          <MenuItem key={z} value={z}>{z}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Property Sub-Option</InputLabel>
                      <Select
                        value={optionType}
                        label="Property Sub-Option"
                        onChange={(e) => setOptionType(e.target.value)}
                      >
                        {['Private Land Under MC', 'Private Land Not Under MC', 'Lal Dora Land'].map(opt => (
                          <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </>
              )}

              <Grid item xs={12} sm={6}>
                <TextField
                  label="Required Size"
                  placeholder="e.g. 250 Sq. Yds / 1500 Sq. Ft"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  fullWidth
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  label="Preferred PLC"
                  placeholder="e.g. Corner, Park Facing"
                  value={plc}
                  onChange={(e) => setPlc(e.target.value)}
                  fullWidth
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  label="Preferred Budget"
                  placeholder="Enter budget (e.g. 1.2 Crore, or 9000000)"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  fullWidth
                />
              </Grid>
            </Grid>

            <Button 
              type="submit" 
              variant="contained" 
              fullWidth
              disabled={loading}
              sx={{ mt: 4, backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, borderRadius: '12px', py: 1.5, textTransform: 'none', fontWeight: 800, fontSize: '15px' }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Register Requirements 🚀'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};

export default PublicIntake;
