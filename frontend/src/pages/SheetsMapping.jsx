import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Grid, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  TextField, 
  Button, 
  Divider, 
  Checkbox, 
  FormControlLabel, 
  Switch,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { useApp, API_BASE_URL } from '../context/AppContext';

const SheetsMapping = () => {
  const { 
    metadata, 
    saveMetadata, 
    moduleData,
    fetchModuleData,
    triggerAppReload
  } = useApp();

  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  // --- Google Sheets Connection Config States ---
  const [sheetsId, setSheetsId] = useState('');
  const [sheetsActive, setSheetsActive] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // --- Google Sheets Header Mapping States ---
  const [sheetTabs, setSheetTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // Try to load initial mapping values from localStorage
  const getInitialMappingState = () => {
    try {
      const saved = localStorage.getItem('gr_crm_last_mapping_state');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to parse last mapping state:', e);
    }
    return null;
  };

  const savedState = getInitialMappingState() || {};

  const [activeMappingId, setActiveMappingId] = useState(savedState.activeMappingId || 'new');
  const [mappingName, setMappingName] = useState(savedState.mappingName || 'New Sheet Import Template');
  const [mappingModule, setMappingModule] = useState(savedState.mappingModule || 'customers');
  const [mappingSheetName, setMappingSheetName] = useState(savedState.mappingSheetName || '');
  const [detectedHeaders, setDetectedHeaders] = useState([]);
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [headerMap, setHeaderMap] = useState(savedState.headerMap || {});
  const [writeBackEnabled, setWriteBackEnabled] = useState(savedState.writeBackEnabled !== false);
  const [searchHeaderQuery, setSearchHeaderQuery] = useState('');
  const [searchCrmQuery, setSearchCrmQuery] = useState('');

  const [testingMapping, setTestingMapping] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [openImportPreviewDialog, setOpenImportPreviewDialog] = useState(false);
  const [importingMapping, setImportingMapping] = useState(false);
  const [syncResultModal, setSyncResultModal] = useState(null);

  const isFirstMount = useRef(true);

  // Populate connection settings from metadata on load
  useEffect(() => {
    if (metadata?.sheetsConfig) {
      setSheetsId(metadata.sheetsConfig.spreadsheetId || '');
      setSheetsActive(metadata.sheetsConfig.syncActive || false);
    }
  }, [metadata]);

  // Load sheets configuration and tabs on component mount
  useEffect(() => {
    fetchModuleData('employees');
    loadSheetTabs();
  }, []);

  // Save mapping state to localStorage on any change
  useEffect(() => {
    const state = {
      activeMappingId,
      mappingName,
      mappingModule,
      mappingSheetName,
      headerMap,
      writeBackEnabled
    };
    localStorage.setItem('gr_crm_last_mapping_state', JSON.stringify(state));

    if (mappingSheetName && Object.keys(headerMap).length > 0) {
      const tabStorageKey = `gr_crm_map_${metadata?.sheetsConfig?.spreadsheetId || 'default'}_${mappingSheetName}`;
      localStorage.setItem(tabStorageKey, JSON.stringify(headerMap));
    }
  }, [activeMappingId, mappingName, mappingModule, mappingSheetName, headerMap, writeBackEnabled, metadata?.sheetsConfig?.spreadsheetId]);

  // Fetch tabs in Google Spreadsheet
  const loadSheetTabs = async () => {
    try {
      setLoadingTabs(true);
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const res = await axios.get(`${API_BASE_URL}/sync/sheets`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setSheetTabs(res.data.sheets || []);
      }
      setLoadingTabs(false);
    } catch (err) {
      console.error('Failed to load sheet tabs:', err);
      // Suppress showing error banner on load if config is empty
      if (metadata?.sheetsConfig?.spreadsheetId) {
        showStatus('error', err.response?.data?.message || 'Failed to fetch spreadsheet tabs.');
      }
      setLoadingTabs(false);
    }
  };

  // Fetch headers for selected sheet tab
  const loadSheetHeaders = async (tabName) => {
    if (!tabName) {
      setDetectedHeaders([]);
      return;
    }
    try {
      setLoadingHeaders(true);
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const res = await axios.get(`${API_BASE_URL}/sync/sheets/${encodeURIComponent(tabName)}/headers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setDetectedHeaders(res.data.headers || []);
      }
      setLoadingHeaders(false);
    } catch (err) {
      console.error('Failed to load headers:', err);
      showStatus('error', err.response?.data?.message || 'Failed to fetch sheet headers.');
      setLoadingHeaders(false);
    }
  };

  // Load headers when sheet tab changes
  useEffect(() => {
    if (mappingSheetName) {
      loadSheetHeaders(mappingSheetName);
    }
  }, [mappingSheetName]);

  // Load existing mapping configuration when template selection changes
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const mappings = metadata?.sheetMappings || [];
    if (activeMappingId === 'new') {
      setMappingName('New Sheet Import Template');
      setMappingModule('customers');
      setMappingSheetName('');
      setDetectedHeaders([]);
      setHeaderMap({});
      setWriteBackEnabled(true);
    } else {
      const match = mappings.find(m => m.id === activeMappingId);
      if (match) {
        setMappingName(match.name || '');
        setMappingModule(match.module || 'customers');
        setMappingSheetName(match.sheetName || '');
        setHeaderMap(match.headerMap || {});
        setWriteBackEnabled(match.writeBackEnabled !== false);
      }
    }
  }, [activeMappingId, metadata]);

  const showStatus = (type, text) => {
    setStatusMsg({ type, text });
    setTimeout(() => {
      setStatusMsg({ type: '', text: '' });
    }, 6000);
  };

  const handleSaveSheetsConfig = async (e) => {
    if (e) e.preventDefault();
    try {
      setSavingConfig(true);
      const updated = { ...metadata };
      updated.sheetsConfig = updated.sheetsConfig || {};
      updated.sheetsConfig.spreadsheetId = sheetsId.trim();
      updated.sheetsConfig.syncActive = sheetsActive;

      const res = await saveMetadata(updated);
      setSavingConfig(false);
      if (res.success) {
        showStatus('success', 'Google Sheets configuration saved successfully!');
        loadSheetTabs(); // Automatically fetch sheets in spreadsheet
      } else {
        showStatus('error', res.message);
      }
    } catch (err) {
      setSavingConfig(false);
      showStatus('error', 'Failed to save configuration.');
    }
  };

  const handleSaveMapping = async () => {
    if (!mappingName.trim()) {
      showStatus('error', 'Please enter a name for the mapping template.');
      return;
    }
    if (!mappingSheetName) {
      showStatus('error', 'Please select a Google Sheet tab.');
      return;
    }

    const updated = { ...metadata };
    updated.sheetMappings = updated.sheetMappings || [];

    const mapData = {
      id: activeMappingId === 'new' ? `MAP-${Date.now()}` : activeMappingId,
      name: mappingName.trim(),
      module: mappingModule,
      sheetName: mappingSheetName,
      headerMap,
      writeBackEnabled,
      createdAt: new Date().toISOString()
    };

    if (activeMappingId === 'new') {
      updated.sheetMappings.push(mapData);
      setActiveMappingId(mapData.id);
    } else {
      const idx = updated.sheetMappings.findIndex(m => m.id === activeMappingId);
      if (idx !== -1) {
        updated.sheetMappings[idx] = mapData;
      } else {
        updated.sheetMappings.push(mapData);
      }
    }

    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', 'Mapping template saved successfully!');
    } else {
      showStatus('error', 'Failed to save mapping template.');
    }
  };

  const handleDeleteMapping = async () => {
    if (activeMappingId === 'new') return;

    const updated = { ...metadata };
    updated.sheetMappings = (updated.sheetMappings || []).filter(m => m.id !== activeMappingId);

    const res = await saveMetadata(updated);
    if (res.success) {
      setActiveMappingId('new');
      showStatus('success', 'Mapping template deleted successfully!');
    } else {
      showStatus('error', 'Failed to delete template.');
    }
  };

  const handleTestMapping = async () => {
    if (!mappingSheetName) {
      showStatus('error', 'Please select a Google Sheet tab.');
      return;
    }
    try {
      setTestingMapping(true);
      const payload = {
        name: mappingName,
        module: mappingModule,
        sheetName: mappingSheetName,
        headerMap,
        writeBackEnabled
      };
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const res = await axios.post(`${API_BASE_URL}/sync/mappings/test`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTestingMapping(false);
      setTestResults(res.data);
      setOpenImportPreviewDialog(true);
    } catch (err) {
      setTestingMapping(false);
      showStatus('error', err.response?.data?.message || 'Simulation test failed.');
    }
  };

  const handleExecuteImport = async () => {
    if (!mappingSheetName) {
      showStatus('error', 'Please select a Google Sheet tab.');
      return;
    }
    try {
      setImportingMapping(true);
      const payload = {
        name: mappingName,
        module: mappingModule,
        sheetName: mappingSheetName,
        headerMap,
        writeBackEnabled
      };
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const res = await axios.post(`${API_BASE_URL}/sync/import-with-mapping`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setImportingMapping(false);
      setOpenImportPreviewDialog(false);
      if (res.data.success) {
        setSyncResultModal({
          success: true,
          title: 'Google Sheet Import Complete (Sheet ➔ CRM)',
          message: `Mapping-based import completed successfully.`,
          summary: {
            details: {
              [mappingModule]: {
                added: res.data.metrics.imported,
                skipped: res.data.metrics.skipped,
                updated: res.data.metrics.updated,
                total: res.data.metrics.totalRows,
                validationErrors: res.data.metrics.validationErrors.length,
                duration: res.data.metrics.duration
              }
            }
          }
        });
      }
    } catch (err) {
      setImportingMapping(false);
      showStatus('error', err.response?.data?.message || 'Execution failed.');
    }
  };

  const handleExportTemplate = () => {
    const payload = {
      name: mappingName,
      module: mappingModule,
      sheetName: mappingSheetName,
      headerMap,
      writeBackEnabled
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `${mappingName.toLowerCase().replace(/\s+/g, '_')}_template.json`);
    dlAnchorElem.click();
  };

  const handleImportTemplateFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        parsed.id = `MAP-${Date.now()}`;
        parsed.name = `${parsed.name || 'Imported Template'} (Imported)`;

        const updated = { ...metadata };
        updated.sheetMappings = updated.sheetMappings || [];
        updated.sheetMappings.push(parsed);

        const res = await saveMetadata(updated);
        if (res.success) {
          setActiveMappingId(parsed.id);
          showStatus('success', 'Mapping template imported successfully!');
        } else {
          showStatus('error', 'Failed to save imported template.');
        }
      } catch (err) {
        showStatus('error', 'Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const handleResetMapping = () => {
    setHeaderMap({});
    showStatus('success', 'Selections cleared.');
  };

  if (!metadata || !metadata.modules) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
        <CircularProgress size={40} sx={{ color: '#2563EB' }} />
        <Typography variant="body2" sx={{ color: '#64748B', fontWeight: 600 }}>Loading Sheets Configuration...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Title */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '26px', color: '#0F172A', fontFamily: 'Poppins' }}>
          Google Sheets Mapping & Sync
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B' }}>
          Configure Spreadsheet connections and build custom schemas mapping sheet columns to dynamic CRM fields.
        </Typography>
      </Box>

      {statusMsg.text && (
        <Alert severity={statusMsg.type} onClose={() => setStatusMsg({ type: '', text: '' })} sx={{ mb: 3, borderRadius: '8px' }}>
          {statusMsg.text}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Connection Settings Card */}
        <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 1, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Icons.Settings size={20} className="text-blue-600" /> Google Sheets Sync Settings
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
              Configure the active Spreadsheet connection details. Secrets and certificates are secured in server environment variables.
            </Typography>

            <Divider sx={{ mb: 3 }} />

            <Box component="form" onSubmit={handleSaveSheetsConfig}>
              <Grid container spacing={3}>
                <Grid item xs={12} display="flex" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Active Background Sync</Typography>
                    <Typography variant="caption" sx={{ color: '#64748B' }}>When active, background workers automatically push queue updates to Google Sheets.</Typography>
                  </Box>
                  <Switch 
                    checked={sheetsActive}
                    onChange={(e) => setSheetsActive(e.target.checked)}
                  />
                </Grid>

                <Grid item xs={12} md={8}>
                  <TextField
                    label="Spreadsheet ID (URL string)"
                    fullWidth
                    value={sheetsId}
                    onChange={(e) => setSheetsId(e.target.value)}
                    required
                    placeholder="e.g. 1xABC_ExampleSpreadsheetIDHere"
                  />
                </Grid>

                <Grid item xs={12} md={4} display="flex" alignItems="center">
                  <Box sx={{ border: '1px solid #E2E8F0', borderRadius: '8px', p: 1.5, display: 'flex', alignItems: 'center', gap: 1, backgroundColor: '#F8FAFC', width: '100%' }}>
                    <Icons.ShieldCheck size={18} className="text-emerald-500" />
                    <Box>
                      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Credentials Status</Typography>
                      <Typography variant="caption" sx={{ color: '#10B981', fontWeight: 600 }}>Secured in server .env</Typography>
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={12}>
                  <Button 
                    type="submit" 
                    variant="contained" 
                    disabled={savingConfig}
                    sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, textTransform: 'none', borderRadius: '8px', px: 3, fontWeight: 700 }}
                  >
                    {savingConfig ? 'Saving...' : 'Save Connection Settings'}
                  </Button>
                </Grid>
              </Grid>
            </Box>
          </CardContent>
        </Card>

        {/* Header / Template Manager Card */}
        <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ fontWeight: 800, fontSize: '20px', fontFamily: 'Poppins', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Icons.Sliders size={20} className="text-blue-600" /> Sheets Header Mapping Configuration
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
              Build custom schemas mapping arbitrary Google Sheets columns to dynamic CRM fields. Adapts automatically to database schema changes.
            </Typography>

            <Divider sx={{ mb: 3 }} />

            <Grid container spacing={3} alignItems="center">
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Mapping Template</InputLabel>
                  <Select
                    value={activeMappingId}
                    onChange={(e) => setActiveMappingId(e.target.value)}
                    label="Mapping Template"
                  >
                    <MenuItem value="new"><em>Create New Template...</em></MenuItem>
                    {(metadata?.sheetMappings || []).map(m => (
                      <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={8} display="flex" justifyContent="flex-end" gap={1.5}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleExportTemplate}
                  disabled={activeMappingId === 'new'}
                  startIcon={<Icons.Download size={14} />}
                  sx={{ textTransform: 'none', borderRadius: '8px', color: '#475569', borderColor: '#CBD5E1' }}
                >
                  Export Schema
                </Button>

                <Button
                  variant="outlined"
                  component="label"
                  size="small"
                  startIcon={<Icons.Upload size={14} />}
                  sx={{ textTransform: 'none', borderRadius: '8px', color: '#475569', borderColor: '#CBD5E1' }}
                >
                  Import Schema
                  <input
                    type="file"
                    hidden
                    accept=".json"
                    onChange={handleImportTemplateFile}
                  />
                </Button>

                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={handleDeleteMapping}
                  disabled={activeMappingId === 'new'}
                  startIcon={<Icons.Trash2 size={14} />}
                  sx={{ textTransform: 'none', borderRadius: '8px' }}
                >
                  Delete Template
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Template Form Schema Editor */}
        <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
          <CardContent sx={{ p: 3 }}>
            <Grid container spacing={3} sx={{ mb: 4 }}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Template Friendly Name"
                  fullWidth
                  size="small"
                  value={mappingName}
                  onChange={(e) => setMappingName(e.target.value)}
                  required
                />
              </Grid>

              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Target CRM Module</InputLabel>
                  <Select
                    value={mappingModule}
                    onChange={(e) => {
                      setMappingModule(e.target.value);
                      setHeaderMap({});
                    }}
                    label="Target CRM Module"
                  >
                    {Object.entries(metadata?.modules || {}).map(([key, mod]) => (
                      <MenuItem key={key} value={key}>{mod.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small" error={sheetTabs.length === 0 && !loadingTabs}>
                  <InputLabel>Spreadsheet Tab Name</InputLabel>
                  <Select
                    value={mappingSheetName}
                    onChange={(e) => {
                      const newTab = e.target.value;
                      setMappingSheetName(newTab);
                      
                      // Load tab-specific mapped columns from localStorage if available
                      const storageKey = `gr_crm_map_${metadata?.sheetsConfig?.spreadsheetId || 'default'}_${newTab}`;
                      const saved = localStorage.getItem(storageKey);
                      if (saved) {
                        try {
                          setHeaderMap(JSON.parse(saved));
                        } catch (err) {
                          setHeaderMap({});
                        }
                      } else {
                        setHeaderMap({});
                      }
                    }}
                    label="Spreadsheet Tab Name"
                    disabled={loadingTabs}
                  >
                    {loadingTabs ? (
                      <MenuItem disabled><em>Loading spreadsheet tabs...</em></MenuItem>
                    ) : sheetTabs.length === 0 ? (
                      <MenuItem disabled><em>No tabs detected. Check Sheets Config.</em></MenuItem>
                    ) : (
                      sheetTabs.map(t => (
                        <MenuItem key={t} value={t}>{t}</MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {/* Warning message for unmapped required CRM fields */}
            {(() => {
              const modFields = metadata?.modules?.[mappingModule]?.fields || [];
              const reqFields = modFields.filter(f => f.required && f.name !== 'id' && f.name !== 'last_updated' && f.name !== 'propertyName');
              const missing = reqFields.filter(f => !Object.values(headerMap).includes(f.name));
              if (missing.length > 0) {
                return (
                  <Alert severity="warning" sx={{ mb: 3, borderRadius: '8px' }}>
                    <strong>Required CRM Fields Unmapped:</strong> {missing.map(f => f.label).join(', ')}. Imports may fail if rows contain missing data.
                  </Alert>
                );
              }
              return null;
            })()}

            {loadingHeaders ? (
              <Box display="flex" justifyContent="center" alignItems="center" py={6}>
                <CircularProgress size={30} />
                <Typography variant="body2" sx={{ ml: 2, color: '#64748B' }}>Fetching spreadsheet columns...</Typography>
              </Box>
            ) : detectedHeaders.length === 0 ? (
              <Box sx={{ border: '1px dashed #E2E8F0', borderRadius: '12px', p: 5, textAlign: 'center', backgroundColor: '#F8FAFC' }}>
                <Icons.FileSpreadsheet size={40} style={{ color: '#94A3B8', marginBottom: 12 }} />
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#475569' }}>
                  No spreadsheet tab columns detected
                </Typography>
                <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block', mt: 0.5 }}>
                  Select a valid spreadsheet tab name above to fetch columns and start mapping.
                </Typography>
              </Box>
            ) : (
              <Box>
                {/* Search / Filter Section */}
                <Box display="flex" gap={2} mb={3}>
                  <TextField
                    placeholder="Search Google Sheet headers..."
                    size="small"
                    value={searchHeaderQuery}
                    onChange={(e) => setSearchHeaderQuery(e.target.value)}
                    sx={{ flexGrow: 1 }}
                    InputProps={{
                      startAdornment: <Icons.Search size={14} style={{ marginRight: 8, color: '#94A3B8' }} />
                    }}
                  />
                  <TextField
                    placeholder="Search CRM Destination fields..."
                    size="small"
                    value={searchCrmQuery}
                    onChange={(e) => setSearchCrmQuery(e.target.value)}
                    sx={{ flexGrow: 1 }}
                    InputProps={{
                      startAdornment: <Icons.Search size={14} style={{ marginRight: 8, color: '#94A3B8' }} />
                    }}
                  />
                </Box>

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px', border: '1px solid #E2E8F0', mb: 3 }}>
                  <Table size="medium">
                    <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Google Sheet Header</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Destination CRM Field</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: '#475569' }}>Validation Preview</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detectedHeaders
                        .filter(h => h.toLowerCase().includes(searchHeaderQuery.toLowerCase()))
                        .map(header => {
                          const mappedField = headerMap[header] || '';
                          const crmFieldObj = (metadata?.modules?.[mappingModule]?.fields || []).find(f => f.name === mappedField);
                          
                          // Check if search CRM filter matches
                          if (searchCrmQuery && (!crmFieldObj || !crmFieldObj.label.toLowerCase().includes(searchCrmQuery.toLowerCase()))) {
                            return null;
                          }

                          return (
                            <TableRow key={header} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{header}</TableCell>
                              <TableCell>
                                <FormControl size="small" sx={{ minWidth: 240 }}>
                                  <Select
                                    value={mappedField}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setHeaderMap(prev => {
                                        const updated = { ...prev };
                                        if (val) {
                                          updated[header] = val;
                                        } else {
                                          delete updated[header];
                                        }
                                        return updated;
                                      });
                                    }}
                                    displayEmpty
                                  >
                                    <MenuItem value=""><em>-- Unmapped --</em></MenuItem>
                                    {(metadata?.modules?.[mappingModule]?.fields || [])
                                      .filter(f => f.editable !== false || f.name === 'id')
                                      .map(f => (
                                        <MenuItem key={f.name} value={f.name}>
                                          {f.label} {f.required ? '*' : ''} ({f.type})
                                        </MenuItem>
                                      ))}
                                  </Select>
                                </FormControl>
                              </TableCell>
                              <TableCell align="right">
                                {crmFieldObj ? (
                                  <Typography variant="body2" color="success.main" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                    <Icons.CheckCircle2 size={14} /> Mapped to {crmFieldObj.label} ({crmFieldObj.type})
                                  </Typography>
                                ) : (
                                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                    Ignored during import
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Box display="flex" justifyContent="space-between" alignItems="center" mt={4}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={writeBackEnabled}
                        onChange={(e) => setWriteBackEnabled(e.target.checked)}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>Enable ID Write-Back to Sheet</Typography>
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                          CRM will write back the generated record ID directly into the spreadsheet's ID column.
                        </Typography>
                      </Box>
                    }
                  />

                  <Box display="flex" gap={2}>
                    <Button
                      variant="outlined"
                      onClick={handleResetMapping}
                      sx={{ textTransform: 'none', borderRadius: '8px', px: 3, fontWeight: 700, borderColor: '#CBD5E1', color: '#475569' }}
                    >
                      Clear Selections
                    </Button>
                    <Button
                      variant="contained"
                      onClick={handleSaveMapping}
                      sx={{ backgroundColor: '#1E293B', '&:hover': { backgroundColor: '#0F172A' }, textTransform: 'none', borderRadius: '8px', px: 4, fontWeight: 700 }}
                    >
                      Save Template
                    </Button>
                    <Button
                      variant="contained"
                      onClick={handleTestMapping}
                      disabled={testingMapping}
                      sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, textTransform: 'none', borderRadius: '8px', px: 4, fontWeight: 700 }}
                    >
                      {testingMapping ? 'Testing...' : 'Test Mapping & Preview'}
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* DIALOG: Import Preview & Simulation Dialog */}
      <Dialog 
        open={openImportPreviewDialog} 
        onClose={() => setOpenImportPreviewDialog(false)} 
        maxWidth="md" 
        fullWidth
        PaperProps={{
          style: { borderRadius: 16 }
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '20px', fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icons.ClipboardList size={22} className="text-blue-600" /> Mapping Test Results & Preview
        </DialogTitle>
        <DialogContent dividers>
          {testResults && (
            <Box>
              {/* Summary Cards */}
              <Grid container spacing={2} sx={{ mb: 4 }}>
                {[
                  { label: 'Total Rows Scanned', val: testResults.metrics.totalRows, color: '#475569', bg: '#F1F5F9' },
                  { label: 'New Records (Insert)', val: testResults.metrics.imported, color: '#10B981', bg: '#ECFDF5' },
                  { label: 'Existing Updates (Update)', val: testResults.metrics.updated, color: '#2563EB', bg: '#EFF6FF' },
                  { label: 'Errors / Skipped', val: testResults.metrics.skipped, color: '#EF4444', bg: '#FEF2F2' }
                ].map(summary => (
                  <Grid item xs={6} md={3} key={summary.label}>
                    <Box sx={{ backgroundColor: summary.bg, border: `1px solid ${summary.color}22`, borderRadius: '12px', p: 2, textAlign: 'center' }}>
                      <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, display: 'block', mb: 0.5 }}>{summary.label}</Typography>
                      <Typography variant="h4" sx={{ color: summary.color, fontWeight: 800 }}>{summary.val}</Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>

              {/* Rows List */}
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
                Live Rows Data Validation Preview (Showing first 10 rows)
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px', border: '1px solid #E2E8F0', maxHeight: 350 }}>
                <Table size="small" stickyHeader>
                  <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Row #</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status Action</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Record Key / Data</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Validation Issues / Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {testResults.preview.map((row, idx) => (
                      <TableRow key={idx} hover>
                        <TableCell sx={{ fontWeight: 700 }}>Row {row.rowNumber}</TableCell>
                        <TableCell>
                          <Chip 
                            size="small" 
                            label={row.status} 
                            color={row.status === 'ERROR' ? 'error' : row.status === 'UPDATE' ? 'info' : 'success'} 
                            sx={{ fontWeight: 700, borderRadius: '6px' }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                            {row.data.id || 'N/A'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Phone: {row.data.phone || 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1.5 }}>
                          {row.errors && row.errors.length > 0 ? (
                            row.errors.map((err, eIdx) => (
                              <Typography key={eIdx} variant="caption" color="error.main" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                • {err.field}: {err.error} (Value: "{err.value}")
                              </Typography>
                            ))
                          ) : (
                            <Typography variant="caption" color="success.main" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Icons.Check size={14} /> Ready to sync
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2.5, backgroundColor: '#F8FAFC' }}>
          <Button 
            onClick={() => setOpenImportPreviewDialog(false)}
            variant="outlined"
            sx={{ textTransform: 'none', borderRadius: '8px', color: '#475569', borderColor: '#CBD5E1' }}
          >
            Cancel / Edit Mapping
          </Button>
          <Button 
            onClick={handleExecuteImport}
            variant="contained"
            disabled={importingMapping || (testResults && testResults.metrics.imported === 0 && testResults.metrics.updated === 0)}
            sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, textTransform: 'none', borderRadius: '8px', px: 3, fontWeight: 700 }}
          >
            {importingMapping ? 'Importing...' : 'Accept Preview & Execute Import'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIALOG: Sync Complete Result Modal */}
      <Dialog 
        open={Boolean(syncResultModal)} 
        onClose={() => {
          const wasSuccess = syncResultModal?.success;
          setSyncResultModal(null);
          if (wasSuccess && triggerAppReload) triggerAppReload();
        }}
        maxWidth="xs" 
        fullWidth
        PaperProps={{
          style: { borderRadius: 16, padding: '8px' }
        }}
      >
        <DialogContent sx={{ textAlign: 'center', py: 4 }}>
          <Icons.CheckCircle2 size={54} className="text-emerald-500 mx-auto" style={{ marginBottom: 16 }} />
          <Typography variant="h3" sx={{ fontWeight: 800, fontSize: '20px', fontFamily: 'Poppins', mb: 1 }}>
            {syncResultModal?.title}
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
            {syncResultModal?.message}
          </Typography>

          {syncResultModal?.summary?.details && (
            <Box sx={{ backgroundColor: '#F8FAFC', borderRadius: '12px', border: '1px solid #E2E8F0', p: 2, textAlign: 'left', mb: 3 }}>
              {Object.entries(syncResultModal.summary.details).map(([modName, metrics]) => (
                <Box key={modName} sx={{ mb: 1.5, '&:last-child': { mb: 0 } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'capitalize', color: '#1E293B', mb: 0.5 }}>
                    Module: {modName}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: '#475569' }}>
                    • Total Rows: {metrics.total}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: '#10B981', fontWeight: 600 }}>
                    • Created (Insert): {metrics.added}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: '#2563EB', fontWeight: 600 }}>
                    • Updated: {metrics.updated}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: '#EF4444', fontWeight: 600 }}>
                    • Errors / Skipped: {metrics.skipped}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          <Button 
            variant="contained" 
            fullWidth
            onClick={() => {
              const wasSuccess = syncResultModal?.success;
              setSyncResultModal(null);
              if (wasSuccess && triggerAppReload) triggerAppReload();
            }}
            sx={{ backgroundColor: '#1E293B', '&:hover': { backgroundColor: '#0F172A' }, borderRadius: '8px', textTransform: 'none', py: 1.2, fontWeight: 700 }}
          >
            Okay, Great
          </Button>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default SheetsMapping;
