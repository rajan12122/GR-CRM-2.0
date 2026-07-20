import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Dialog, 
  DialogContent, 
  Box, 
  TextField, 
  InputAdornment, 
  Typography, 
  Divider, 
  CircularProgress,
  Grid,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  Paper,
  Tabs,
  Tab
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp, API_BASE_URL } from '../context/AppContext';
import { DynamicIcon } from './Sidebar';

const GlobalSearch = ({ open, onClose }) => {
  const { searchAll, fetchEntity360, metadata } = useApp();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({});
  const [activeRecord, setActiveRecord] = useState(null); // Expanded 360 record details
  const [activeRecordType, setActiveRecordType] = useState(''); // 'customers', 'employees', 'properties'
  const [connections, setConnections] = useState(null); // Relationship mapping for activeRecord
  const [activeTab, setActiveTab] = useState(0);
  const [searchMode, setSearchMode] = useState('standard'); // 'standard' or 'ai'
  const [aiSearchResult, setAiSearchResult] = useState('');
  const navigate = useNavigate();
  const searchInputRef = useRef(null);

  // Focus search input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 100);
      setQuery('');
      setResults({});
      setAiSearchResult('');
      setActiveRecord(null);
      setConnections(null);
    }
  }, [open]);

  // Execute search queries
  useEffect(() => {
    if (!query || query.trim() === '') {
      setResults({});
      setAiSearchResult('');
      setActiveRecord(null);
      setConnections(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      if (searchMode === 'standard') {
        const searchRes = await searchAll(query);
        setResults(searchRes.results || {});
        
        // Auto-load 360 view if exactly one search matches
        const keys = Object.keys(searchRes.results || {});
        if (keys.length === 1 && searchRes.results[keys[0]].length === 1) {
          handleRecordClick(keys[0], searchRes.results[keys[0]][0]);
        } else {
          setActiveRecord(null);
          setConnections(null);
        }
      } else {
        // AI search mode
        try {
          const res = await fetch(`${API_BASE_URL}/ai/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
            },
            body: JSON.stringify({ message: query })
          });
          const data = await res.json();
          setAiSearchResult(data.reply || 'No insights matching the query.');
        } catch (e) {
          setAiSearchResult('AI search request failed.');
        }
      }
      setLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [query, searchMode]);

  const handleRecordClick = async (type, record) => {
    setActiveRecord(record);
    setActiveRecordType(type);
    setActiveTab(0);
    
    if (['customers', 'employees', 'properties', 'dealers', 'projects', 'leads', 'follow_ups', 'queries', 'dealer_meetings'].includes(type)) {
      setLoading(true);
      const relations = await fetchEntity360(type, record.id);
      setConnections(relations);
      setLoading(false);
    } else {
      setConnections(null);
    }
  };

  const handleFullViewRedirect = () => {
    if (activeRecord) {
      onClose();
      navigate(`/module/${activeRecordType}/${activeRecord.id}`);
    }
  };

  const renderRecordSubtitle = (moduleName, rec) => {
    const parts = [];

    if (moduleName === 'properties') {
      if (rec.propertyType) parts.push(`Type: ${rec.propertyType}`);
      if (rec.size) parts.push(`Size: ${rec.size}`);
      if (rec.price) parts.push(`Price: ₹${rec.price.toLocaleString('en-IN')}`);
      if (rec.location) parts.push(`Loc: ${rec.location}`);
      if (rec.locality) parts.push(`Locality: ${rec.locality}`);
      if (rec.sector_block) parts.push(`Sec/Blk: ${rec.sector_block}`);
      if (rec.address_number) parts.push(`Addr: ${rec.address_number}`);
      if (rec.status) parts.push(`Status: ${rec.status}`);
      if (rec.deal_typr) parts.push(`Deal: ${rec.deal_typr}`);
      if (rec.dealtype) parts.push(`Deal: ${rec.dealtype}`);
    } else if (moduleName === 'customers') {
      if (rec.phone) parts.push(`Ph: ${rec.phone}`);
      if (rec.email) parts.push(rec.email);
      if (rec.budget) parts.push(`Budget: ₹${rec.budget.toLocaleString('en-IN')}`);
      if (rec.city) parts.push(`City: ${rec.city}`);
      if (rec.status) parts.push(`Stage: ${rec.status}`);
    } else if (moduleName === 'employees') {
      if (rec.role) parts.push(rec.role);
      if (rec.phone) parts.push(`Ph: ${rec.phone}`);
      if (rec.email) parts.push(rec.email);
      if (rec.status) parts.push(`Status: ${rec.status}`);
    } else if (moduleName === 'leads') {
      if (rec.phone) parts.push(`Ph: ${rec.phone}`);
      if (rec.email) parts.push(rec.email);
      if (rec.source) parts.push(`Src: ${rec.source}`);
      if (rec.status) parts.push(`Status: ${rec.status}`);
    } else if (moduleName === 'dealers') {
      if (rec.firm_name) parts.push(`Firm: ${rec.firm_name}`);
      if (rec.person_name) parts.push(`Person: ${rec.person_name}`);
      if (rec.contact_num) parts.push(`Ph: ${rec.contact_num}`);
      if (rec.sector_block) parts.push(`Area/Sec/Blk: ${rec.sector_block}`);
    } else {
      if (rec.phone) parts.push(`Ph: ${rec.phone}`);
      if (rec.email) parts.push(rec.email);
      if (rec.price) parts.push(`₹${rec.price.toLocaleString('en-IN')}`);
      if (rec.status) parts.push(rec.status);
    }

    return parts.length > 0 ? parts.join(' • ') : `ID: ${rec.id}`;
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      fullWidth 
      maxWidth="md"
      PaperProps={{
        style: {
          borderRadius: 16,
          backgroundColor: '#FFFFFF',
          minHeight: '450px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      {/* Search Input field Header */}
      <Box sx={{ p: 2.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip 
            label="Standard Database Search" 
            onClick={() => { setSearchMode('standard'); setQuery(''); }} 
            color={searchMode === 'standard' ? 'primary' : 'default'}
            variant={searchMode === 'standard' ? 'filled' : 'outlined'}
            size="small"
            sx={{ fontWeight: 700, cursor: 'pointer' }}
          />
          <Chip 
            label="AI Copilot Search" 
            onClick={() => { setSearchMode('ai'); setQuery(''); }} 
            color={searchMode === 'ai' ? 'primary' : 'default'}
            variant={searchMode === 'ai' ? 'filled' : 'outlined'}
            icon={<Icons.Sparkles size={12} />}
            size="small"
            sx={{ fontWeight: 700, cursor: 'pointer' }}
          />
        </Box>
        <TextField
          inputRef={searchInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchMode === 'standard' ? "Type keywords... (e.g. Mohali, Rajesh, Villa, CUST-001)" : "Ask Gagan Realtech AI... (e.g. 'Show me leads above 1 Cr' or 'Summary of site visits this month')"}
          fullWidth
          variant="outlined"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {searchMode === 'standard' ? <Icons.Search size={22} color="#2563EB" /> : <Icons.Sparkles size={22} color="#8B5CF6" />}
              </InputAdornment>
            ),
            endAdornment: loading && <CircularProgress size={20} />
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              backgroundColor: '#F8FAFC',
              '& fieldset': { borderColor: '#E2E8F0' },
              '&.Mui-focused fieldset': { borderColor: searchMode === 'standard' ? '#2563EB' : '#8B5CF6' }
            }
          }}
        />
      </Box>

      <Divider />

      <DialogContent sx={{ p: 0, flex: 1, display: 'flex', overflow: 'hidden' }}>
        {searchMode === 'ai' ? (
          <Box sx={{ flex: 1, p: 3, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E3A8A', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Icons.Sparkles size={16} />
              AI Search Analysis
            </Typography>
            {loading ? (
              <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
            ) : aiSearchResult ? (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#1E293B', fontWeight: 550, fontSize: '13px' }}>
                  {aiSearchResult}
                </Typography>
              </Paper>
            ) : (
              <Typography variant="body2" sx={{ color: '#64748B', fontSize: '13px' }}>
                Ask a search query in natural language to perform an AI scan across employees, customers, leads, follow-ups, and properties.
              </Typography>
            )}
          </Box>
        ) : Object.keys(results).length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, color: '#94A3B8' }}>
            <Icons.Layers size={48} strokeWidth={1} style={{ marginBottom: 12 }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Search properties, customers, RM, remarks, location etc.
            </Typography>
            <Typography variant="caption">
              Results and 360° connections link dynamically.
            </Typography>
          </Box>
        ) : (
          <Grid container sx={{ height: '100%', overflow: 'hidden' }}>
            {/* Left column - search list */}
            <Grid item xs={12} md={activeRecord ? 5 : 12} sx={{ borderRight: activeRecord ? '1px solid #E2E8F0' : 'none', maxHeight: 'calc(80vh - 100px)', overflowY: 'auto', p: 2, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: '#E2E8F0', borderRadius: '4px' } }}>
              {Object.keys(results).map(moduleName => (
                <Box key={moduleName} mb={2.5}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, px: 1 }}>
                    <DynamicIcon name={metadata?.modules[moduleName]?.icon || 'Layers'} size={16} color="#64748B" />
                    <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 700, color: '#64748B', letterSpacing: '0.05em' }}>
                      {metadata?.modules[moduleName]?.label}
                    </Typography>
                  </Box>
                  <List disablePadding>
                    {results[moduleName].map(rec => (
                      <ListItem 
                        key={rec.id} 
                        disablePadding 
                        sx={{ mb: 0.5 }}
                      >
                        <Paper
                          onClick={() => handleRecordClick(moduleName, rec)}
                          sx={{
                            width: '100%',
                            p: 1.5,
                            borderRadius: '8px',
                            cursor: 'pointer',
                            backgroundColor: activeRecord?.id === rec.id ? 'rgba(37, 99, 235, 0.05)' : '#FFFFFF',
                            border: activeRecord?.id === rec.id ? '1px solid #2563EB' : '1px solid #E2E8F0',
                            boxShadow: 'none',
                            transition: 'all 0.15s ease',
                            '&:hover': {
                              backgroundColor: 'rgba(37, 99, 235, 0.02)',
                              borderColor: '#94A3B8'
                            }
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#0F172A' }}>
                            {rec.name || rec.title || `Property #${rec.id}`}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#64748B', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            ID: {rec.id} • {renderRecordSubtitle(moduleName, rec)}
                          </Typography>
                        </Paper>
                      </ListItem>
                    ))}
                  </List>
                </Box>
              ))}
            </Grid>

            {/* Right column - Salesforce 360 detail connections */}
            {activeRecord && (
              <Grid item xs={12} md={7} sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {/* 360 Header details */}
                <Box sx={{ p: 2.5, backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography variant="caption" sx={{ textTransform: 'uppercase', color: '#2563EB', fontWeight: 700, fontSize: '10px' }}>
                      360° Entity Link Profile ({activeRecordType})
                    </Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '20px', color: '#0F172A', fontFamily: 'Poppins' }}>
                      {activeRecord.name || activeRecord.title || activeRecord.id}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', fontSize: '12px' }}>
                      Primary Identifier ID: {activeRecord.id}
                    </Typography>
                  </Box>
                  <Chip 
                    label="Full Detail Page ↗" 
                    color="primary" 
                    size="small"
                    onClick={handleFullViewRedirect}
                    sx={{ fontWeight: 600, cursor: 'pointer', borderRadius: '6px' }}
                  />
                </Box>

                {/* Tab layout connections */}
                {['customers', 'employees', 'properties', 'dealers', 'projects', 'leads', 'follow_ups', 'queries', 'dealer_meetings'].includes(activeRecordType) && connections ? (
                  <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <Tabs 
                      value={activeTab} 
                      onChange={(e, val) => setActiveTab(val)} 
                      variant="scrollable"
                      sx={{ borderBottom: '1px solid #E2E8F0', px: 1 }}
                    >
                      <Tab label="Linked Data" sx={{ fontWeight: 600 }} />
                      <Tab label={`Remarks (${connections.remarks?.length || 0})`} sx={{ fontWeight: 600 }} />
                      <Tab label={`Files (${connections.documents?.length || 0})`} sx={{ fontWeight: 600 }} />
                    </Tabs>

                    <Box sx={{ p: 2, overflowY: 'auto', flex: 1, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: '#E2E8F0', borderRadius: '4px' } }}>
                      
                      {activeTab === 0 && (
                        <Box>
                          {/* CUSTOMER LINK PROFILE */}
                          {activeRecordType === 'customers' && (
                            <Grid container spacing={2}>
                              <Grid item xs={12}>
                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Assigned RM (Manager):</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>
                                  {connections.employee ? `${connections.employee.name} (${connections.employee.email})` : 'Unassigned'}
                                </Typography>

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Budget Constraint & City Preference:</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>
                                  ₹{activeRecord.budget?.toLocaleString('en-IN') || 'No Limit'} in {activeRecord.city || 'Any City'}
                                </Typography>

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Site Visits Executed ({connections.site_visits?.length || 0}):</Typography>
                                {connections.site_visits?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8', mb: 1.5 }}>None registered</Typography>
                                ) : (
                                  connections.site_visits.map(sv => (
                                    <Paper key={sv.id} sx={{ p: 1, mb: 1, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{sv.property?.name || sv.propertyId}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Date: {sv.date} • Feedback: <strong>{sv.result}</strong></Typography>
                                    </Paper>
                                  ))
                                )}

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Sales Bookings completed ({connections.sales?.length || 0}):</Typography>
                                {connections.sales?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>None registered</Typography>
                                ) : (
                                  connections.sales.map(sa => (
                                    <Paper key={sa.id} sx={{ p: 1, mt: 0.5, backgroundColor: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.2)', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#16A34A' }}>Booked: {sa.property?.name || sa.propertyId}</Typography>
                                      <Typography variant="caption" sx={{ color: '#16A34A' }}>Sold Price: ₹{sa.salePrice?.toLocaleString('en-IN')} • Date: {sa.agreementDate}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                            </Grid>
                          )}

                          {/* EMPLOYEE LINK PROFILE */}
                          {activeRecordType === 'employees' && (
                            <Grid container spacing={2}>
                              <Grid item xs={12}>
                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Role Profile & Contact:</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>
                                  {activeRecord.role} • {activeRecord.email} • {activeRecord.phone}
                                </Typography>

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Handling Customers ({connections.customers?.length || 0}):</Typography>
                                {connections.customers?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8', mb: 1.5 }}>None assigned</Typography>
                                ) : (
                                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
                                    {connections.customers.map(c => <Chip key={c.id} label={c.name} size="small" />)}
                                  </Box>
                                )}

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Tasks Assigned ({connections.tasks?.length || 0}):</Typography>
                                {connections.tasks?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8', mb: 1.5 }}>None outstanding</Typography>
                                ) : (
                                  connections.tasks.map(t => (
                                    <Paper key={t.id} sx={{ p: 1, mb: 1, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Due: {t.dueDate} • Priority: <strong>{t.priority}</strong> • Status: {t.status}</Typography>
                                    </Paper>
                                  ))
                                )}

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Attendance logs ({connections.attendance?.length || 0}):</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  Present Days: {connections.attendance?.filter(a=>a.status==='Present').length || 0} • Late Days: {connections.attendance?.filter(a=>a.status==='Late').length || 0}
                                </Typography>
                              </Grid>
                            </Grid>
                          )}

                          {/* PROPERTY LINK PROFILE */}
                          {activeRecordType === 'properties' && (
                            <Grid container spacing={2}>
                              <Grid item xs={12}>
                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Location and Parameters:</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>
                                  {activeRecord.location} • Type: {activeRecord.propertyType} • Area: {activeRecord.size} Sq.Ft.
                                </Typography>

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Property View Count / Customer Visits ({connections.viewsCount || 0}):</Typography>
                                {connections.viewsCount === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8', mb: 1.5 }}>Never shown to any customer</Typography>
                                ) : (
                                  <Box sx={{ mb: 1.5 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#2563EB' }}>
                                      Views count: {connections.viewsCount} Customers
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                                      {connections.viewedBy.map((c, i) => (
                                        <Chip key={i} label={c?.name || 'Visitor'} size="small" />
                                      ))}
                                    </Box>
                                  </Box>
                                )}

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Sales Booking status:</Typography>
                                {connections.sales?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#22C55E', fontWeight: 600 }}>Available for Booking</Typography>
                                ) : (
                                  connections.sales.map(sa => (
                                    <Paper key={sa.id} sx={{ p: 1, mt: 0.5, backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#EF4444' }}>Sold out Deal</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Sold Price: ₹{sa.salePrice?.toLocaleString('en-IN')} • Date: {sa.agreementDate}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                            </Grid>
                          )}

                          {/* DEALER LINK PROFILE */}
                          {activeRecordType === 'dealers' && (
                            <Grid container spacing={2}>
                              <Grid item xs={12}>
                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Firm Name & Person Name:</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>
                                  {activeRecord.firm_name} ({activeRecord.person_name})
                                </Typography>

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Associated Properties & Inventory Listings ({connections.properties?.length || 0}):</Typography>
                                {connections.properties?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8', mb: 1.5 }}>None</Typography>
                                ) : (
                                  connections.properties.map(p => (
                                    <Paper key={p.id} sx={{ p: 1, mb: 1, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#2563EB' }}>{p.id}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Type: {p.propertyType || p.r_c_i} • Price: ₹{Number(p.demand || 0).toLocaleString('en-IN')}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                            </Grid>
                          )}

                          {/* LEADS, FOLLOW-UPS, QUERIES LINK PROFILE */}
                          {['leads', 'follow_ups', 'queries'].includes(activeRecordType) && (
                            <Grid container spacing={2}>
                              <Grid item xs={12}>
                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Pitched Properties & Details ({connections.pitches?.length || 0}):</Typography>
                                {connections.pitches?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8', mb: 1.5 }}>No pitches logged yet</Typography>
                                ) : (
                                  connections.pitches.map(p => (
                                    <Paper key={p.id} sx={{ p: 1, mb: 1, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#2563EB' }}>Property: {p.propertyId}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Pitched on: {p.pitchDate} • Offered: ₹{Number(p.quotedPrice || 0).toLocaleString('en-IN')}</Typography>
                                    </Paper>
                                  ))
                                )}

                                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Site Visits & Showings ({connections.site_visits?.length || 0}):</Typography>
                                {connections.site_visits?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No site visits registered</Typography>
                                ) : (
                                  connections.site_visits.map((sv, idx) => (
                                    <Paper key={idx} sx={{ p: 1, mb: 1, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>Property: {sv.propertyId}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Date: {sv.date} • Outcome: {sv.result}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                            </Grid>
                          )}
                        </Box>
                      )}

                      {/* Remarks List tab */}
                      {activeTab === 1 && (
                        <Box>
                          {connections.remarks?.length === 0 ? (
                            <Typography variant="body2" sx={{ color: '#94A3B8' }}>No remarks written</Typography>
                          ) : (
                            connections.remarks.map((rem, i) => (
                              <Box key={rem.id || i} sx={{ mb: 1.5, pb: 1.5, borderBottom: '1px solid #F1F5F9' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A' }}>{rem.employeeName}</Typography>
                                  <Typography variant="caption" sx={{ color: '#94A3B8' }}>{rem.dateTime}</Typography>
                                </Box>
                                <Typography variant="body2" sx={{ fontStyle: 'italic', color: '#4B5563' }}>
                                  "{rem.comment}"
                                </Typography>
                              </Box>
                            ))
                          )}
                        </Box>
                      )}

                      {/* Documents Tab */}
                      {activeTab === 2 && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {connections.documents?.length === 0 ? (
                            <Typography variant="body2" sx={{ color: '#94A3B8' }}>No documents uploaded</Typography>
                          ) : (
                            connections.documents.map((doc, i) => (
                              <Paper key={doc.id || i} sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Icons.FileText size={20} color="#2563EB" />
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{doc.name}</Typography>
                                    <Typography variant="caption" sx={{ color: '#94A3B8' }}>Uploaded: {doc.dateAdded} • By: {doc.uploadedBy}</Typography>
                                  </Box>
                                </Box>
                                <Chip label="Download" size="small" component="a" href={doc.fileUrl} download clickable sx={{ borderRadius: '4px' }} />
                              </Paper>
                            ))
                          )}
                        </Box>
                      )}
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="subtitle2" sx={{ color: '#0F172A', fontWeight: 700 }}>Record details overview:</Typography>
                    <Grid container spacing={1}>
                      {Object.keys(activeRecord).map(key => {
                        if (typeof activeRecord[key] === 'object') return null;
                        return (
                          <Grid item xs={6} key={key}>
                            <Typography variant="caption" sx={{ textTransform: 'uppercase', color: '#64748B', display: 'block' }}>{key}</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{String(activeRecord[key])}</Typography>
                          </Grid>
                        );
                      })}
                    </Grid>
                  </Box>
                )}
              </Grid>
            )}
          </Grid>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GlobalSearch;
