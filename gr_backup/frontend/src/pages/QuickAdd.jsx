import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Container, 
  Card, 
  CardContent, 
  Typography, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  TextField, 
  Button, 
  Alert, 
  CircularProgress,
  Grid,
  FormControlLabel,
  Switch,
  Chip
} from '@mui/material';
import axios from 'axios';
import { API_BASE_URL } from '../context/AppContext';
import * as Icons from 'lucide-react';

const QuickAdd = () => {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState('');
  const [formData, setFormData] = useState({});
  const [customValues, setCustomValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [lookups, setLookups] = useState({});

  const [nestedPropertyData, setNestedPropertyData] = useState({
    contact_person_name: '',
    contact_number: '',
    dealer_owner_booked: 'Direct',
    dealerId: '',
    dealer_deal_type: '',
    booked_by_customer_id: '',
    locality: '',
    sector_block: '',
    size: '',
    demand: '',
    propertyType: 'Plot',
    r_c_i: 'Residential',
    status: 'Available',
    date: '',
    dealer_firm_name: '',
    address_number: '',
    bhk_and_washrooms: '',
    dimensions: '',
    location_type: 'Normal',
    facing: 'East',
    white: '',
    time: '',
    lead_source: 'Self Source',
    initial_notes: ''
  });

  const [nestedProjectData, setNestedProjectData] = useState({
    name: '',
    builder: 'DLF Group',
    locality: '',
    sector_block: '',
    status: 'Ready to Move',
    pricing_details: '',
    plc_percent: '',
    initial_notes: ''
  });

  const [nestedDealerData, setNestedDealerData] = useState({
    firm_name: '',
    person_name: '',
    contact_num: '',
    contacted_num: '',
    sector_block: '',
    address: '',
    remarks: '',
    callOutcome: 'Call Done'
  });

  const [dealerSearch, setDealerSearch] = useState('');
  const [propSearch, setPropSearch] = useState('');

  const loadData = async (showLoadingIndicator = false) => {
    if (showLoadingIndicator) setLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/public/metadata`);
      setMetadata(res.data);
      
      // Find all referenced modules dynamically
      const refModules = new Set();
      Object.values(res.data.modules).forEach(mod => {
        mod.fields.forEach(f => {
          if (f.type === 'ref' && f.refModule) {
            refModules.add(f.refModule);
          }
        });
      });

      // Fetch lookups for those referenced modules
      const promises = Array.from(refModules).map(mModule => {
        return axios.get(`${API_BASE_URL}/public/lookup/${mModule}`)
          .then(lRes => ({ module: mModule, data: lRes.data }))
          .catch(() => ({ module: mModule, data: [] }));
      });

      const results = await Promise.all(promises);
      const lookupMap = {};
      results.forEach(r => {
        lookupMap[r.module] = r.data;
      });

      setLookups(lookupMap);
    } catch (err) {
      console.error('Error fetching metadata for quick-add:', err);
      setSubmitError('Failed to load system metadata configurations.');
    } finally {
      if (showLoadingIndicator) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);

    // Auto-update lookups and metadata schema in the background every 10 seconds
    const interval = setInterval(() => {
      loadData(false);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0F172A' }}>
        <CircularProgress color="primary" />
      </Box>
    );
  }

  const allowedModuleIds = ['customers', 'leads', 'properties', 'projects', 'daily_prices', 'dealers', 'queries', 'follow_ups', 'property_pitch_history'];
  const modulesList = metadata 
    ? Object.values(metadata.modules).filter(m => allowedModuleIds.includes(m.id)) 
    : [];

  const fields = selectedModule && metadata?.modules[selectedModule]
    ? metadata.modules[selectedModule].fields.filter(f => f.name !== 'id' && f.editable !== false)
    : [];

  const handleInputChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleCustomInputChange = (fieldName, value) => {
    setCustomValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitSuccess(false);
    setSubmitting(true);

    try {
      // Map custom "Other" fields into the submitted payload
      const payload = { ...formData };

      // Auto-create property or project if logged inside property_pitch_history
      if (selectedModule === 'property_pitch_history') {
        if (formData.propertyId === 'Other_Property') {
          let finalDealerId = nestedPropertyData.dealerId;
          
          if (nestedPropertyData.dealer_owner_booked === 'Dealer' && nestedPropertyData.dealerId === 'Other_Dealer') {
            const dealerRes = await axios.post(`${API_BASE_URL}/public/quick-add`, {
              module: 'dealers',
              payload: nestedDealerData,
              key: 'gagan_employee_intake_2026'
            });
            if (dealerRes.data.success) {
              finalDealerId = dealerRes.data.record.id;
            } else {
              throw new Error(dealerRes.data.error || 'Failed to auto-create property dealer');
            }
          }

          const propRes = await axios.post(`${API_BASE_URL}/public/quick-add`, {
            module: 'properties',
            payload: {
              ...nestedPropertyData,
              dealerId: finalDealerId,
              date: nestedPropertyData.date || new Date().toLocaleDateString('en-IN')
            },
            key: 'gagan_employee_intake_2026'
          });
          if (propRes.data.success) {
            payload.propertyId = propRes.data.record.id;
          } else {
            throw new Error(propRes.data.error || 'Failed to auto-create property details');
          }
        }

        if (formData.projectId === 'Other_Project') {
          const projRes = await axios.post(`${API_BASE_URL}/public/quick-add`, {
            module: 'projects',
            payload: nestedProjectData,
            key: 'gagan_employee_intake_2026'
          });
          if (projRes.data.success) {
            payload.projectId = projRes.data.record.id;
          } else {
            throw new Error(projRes.data.error || 'Failed to auto-create project details');
          }
        }
      }

      fields.forEach(f => {
        if ((f.type === 'select' || f.type === 'ref') && formData[f.name] === 'Other') {
          payload[f.name] = customValues[f.name] || '';
        }
      });

      const response = await axios.post(`${API_BASE_URL}/public/quick-add`, {
        module: selectedModule,
        payload: payload,
        key: 'gagan_employee_intake_2026'
      });

      if (response.data.success) {
        setSubmitSuccess(true);
        setFormData({});
        setCustomValues({});
        setNestedPropertyData({
          contact_person_name: '',
          contact_number: '',
          dealer_owner_booked: 'Direct',
          dealerId: '',
          dealer_deal_type: '',
          booked_by_customer_id: '',
          locality: '',
          sector_block: '',
          size: '',
          demand: '',
          propertyType: 'Plot',
          r_c_i: 'Residential',
          status: 'Available',
          date: '',
          dealer_firm_name: '',
          address_number: '',
          bhk_and_washrooms: '',
          dimensions: '',
          location_type: 'Normal',
          facing: 'East',
          white: '',
          time: '',
          lead_source: 'Self Source',
          initial_notes: ''
        });
        setNestedProjectData({
          name: '',
          builder: 'DLF Group',
          locality: '',
          sector_block: '',
          status: 'Ready to Move',
          pricing_details: '',
          plc_percent: '',
          initial_notes: ''
        });
        setNestedDealerData({
          firm_name: '',
          person_name: '',
          contact_num: '',
          contacted_num: '',
          sector_block: '',
          address: '',
          remarks: '',
          callOutcome: 'Call Done'
        });
        setDealerSearch('');
        setPropSearch('');
        loadData(false);
      } else {
        setSubmitError(response.data.error || 'Failed to submit data.');
      }
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || err.response?.data?.error || 'A network error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', py: 4, backgroundColor: '#0F172A', display: 'flex', alignItems: 'center' }}>
      <Container maxWidth="sm">
        <Card sx={{ borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', backgroundColor: '#1E293B', color: '#F8FAFC' }}>
          <CardContent sx={{ p: 4 }}>
            {/* Header */}
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              <Box sx={{ display: 'inline-flex', p: 1.5, borderRadius: '16px', backgroundColor: 'rgba(37,99,235,0.1)', mb: 2 }}>
                <Icons.Layers size={32} style={{ color: '#3B82F6' }} />
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, fontFamily: 'Poppins', color: '#FFFFFF', mb: 1 }}>
                Quick-Add Intake Portal
              </Typography>
              <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                Select a tab sheet to quickly inject a new record directly into Gagan Realtech CRM.
              </Typography>
            </Box>

            {submitError && (
              <Alert severity="error" sx={{ mb: 3, borderRadius: '12px' }} onClose={() => setSubmitError('')}>
                {submitError}
              </Alert>
            )}

            {submitSuccess && (
              <Alert severity="success" sx={{ mb: 3, borderRadius: '12px' }} onClose={() => setSubmitSuccess(false)}>
                Record created successfully!
              </Alert>
            )}

            {/* Dropdown module selector */}
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel id="module-select-label" sx={{ color: '#94A3B8' }}>Select Module Sheet</InputLabel>
              <Select
                labelId="module-select-label"
                value={selectedModule}
                label="Select Module Sheet"
                onChange={(e) => {
                  setSelectedModule(e.target.value);
                  setFormData({});
                  setSubmitError('');
                  setSubmitSuccess(false);
                }}
                sx={{ 
                  color: '#FFFFFF',
                  backgroundColor: '#0F172A',
                  '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3B82F6' }
                }}
              >
                {modulesList.map(mod => (
                  <MenuItem key={mod.id} value={mod.id}>{mod.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Dynamic Form fields */}
            {selectedModule && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 2.5 }}>
                  <Button 
                    startIcon={<Icons.ArrowLeft size={16} />}
                    onClick={() => {
                      setSelectedModule('');
                      setFormData({});
                      setCustomValues({});
                      setSubmitError('');
                      setSubmitSuccess(false);
                    }}
                    sx={{ color: '#3B82F6', textTransform: 'none', fontWeight: 700 }}
                    size="small"
                  >
                    Change Sheet / Go Back
                  </Button>
                </Box>
                <form onSubmit={handleSubmit}>
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                  {fields.map(f => {
                    const value = formData[f.name] || '';
                    const isSelect = f.type === 'select' && f.chipGroup && metadata?.chips[f.chipGroup];
                    const isRef = f.type === 'ref' && f.refModule && lookups[f.refModule];
                    const isMultiRef = f.type === 'multiref' && f.refModule && lookups[f.refModule];
                    const isBoolean = f.type === 'boolean';
                    const isDate = f.type === 'date';

                    return (
                      <Grid item xs={12} key={f.name}>
                        {isSelect ? (
                          <FormControl fullWidth>
                            <InputLabel id={`label-${f.name}`} sx={{ color: '#94A3B8' }}>{f.label} {f.required && '*'}</InputLabel>
                            <Select
                              labelId={`label-${f.name}`}
                              value={value}
                              label={`${f.label} ${f.required ? '*' : ''}`}
                              required={f.required}
                              onChange={(e) => handleInputChange(f.name, e.target.value)}
                              sx={{ 
                                color: '#FFFFFF',
                                backgroundColor: '#0F172A',
                                '& .MuiOutlinedInput-root': {
                                  backgroundColor: '#0F172A',
                                  color: '#FFFFFF'
                                },
                                '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3B82F6' }
                              }}
                            >
                               {((f.name === 'pipelineAction' && selectedModule === 'follow_ups')
                                 ? (metadata?.chips?.customerStages || [])
                                 : metadata.chips[f.chipGroup]
                               ).map(choice => {
                                 const choiceVal = typeof choice === 'object' ? choice.value : choice;
                                 const choiceLabel = typeof choice === 'object' ? choice.label : choice;
                                 return (
                                   <MenuItem key={choiceVal} value={choiceVal}>{choiceLabel}</MenuItem>
                                 );
                               })}
                              <MenuItem value="Other" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#3B82F6' }}>
                                Other (Specify...)
                              </MenuItem>
                            </Select>
                          </FormControl>
                        ) : isRef ? (
                          <FormControl fullWidth>
                            <InputLabel id={`label-${f.name}`} sx={{ color: '#94A3B8' }}>{f.label} {f.required && '*'}</InputLabel>
                            <Select
                              labelId={`label-${f.name}`}
                              value={value}
                              label={`${f.label} ${f.required ? '*' : ''}`}
                              required={f.required}
                              onChange={(e) => handleInputChange(f.name, e.target.value)}
                              sx={{ 
                                color: '#FFFFFF',
                                backgroundColor: '#0F172A',
                                '& .MuiOutlinedInput-root': {
                                  backgroundColor: '#0F172A',
                                  color: '#FFFFFF'
                                },
                                '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3B82F6' }
                              }}
                            >
                              {selectedModule === 'property_pitch_history' && (f.name === 'propertyId' || f.name === 'projectId') && (
                                <MenuItem
                                  disableRipple
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  sx={{ 
                                    backgroundColor: 'transparent !important', 
                                    cursor: 'default',
                                    p: '4px 16px',
                                    '&:hover': { backgroundColor: 'transparent' }
                                  }}
                                >
                                  <TextField
                                    size="small"
                                    placeholder={f.name === 'propertyId' ? "Search properties..." : "Search projects..."}
                                    fullWidth
                                    value={propSearch}
                                    onChange={(e) => setPropSearch(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    sx={{ 
                                      input: { color: '#FFFFFF' }, 
                                      '.MuiInputLabel-root': { color: '#94A3B8' },
                                      '& .MuiOutlinedInput-root': {
                                        backgroundColor: '#0F172A',
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' }
                                      }
                                    }}
                                  />
                                </MenuItem>
                              )}
                              <MenuItem value="">-- Select --</MenuItem>
                              {lookups[f.refModule].filter(opt => {
                                if (selectedModule === 'property_pitch_history' && (f.name === 'propertyId' || f.name === 'projectId')) {
                                  if (!propSearch) return true;
                                  return String(opt.name || '').toLowerCase().includes(propSearch.toLowerCase()) || 
                                         String(opt.id || '').toLowerCase().includes(propSearch.toLowerCase());
                                }
                                return true;
                              }).map(opt => (
                                <MenuItem key={opt.id} value={opt.id}>{opt.name} ({opt.id})</MenuItem>
                              ))}
                              
                              {selectedModule === 'property_pitch_history' && f.name === 'propertyId' ? (
                                <MenuItem value="Other_Property" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#3B82F6' }}>
                                  + Create New Property Detail...
                                </MenuItem>
                              ) : selectedModule === 'property_pitch_history' && f.name === 'projectId' ? (
                                <MenuItem value="Other_Project" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#3B82F6' }}>
                                  + Create New Project Detail...
                                </MenuItem>
                              ) : (
                                <MenuItem value="Other" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#3B82F6' }}>
                                  Other (Specify...)
                                </MenuItem>
                              )}
                            </Select>
                          </FormControl>
                        ) : isMultiRef ? (
                          <FormControl fullWidth>
                            <InputLabel id={`label-${f.name}`} sx={{ color: '#94A3B8' }}>{f.label} {f.required && '*'}</InputLabel>
                            <Select
                              labelId={`label-${f.name}`}
                              multiple
                              value={Array.isArray(value) ? value : value ? String(value).split(',').filter(Boolean) : []}
                              label={`${f.label} ${f.required ? '*' : ''}`}
                              required={f.required}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleInputChange(f.name, Array.isArray(val) ? val.join(',') : val);
                              }}
                              renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {selected.map((itemVal) => {
                                    const opt = (lookups[f.refModule] || []).find(o => String(o.id) === String(itemVal));
                                    return (
                                      <Chip 
                                        key={itemVal} 
                                        label={opt ? opt.name : itemVal} 
                                        size="small" 
                                        sx={{ 
                                          borderRadius: '4px',
                                          backgroundColor: '#2563EB',
                                          color: '#FFFFFF',
                                          height: 20,
                                          fontSize: '11px',
                                          fontWeight: 600
                                        }}
                                      />
                                    );
                                  })}
                                </Box>
                              )}
                              sx={{ 
                                color: '#FFFFFF',
                                backgroundColor: '#0F172A',
                                '& .MuiOutlinedInput-root': {
                                  backgroundColor: '#0F172A',
                                  color: '#FFFFFF'
                                },
                                '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3B82F6' }
                              }}
                            >
                              {lookups[f.refModule].map(opt => (
                                <MenuItem key={opt.id} value={opt.id}>{opt.name} ({opt.id})</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        ) : isBoolean ? (
                          <FormControlLabel
                            control={
                              <Switch
                                checked={!!value}
                                onChange={(e) => handleInputChange(f.name, e.target.checked)}
                                color="primary"
                              />
                            }
                            label={
                              <Typography variant="body2" sx={{ color: '#F8FAFC', fontWeight: 600 }}>
                                {f.label}
                              </Typography>
                            }
                            sx={{ color: '#F8FAFC', ml: 0.5 }}
                          />
                        ) : (
                          <TextField
                            fullWidth
                            label={f.label}
                            required={f.required}
                            type={isDate ? 'date' : 'text'}
                            value={value}
                            InputLabelProps={isDate ? { shrink: true } : {}}
                            placeholder={f.label}
                            onChange={(e) => handleInputChange(f.name, e.target.value)}
                            sx={{ 
                              '& .MuiOutlinedInput-root': {
                                backgroundColor: '#0F172A',
                                color: '#FFFFFF',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3B82F6' }
                              },
                              input: { 
                                color: '#FFFFFF',
                                '&:-webkit-autofill': {
                                  WebkitBoxShadow: '0 0 0 1000px #0f172a inset !important',
                                  WebkitTextFillColor: '#ffffff !important'
                                }
                              },
                              '.MuiInputLabel-root': { color: '#94A3B8' }
                            }}
                          />
                        )}

                        {/* Custom 'Other' specification text field overlay */}
                        {(isSelect || isRef) && value === 'Other' && (
                          <TextField
                            fullWidth
                            multiline
                            rows={2}
                            label={`Specify Custom ${f.label}`}
                            value={customValues[f.name] || ''}
                            onChange={(e) => handleCustomInputChange(f.name, e.target.value)}
                            placeholder="Type custom details here..."
                            sx={{ 
                              mt: 1.5,
                              '& .MuiOutlinedInput-root': {
                                backgroundColor: '#0F172A',
                                color: '#FFFFFF',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3B82F6' }
                              },
                              input: { color: '#FFFFFF' },
                              '.MuiInputLabel-root': { color: '#94A3B8' }
                            }}
                            required
                          />
                        )}
                      </Grid>
                    );
                  })}
                </Grid>

                {/* Inline Nested Property Form */}
                {selectedModule === 'property_pitch_history' && formData.propertyId === 'Other_Property' && (
                  <Box sx={{ mt: 1, mb: 3.5, p: 2.5, border: '1px solid #334155', borderRadius: '16px', backgroundColor: '#1E293B', textAlign: 'left' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#3B82F6', textTransform: 'uppercase', fontFamily: 'Poppins', letterSpacing: '0.5px' }}>
                      Create New Property Detail
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Contact Person Name" size="small" fullWidth value={nestedPropertyData.contact_person_name || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, contact_person_name: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Contact Number" size="small" fullWidth value={nestedPropertyData.contact_number || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, contact_number: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Dealer/Owner/Booked</InputLabel>
                          <Select
                            value={nestedPropertyData.dealer_owner_booked || 'Direct'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealer_owner_booked: e.target.value }))}
                            label="Dealer/Owner/Booked"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Dealer">Dealer</MenuItem>
                            <MenuItem value="Direct">Direct</MenuItem>
                            <MenuItem value="Booked By Us">Booked By Us</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      {nestedPropertyData.dealer_owner_booked === 'Dealer' && (
                        <>
                          <Grid item xs={12} sm={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel sx={{ color: '#94A3B8' }}>Associated Dealer</InputLabel>
                              <Select
                                value={nestedPropertyData.dealerId || ''}
                                onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealerId: e.target.value }))}
                                label="Associated Dealer"
                                sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                              >
                                <MenuItem
                                  disableRipple
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  sx={{ 
                                    backgroundColor: 'transparent !important', 
                                    cursor: 'default',
                                    p: '4px 16px',
                                    '&:hover': { backgroundColor: 'transparent' }
                                  }}
                                >
                                  <TextField
                                    size="small"
                                    placeholder="Search dealers..."
                                    fullWidth
                                    value={dealerSearch}
                                    onChange={(e) => setDealerSearch(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    sx={{ 
                                      input: { color: '#FFFFFF' }, 
                                      '.MuiInputLabel-root': { color: '#94A3B8' },
                                      '& .MuiOutlinedInput-root': {
                                        backgroundColor: '#0F172A',
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' }
                                      }
                                    }}
                                  />
                                </MenuItem>
                                <MenuItem value="">-- Select --</MenuItem>
                                {(lookups['dealers'] || []).filter(d => {
                                  if (!dealerSearch) return true;
                                  return String(d.name || '').toLowerCase().includes(dealerSearch.toLowerCase()) || 
                                         String(d.id || '').toLowerCase().includes(dealerSearch.toLowerCase());
                                }).map(d => (
                                  <MenuItem key={d.id} value={d.id}>{d.name} ({d.id})</MenuItem>
                                ))}
                                <MenuItem value="Other_Dealer" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#3B82F6' }}>
                                  + Add New Property Dealer
                                </MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel sx={{ color: '#94A3B8' }}>Dealer Deal Type</InputLabel>
                              <Select
                                value={nestedPropertyData.dealer_deal_type || ''}
                                onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealer_deal_type: e.target.value }))}
                                label="Dealer Deal Type"
                                sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                              >
                                <MenuItem value="Dealer To Dealer">Dealer To Dealer</MenuItem>
                                <MenuItem value="Direct">Direct</MenuItem>
                                <MenuItem value="Booked">Booked</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>

                          {nestedPropertyData.dealerId === 'Other_Dealer' && (
                            <Grid item xs={12}>
                              <Paper sx={{ p: 2.5, border: '1px solid #3B82F6', borderRadius: '12px', backgroundColor: '#0F172A', boxShadow: 'none' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#FFFFFF', fontFamily: 'Poppins' }}>
                                  Create New Property Dealer
                                </Typography>
                                <Grid container spacing={2}>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Firm Name" size="small" fullWidth required value={nestedDealerData.firm_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, firm_name: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Person Name" size="small" fullWidth required value={nestedDealerData.person_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, person_name: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Contact Number" size="small" fullWidth required value={nestedDealerData.contact_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contact_num: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Contacted Number" size="small" fullWidth value={nestedDealerData.contacted_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contacted_num: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Area/Sector/Block" size="small" fullWidth required value={nestedDealerData.sector_block || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, sector_block: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Address" size="small" fullWidth value={nestedDealerData.address || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, address: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                  <Grid item xs={12}>
                                    <TextField label="Call Notes/Remarks" size="small" fullWidth multiline rows={2} value={nestedDealerData.remarks || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, remarks: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                                  </Grid>
                                </Grid>
                              </Paper>
                            </Grid>
                          )}
                        </>
                      )}

                      {nestedPropertyData.dealer_owner_booked === 'Booked By Us' && (
                        <Grid item xs={12} sm={6}>
                          <FormControl fullWidth size="small">
                            <InputLabel sx={{ color: '#94A3B8' }}>Booked By (Customer)</InputLabel>
                            <Select
                              value={nestedPropertyData.booked_by_customer_id || ''}
                              onChange={(e) => setNestedPropertyData(prev => ({ ...prev, booked_by_customer_id: e.target.value }))}
                              label="Booked By (Customer)"
                              sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                            >
                              <MenuItem value="">-- Select --</MenuItem>
                              {(lookups['customers'] || []).map(c => (
                                <MenuItem key={c.id} value={c.id}>{c.name} ({c.id})</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                      )}

                      <Grid item xs={12} sm={6}>
                        <TextField label="Locality" size="small" fullWidth value={nestedPropertyData.locality || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, locality: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Sector/Block" size="small" fullWidth value={nestedPropertyData.sector_block || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, sector_block: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Size of Property" size="small" fullWidth value={nestedPropertyData.size || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Demand (Price)" size="small" fullWidth value={nestedPropertyData.demand || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, demand: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Property Type</InputLabel>
                          <Select
                            value={nestedPropertyData.propertyType || 'Plot'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, propertyType: e.target.value }))}
                            label="Property Type"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Villa">Luxury Villa</MenuItem>
                            <MenuItem value="Plot">Residential Land Plot</MenuItem>
                            <MenuItem value="Apartment">Multistory Apartment</MenuItem>
                            <MenuItem value="Commercial">Retail/Office Space</MenuItem>
                            <MenuItem value="LOI">LOI</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>R/C/I</InputLabel>
                          <Select
                            value={nestedPropertyData.r_c_i || 'Residential'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, r_c_i: e.target.value }))}
                            label="R/C/I"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Residential">Residential</MenuItem>
                            <MenuItem value="Commercial">Commercial</MenuItem>
                            <MenuItem value="Industrial">Industrial</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Status</InputLabel>
                          <Select
                            value={nestedPropertyData.status || 'Available'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, status: e.target.value }))}
                            label="Status"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Available">Available</MenuItem>
                            <MenuItem value="Booked By Client">Booked By Client</MenuItem>
                            <MenuItem value="Booked By Outside Dealer">Booked By Outside Dealer</MenuItem>
                            <MenuItem value="Hold">Hold</MenuItem>
                            <MenuItem value="Sold Out">Sold Out</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Date" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={nestedPropertyData.date || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, date: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <TextField label="Address Number" size="small" fullWidth value={nestedPropertyData.address_number || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, address_number: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="BHK & Washrooms" size="small" fullWidth value={nestedPropertyData.bhk_and_washrooms || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, bhk_and_washrooms: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Dimensions" size="small" fullWidth value={nestedPropertyData.dimensions || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dimensions: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Location Type</InputLabel>
                          <Select
                            value={nestedPropertyData.location_type || 'Normal'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, location_type: e.target.value }))}
                            label="Location Type"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Normal">Normal</MenuItem>
                            <MenuItem value="Corner">Corner</MenuItem>
                            <MenuItem value="Park Facing">Park Facing</MenuItem>
                            <MenuItem value="Wide Road">Wide Road</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Facing</InputLabel>
                          <Select
                            value={nestedPropertyData.facing || 'East'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, facing: e.target.value }))}
                            label="Facing"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="East">East</MenuItem>
                            <MenuItem value="West">West</MenuItem>
                            <MenuItem value="North">North</MenuItem>
                            <MenuItem value="South">South</MenuItem>
                            <MenuItem value="North-East">North-East</MenuItem>
                            <MenuItem value="North-West">North-West</MenuItem>
                            <MenuItem value="South-East">South-East</MenuItem>
                            <MenuItem value="South-West">South-West</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="White" size="small" fullWidth value={nestedPropertyData.white || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, white: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Time" size="small" fullWidth value={nestedPropertyData.time || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, time: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Lead Source</InputLabel>
                          <Select
                            value={nestedPropertyData.lead_source || 'Self Source'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, lead_source: e.target.value }))}
                            label="Lead Source"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Self Source">Self Source</MenuItem>
                            <MenuItem value="Cold Calling">Cold Calling</MenuItem>
                            <MenuItem value="JustDial">JustDial</MenuItem>
                            <MenuItem value="Social Media">Social Media</MenuItem>
                            <MenuItem value="Dealer Network">Dealer Network</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12}>
                        <TextField label="Initial Notes" size="small" fullWidth multiline rows={2} value={nestedPropertyData.initial_notes || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, initial_notes: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Inline Nested Project Form */}
                {selectedModule === 'property_pitch_history' && formData.projectId === 'Other_Project' && (
                  <Box sx={{ mt: 1, mb: 3.5, p: 2.5, border: '1px solid #334155', borderRadius: '16px', backgroundColor: '#1E293B', textAlign: 'left' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#3B82F6', textTransform: 'uppercase', fontFamily: 'Poppins', letterSpacing: '0.5px' }}>
                      Create New Project Detail
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Project Name" size="small" fullWidth required value={nestedProjectData.name || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, name: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Builder Group</InputLabel>
                          <Select
                            value={nestedProjectData.builder || 'DLF Group'}
                            onChange={(e) => setNestedProjectData(prev => ({ ...prev, builder: e.target.value }))}
                            label="Builder Group"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="DLF Group">DLF Group</MenuItem>
                            <MenuItem value="M3M India">M3M India</MenuItem>
                            <MenuItem value="Emaar India">Emaar India</MenuItem>
                            <MenuItem value="Signature Global">Signature Global</MenuItem>
                            <MenuItem value="Godrej Properties">Godrej Properties</MenuItem>
                            <MenuItem value="Smart World">Smart World</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Locality" size="small" fullWidth value={nestedProjectData.locality || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, locality: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Sector/Block" size="small" fullWidth value={nestedProjectData.sector_block || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, sector_block: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel sx={{ color: '#94A3B8' }}>Construction Status</InputLabel>
                          <Select
                            value={nestedProjectData.status || 'Ready to Move'}
                            onChange={(e) => setNestedProjectData(prev => ({ ...prev, status: e.target.value }))}
                            label="Construction Status"
                            sx={{ color: '#FFFFFF', backgroundColor: '#0F172A', '.MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } }}
                          >
                            <MenuItem value="Under Construction">Under Construction</MenuItem>
                            <MenuItem value="New Launch">New Launch</MenuItem>
                            <MenuItem value="Ready to Move">Ready to Move</MenuItem>
                            <MenuItem value="Possession Soon">Possession Soon</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Pricing Details" size="small" fullWidth value={nestedProjectData.pricing_details || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, pricing_details: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="PLC Percent" size="small" fullWidth value={nestedProjectData.plc_percent || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, plc_percent: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField label="Initial Notes" size="small" fullWidth multiline rows={2} value={nestedProjectData.initial_notes || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, initial_notes: e.target.value }))} sx={{ input: { color: '#FFFFFF' }, '.MuiInputLabel-root': { color: '#94A3B8' }, '& .MuiOutlinedInput-root': { backgroundColor: '#0F172A', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#334155' } } }} />
                      </Grid>
                    </Grid>
                  </Box>
                )}

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  disabled={submitting || fields.length === 0}
                  sx={{ 
                    py: 1.5, 
                    fontWeight: 700, 
                    borderRadius: '12px', 
                    backgroundColor: '#3B82F6', 
                    '&:hover': { backgroundColor: '#2563EB' },
                    textTransform: 'none',
                    fontFamily: 'Poppins'
                  }}
                >
                  {submitting ? 'Submitting Record...' : 'Submit Entry'}
                </Button>
              </form>
            </Box>
          )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
};

export default QuickAdd;
