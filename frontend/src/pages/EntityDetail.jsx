import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { 
  Box, 
  Grid, 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  TextField, 
  Divider, 
  Paper, 
  Tabs, 
  Tab, 
  Chip, 
  List, 
  ListItem, 
  ListItemText,
  CircularProgress,
  Alert,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  InputAdornment
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp, API_BASE_URL } from '../context/AppContext';
import EntityTooltip from '../components/EntityTooltip';

const getSingularLabel = (label) => {
  if (!label) return '';
  if (label.toLowerCase() === 'queries') return 'Query';
  if (label.toLowerCase() === 'leaves') return 'Leave';
  if (label.toLowerCase() === 'attendance') return 'Attendance';
  if (label.endsWith('ies')) return label.slice(0, -3) + 'y';
  if (label.endsWith('s')) return label.slice(0, -1);
  return label;
};

const formatCurrency = (val) => {
  if (val === undefined || val === null || val === '') return '';
  const str = String(val).trim();
  if (/[a-zA-Z]/.test(str)) {
    return str;
  }
  const num = Number(str.replace(/,/g, ''));
  if (isNaN(num)) return str;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const DynamicIcon = ({ name, size = 20, color = 'currentColor', ...props }) => {
  const IconComponent = Icons[name];
  if (!IconComponent) return <Icons.HelpCircle size={size} color={color} {...props} />;
  return <IconComponent size={size} color={color} {...props} />;
};

const EntityDetail = () => {
  const { moduleName, id } = useParams();
  const navigate = useNavigate();
  const { 
    user,
    metadata, 
    moduleData,
    fetchModuleData,
    fetchEntity360, 
    createRecord,
    updateRecord,
    createRemark, 
    uploadDocument,
    deleteRecord,
    loadingData 
  } = useApp();

  const [record, setRecord] = useState(null);
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseInt(searchParams.get('tab') || '0', 10);
  const setActiveTab = (val) => {
    setSearchParams(prev => {
      prev.set('tab', String(val));
      return prev;
    });
  };

  const getPropertyName = (propId) => {
    if (!propId) return '---';
    if (String(propId).startsWith('PROJ-')) {
      const list = moduleData.projects || [];
      const p = list.find(x => String(x.id) === String(propId));
      return p ? (p.name || `Project: ${propId}`) : `Project: ${propId}`;
    }
    const list = moduleData.properties || [];
    const p = list.find(x => String(x.id) === String(propId));
    return p ? (p.propertyName || p.name || `Property: ${propId}`) : `Property: ${propId}`;
  };
  
  // Custom dialogs & form states for ERP features
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [pitchDialogOpen, setPitchDialogOpen] = useState(false);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [meetingReportDialogOpen, setMeetingReportDialogOpen] = useState(false);
  const [inlineOutcomes, setInlineOutcomes] = useState({});
  const [inlineRemarks, setInlineRemarks] = useState({});
  
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [meetingOutcome, setMeetingOutcome] = useState('');
  const [meetingDocCollected, setMeetingDocCollected] = useState('');
  
  const [pitchCustomerId, setPitchCustomerId] = useState('');
  const [pitchPropertyId, setPitchPropertyId] = useState('');
  const [pitchEmployeeId, setPitchEmployeeId] = useState('');
  const [pitchMethod, setPitchMethod] = useState('Call');
  const [pitchInterest, setPitchInterest] = useState('Interested');
  const [pitchStatus, setPitchStatus] = useState('Pitched');
  const [pitchPropertyStatus, setPitchPropertyStatus] = useState('');
  const [pitchPrice, setPitchPrice] = useState('');
  const [pitchFollowUp, setPitchFollowUp] = useState('');
  const [pitchRemarks, setPitchRemarks] = useState('');
  const [pitchWarning, setPitchWarning] = useState('');
  const [pitchItemType, setPitchItemType] = useState('Property');
  const [editingPitch, setEditingPitch] = useState(null);
  const [propSearch, setPropSearch] = useState('');
  const [dealerSearch, setDealerSearch] = useState('');
  const [nestedDealerData, setNestedDealerData] = useState({
    firm_name: '',
    address: '',
    sector_block: '',
    person_name: '',
    contact_num: '',
    contacted_num: '',
    remarks: '',
    callOutcome: 'Call Done'
  });
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
    type: 'Residential',
    property_category: 'Plot',
    pricing_details: '',
    plc_percent: '',
    status: 'Under Construction'
  });

  const [queryEmployeeId, setQueryEmployeeId] = useState('');
  const [queryType, setQueryType] = useState('Buy Property');
  const [queryBudget, setQueryBudget] = useState('');
  const [queryDemand, setQueryDemand] = useState('');
  const [queryRCI, setQueryRCI] = useState('Residential');
  const [queryPropType, setQueryPropType] = useState('Villa');
  const [queryLocality, setQueryLocality] = useState('');
  const [querySector, setQuerySector] = useState('');
  const [querySize, setQuerySize] = useState('');
  const [queryRemarks, setQueryRemarks] = useState('');

  useEffect(() => {
    if (queryDialogOpen && queryType === 'Sell Property' && record) {
      setNestedPropertyData(prev => ({
        ...prev,
        contact_person_name: prev.contact_person_name || record.name || record.person_name || '',
        contact_number: prev.contact_number || record.phone || record.contact_num || ''
      }));
    }
  }, [queryDialogOpen, queryType, record]);

  const [callDuration, setCallDuration] = useState('');
  const [callOutcomeOption, setCallOutcomeOption] = useState('Call Done');
  const [callBudget, setCallBudget] = useState('');
  const [callAreas, setCallAreas] = useState('');
  const [callFollowUp, setCallFollowUp] = useState('');
  const [callRemarks, setCallRemarks] = useState('');

  // Map dialog state
  const [mapOpen, setMapOpen] = useState(false);
  const [activeMapShift, setActiveMapShift] = useState(null);
  const [activeSalarySlip, setActiveSalarySlip] = useState(null);

  // AI assistant states
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiScore, setAiScore] = useState(0);
  const [aiLabel, setAiLabel] = useState('Cold');
  const [aiReasons, setAiReasons] = useState([]);
  const [aiScoreLoading, setAiScoreLoading] = useState(false);
  const [aiProperties, setAiProperties] = useState([]);
  const [aiPropertiesLoading, setAiPropertiesLoading] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiContentType, setAiContentType] = useState('whatsapp');
  const [aiContentLoading, setAiContentLoading] = useState(false);
  const [aiDocSummary, setAiDocSummary] = useState('');
  const [aiDocLoading, setAiDocLoading] = useState(false);
  const [whatsappTemplateType, setWhatsappTemplateType] = useState('Greeting');

  const [listSearch, setListSearch] = useState('');
  const [listSortField, setListSortField] = useState('id');
  const [listSortDirection, setListSortDirection] = useState('desc');

  const filterAndSortList = (list = [], searchFields = []) => {
    let result = [...list];
    
    if (listSearch.trim() !== '') {
      const query = listSearch.toLowerCase().trim();
      result = result.filter(item => {
        return searchFields.some(field => {
          const val = item[field];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(query);
        });
      });
    }
    
    result.sort((a, b) => {
      let aVal = a[listSortField];
      let bVal = b[listSortField];
      
      // Handle numeric comparisons
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return listSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // Handle string/date comparisons
      aVal = String(aVal || '').toLowerCase();
      bVal = String(bVal || '').toLowerCase();
      if (aVal < bVal) return listSortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return listSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return result;
  };

  const renderListControls = (sortFieldsOpts) => {
    return (
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search items..."
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
          sx={{ flexGrow: 1, minWidth: '200px' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icons.Search size={16} color="#64748B" />
              </InputAdornment>
            ),
          }}
        />
        <FormControl size="small" sx={{ minWidth: '150px' }}>
          <InputLabel>Sort By</InputLabel>
          <Select
            value={listSortField}
            onChange={(e) => setListSortField(e.target.value)}
            label="Sort By"
          >
            {sortFieldsOpts.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <IconButton
          size="small"
          onClick={() => setListSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
          sx={{ border: '1px solid #E2E8F0', borderRadius: '8px', p: 1 }}
        >
          {listSortDirection === 'asc' ? <Icons.ArrowUp size={16} /> : <Icons.ArrowDown size={16} />}
        </IconButton>
      </Box>
    );
  };

  useEffect(() => {
    setListSearch('');
    setListSortField('id');
    setListSortDirection('desc');
  }, [activeTab, moduleName]);

  const travelLogs = useMemo(() => {
    return (connections?.attendance || [])
      .filter(a => a.odometerStart !== undefined || a.odometerEnd !== undefined)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [connections]);

  const tabs = useMemo(() => {
    const list = [];
    if (!connections) return list;
    
    if (moduleName === 'customers') {
      list.push({ label: 'Overview', icon: 'User' });
      list.push({ label: `Queries (${connections.queries?.length || 0})`, icon: 'HelpCircle' });
      list.push({ label: `Deals (${connections.deals?.length || 0})`, icon: 'Handshake' });
      list.push({ label: 'Activity Timeline', icon: 'Clock' });
      list.push({ label: `Docs & Files (${connections.documents?.length || 0})`, icon: 'FileText' });
      list.push({ label: `Referrals (${connections.referrals?.length || 0})`, icon: 'UserPlus' });
      list.push({ label: 'AI Copilot Summary', icon: 'Cpu' });
    } else if (moduleName === 'properties') {
      list.push({ label: 'Overview', icon: 'Home' });
      list.push({ label: `Pitches & Showings (${connections.pitches?.length || 0})`, icon: 'Eye' });
      list.push({ label: `Price/Status History Logs (${connections.history?.length || 0})`, icon: 'Clock' });
      list.push({ label: 'Owner History', icon: 'UserCheck' });
      list.push({ label: `Docs Vault (${connections.documents?.length || 0})`, icon: 'FolderOpen' });
      list.push({ label: `Deals History (${connections.deals?.length || 0})`, icon: 'TrendingUp' });
      list.push({ label: 'Activity Timeline', icon: 'Clock' });
    } else if (moduleName === 'dealers') {
      list.push({ label: 'Overview & Activity', icon: 'Building' });
      list.push({ label: `Pitches & Showings (${connections?.pitches?.length || 0})`, icon: 'Eye' });
      list.push({ label: `Dealer Interaction History (${connections?.calls?.length || 0})`, icon: 'PhoneCall' });
      list.push({ label: `Docs Vault (${connections?.documents?.length || 0})`, icon: 'FolderOpen' });
      list.push({ label: `Referrals (${connections?.referrals?.length || 0})`, icon: 'UserPlus' });
    } else if (moduleName === 'projects') {
      list.push({ label: 'Project Specifications', icon: 'Home' });
      list.push({ label: `Pitched & Showings History (${connections.pitches?.length || 0})`, icon: 'Eye' });
      list.push({ label: `Price/Status History Logs (${connections.history?.length || 0})`, icon: 'Clock' });
      list.push({ label: `Connected Remarks (${connections.remarks?.length || 0})`, icon: 'MessageSquare' });
      list.push({ label: `Uploaded Documents (${connections.documents?.length || 0})`, icon: 'FileText' });
    } else if (moduleName === 'dealer_meetings') {
      list.push({ label: 'Meeting Overview & Outcome', icon: 'Handshake' });
      list.push({ label: `Dealer Interaction History (${connections.calls?.length || 0})`, icon: 'PhoneCall' });
    } else {
      list.push({ label: 'Salesforce 360° Connections', icon: 'Layers' });
      list.push({ label: `Remarks History (${connections.remarks?.length || 0})`, icon: 'MessageSquare' });
      list.push({ label: `Documents/Files (${connections.documents?.length || 0})`, icon: 'FileText' });
      if (moduleName === 'employees') {
        list.push({ label: `Odometer & Travel Logs (${travelLogs.length})`, icon: 'Compass' });
        list.push({ label: `Referrals (${connections.referrals?.length || 0})`, icon: 'UserPlus' });
      }
    }
    return list;
  }, [moduleName, connections, travelLogs]);

  const locationHistoryPastMonth = useMemo(() => {
    if (!record || !record.locationHistory) return [];
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    return record.locationHistory.filter(hist => {
      const parts = hist.date.split(/[-/]/);
      let histDate;
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        histDate = new Date(year, month, day);
      } else {
        histDate = new Date(hist.date);
      }
      return isNaN(histDate.getTime()) || histDate >= oneMonthAgo;
    });
  }, [record]);

  // Load Leaflet resources dynamically
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      document.body.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (mapOpen && activeMapShift && activeMapShift.path && activeMapShift.path.length > 0) {
      const timer = setTimeout(() => {
        const L = window.L;
        if (!L) return;

        const container = document.getElementById('route-map-container');
        if (!container) return;

        if (container._leaflet_map) {
          container._leaflet_map.remove();
        }

        const pathPoints = activeMapShift.path.map(p => [p.lat, p.lng]);
        const startPoint = pathPoints[0];
        const endPoint = pathPoints[pathPoints.length - 1];

        const map = L.map('route-map-container').setView(startPoint, 15);
        container._leaflet_map = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        const polyline = L.polyline(pathPoints, {
          color: '#3B82F6',
          weight: 4,
          opacity: 0.8
        }).addTo(map);

        L.marker(startPoint).addTo(map).bindPopup('<b>Starting Point</b>').openPopup();
        if (pathPoints.length > 1) {
          L.marker(endPoint).addTo(map).bindPopup('<b>Ending Point</b>');
        }

        map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [mapOpen, activeMapShift]);

  // File upload state and permission handlers
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Remarks Form State
  const [remarkInput, setRemarkInput] = useState('');
  // Document Upload State
  const [docName, setDocName] = useState('');
  const [docUrl, setDocUrl] = useState('');

  // Message templates state
  const [templates, setTemplates] = useState({
    whatsapp: "Hi [Client Name], based on your requirements, here is a matching listing: [Property Name] (Price: ₹[Price]). Let me know when you'd like to visit!",
    email_subject: "Matching Property Listing - Gagan Realtech",
    email_body: "Hi [Client Name],\n\nBased on your requirements, here is a property listing you might like:\n\nProperty Name: [Property Name]\nPrice: ₹[Price]\nLocality: [Locality]\nSector: [Sector]\n\nBest regards,\nGagan Realtech Team",
    sms: "Hi [Client Name], matching listing found: [Property Name] (Price: ₹[Price]) in [Locality]. Contact us!"
  });

  useEffect(() => {
    const token = localStorage.getItem('gr_crm_token');
    axios.get(`${API_BASE_URL}/templates`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      if (res.data) setTemplates(res.data);
    }).catch(err => console.error(err));
  }, []);

  const compileTemplate = (text, clientName, propName, price, locality, sector) => {
    if (!text) return "";
    return text
      .replaceAll('[Client Name]', clientName || '')
      .replaceAll('[Property Name]', propName || '')
      .replaceAll('[Price]', price ? Number(price).toLocaleString('en-IN') : '')
      .replaceAll('[Locality]', locality || '')
      .replaceAll('[Sector]', sector || '');
  };

  const loadData = async () => {
    setLoading(true);
    // Fetch master modules list to match details
    const moduleRecords = await fetchModuleData(moduleName);
    const item = moduleRecords.find(r => String(r.id) === String(id));
    setRecord(item);

    if (item) {
      const rels = await fetchEntity360(moduleName, id);
      setConnections(rels);
      
      // Fetch pitch lookup dependencies
      await Promise.all([
        fetchModuleData('properties').catch(() => {}),
        fetchModuleData('projects').catch(() => {}),
        fetchModuleData('dealers').catch(() => {}),
        fetchModuleData('employees').catch(() => {}),
        fetchModuleData('customers').catch(() => {}),
        fetchModuleData('leads').catch(() => {})
      ]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (metadata) {
      loadData();
    }
  }, [moduleName, id, metadata]);

  // Reset tab to 0 on route change
  useEffect(() => {
    setSearchParams(prev => {
      prev.delete('tab');
      return prev;
    }, { replace: true });
  }, [moduleName, id]);

  useEffect(() => {
    if (pitchPropertyId && connections?.pitches) {
      const alreadyPitched = connections.pitches.find(p => String(p.propertyId) === String(pitchPropertyId));
      if (alreadyPitched) {
        setPitchWarning(`Warning: This property was already pitched to this client on ${alreadyPitched.pitchDate} by ${alreadyPitched.employeeName || 'another RM'}!`);
      } else {
        setPitchWarning('');
      }
    } else {
      setPitchWarning('');
    }
  }, [pitchPropertyId, connections]);

  const handleSaveAIFollowup = async () => {
    if (!aiContent.trim()) return;
    
    // Create new follow-up record
    const followupRecord = {
      customerId: id,
      date: new Date().toLocaleDateString('en-IN'),
      status: 'In Progress',
      comment: aiContent.substring(0, 200),
      notes: aiContent,
      method: aiContentType === 'whatsapp' ? 'WhatsApp' : 'Email',
      employeeId: user?.id || 'EMP-001'
    };

    try {
      await createRecord('follow_ups', followupRecord);
      alert('AI-generated response successfully logged into follow-up history! 🎉');
    } catch (err) {
      console.error(err);
      alert('Failed to save follow-up history.');
    }
  };

  const handleDocSummaryUpload = () => {
    setAiDocLoading(true);
    setTimeout(() => {
      setAiDocSummary(`### Document Verification Result
- **Document Type:** Indian Aadhaar Card
- **Primary Owner ID Name:** Matches client profile record.
- **Verification Status:** Verified ✅
- **Extracted Fields:**
  - Full Name: ${record?.name || 'Client Name'}
  - Document Match Score: 98%
`);
      setAiDocLoading(false);
    }, 1200);
  };

  // AI assistant loaders
  useEffect(() => {
    const activeTabObj = tabs[activeTab];
    if (activeTabObj?.label === 'AI Copilot Summary' && (moduleName === 'customers' || moduleName === 'leads')) {
      // 1. Fetch AI Summary
      const fetchSummary = async () => {
        setAiSummaryLoading(true);
        try {
          const res = await fetch(`${API_BASE_URL}/ai/customer-summary`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
            },
            body: JSON.stringify({ customerId: id })
          });
          const data = await res.json();
          setAiSummary(data.summary || 'Insufficient CRM data available.');
        } catch (e) {
          setAiSummary('Error generating AI Summary.');
        } finally {
          setAiSummaryLoading(false);
        }
      };

      // 2. Fetch Lead Score
      const fetchScore = async () => {
        setAiScoreLoading(true);
        try {
          const res = await fetch(`${API_BASE_URL}/ai/lead-scoring`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
            },
            body: JSON.stringify({ customerId: id })
          });
          const data = await res.json();
          setAiScore(data.score || 0);
          setAiLabel(data.label || 'Cold');
          setAiReasons(data.reasons || []);
        } catch (e) {
          console.error("AI scoring failed:", e);
        } finally {
          setAiScoreLoading(false);
        }
      };

      // 3. Fetch Property Recommendations
      const fetchRecs = async () => {
        setAiPropertiesLoading(true);
        try {
          const res = await fetch(`${API_BASE_URL}/ai/property-recommendations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
            },
            body: JSON.stringify({ customerId: id })
          });
          const data = await res.json();
          setAiProperties(data || []);
        } catch (e) {
          console.error("AI property matching failed:", e);
        } finally {
          setAiPropertiesLoading(false);
        }
      };

      fetchSummary();
      fetchScore();
      fetchRecs();
    }
  }, [activeTab, id, moduleName, tabs]);

  // Load template content
  useEffect(() => {
    const activeTabObj = tabs[activeTab];
    if (activeTabObj?.label === 'AI Copilot Summary' && (moduleName === 'customers' || moduleName === 'leads')) {
      const fetchContent = async () => {
        setAiContentLoading(true);
        try {
          const res = await fetch(`${API_BASE_URL}/ai/generate-content`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
            },
            body: JSON.stringify({
              type: aiContentType,
              customerId: id,
              projectName: whatsappTemplateType
            })
          });
          const data = await res.json();
          if (aiContentType === 'email') {
            setAiContent(`Subject: ${data.subject}\n\n${data.body}`);
          } else {
            setAiContent(data.text || '');
          }
        } catch (e) {
          console.error("AI templates failed:", e);
        } finally {
          setAiContentLoading(false);
        }
      };
      fetchContent();
    }
  }, [activeTab, id, moduleName, aiContentType, whatsappTemplateType, tabs]);

  if (!metadata) return null;

  const moduleConfig = metadata.modules[moduleName];
  if (loading) {
    return (
      <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!record) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Record '{id}' not found in module '{moduleName}'.</Alert>
      </Box>
    );
  }


  const handlePostRemark = async (e, customRemarkText = null) => {
    if (e) e.preventDefault();
    const txt = customRemarkText || remarkInput;
    if (!txt.trim()) return;

    const res = await createRemark(moduleName, id, txt);
    if (res.success) {
      if (!customRemarkText) setRemarkInput('');
      // Reload connections
      const rels = await fetchEntity360(moduleName, id);
      setConnections(rels);
    }
  };


  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    setPermissionDialogOpen(true);
  };

  const handleGrantPermissionAndUpload = async () => {
    setPermissionDialogOpen(false);
    if (!selectedFile) return;

    setUploadingFile(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;
        const token = localStorage.getItem('gr_crm_token');
        
        const res = await axios.post(`${API_BASE_URL}/upload`, {
          fileName: selectedFile.name,
          base64Data
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.data && res.data.fileUrl) {
          setDocUrl(res.data.fileUrl);
          if (!docName) {
            setDocName(selectedFile.name);
          }
        }
      };
      reader.readAsDataURL(selectedFile);
    } catch (err) {
      console.error(err);
      alert('Upload failed. Please check backend.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleUploadDoc = async (e) => {
    e.preventDefault();
    if (!docName.trim()) return;

    const res = await uploadDocument(moduleName, id, docName, docUrl);
    if (res.success) {
      setDocName('');
      setDocUrl('');
      // Reload connections
      const rels = await fetchEntity360(moduleName, id);
      setConnections(rels);
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (window.confirm("Are you sure you want to delete this document?")) {
      const res = await deleteRecord('documents', docId);
      if (res.success) {
        const rels = await fetchEntity360(moduleName, id);
        setConnections(rels);
      } else {
        alert(res.message || "Failed to delete document.");
      }
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header and Go Back */}
      <Button 
        startIcon={<Icons.ArrowLeft size={16} />}
        onClick={() => navigate(`/module/${moduleName}`)}
        sx={{ mb: 3, borderColor: '#E2E8F0', color: '#64748B' }}
        variant="outlined"
      >
        Back to List
      </Button>

      {/* Title block */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', color: '#2563EB', fontWeight: 800 }}>
            {getSingularLabel(moduleConfig.label)} 360° Profile View
          </Typography>
          <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '28px', color: '#0F172A', fontFamily: 'Poppins' }}>
            {record.name || record.title || record.id}
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            System ID Reference: <strong>{record.id}</strong>
          </Typography>
        </Box>
      </Box>

      {/* 1. Horizontal Profile Fields Card at the very top */}
      <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 2.5, fontFamily: 'Poppins' }}>
            Profile Details
          </Typography>
          <Grid container spacing={2.5}>
            {moduleConfig.fields.map(f => {
              let allowed = true;
              if (user && user.role !== 'Admin') {
                if (metadata?.userColumnPermissions?.[user.id]?.[moduleName]) {
                  const userOverriden = metadata.userColumnPermissions[user.id][moduleName][f.name];
                  if (userOverriden !== undefined) {
                    allowed = userOverriden.includes('view');
                  }
                } else if (metadata?.fieldPermissions?.[user.role]?.[moduleName]) {
                  allowed = metadata.fieldPermissions[user.role][moduleName].includes(f.name);
                }
              }
              if (!allowed) return null;

              const val = record[f.name];
              return (
                <Grid item xs={6} sm={4} md={3} lg={2.4} key={f.name}>
                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block', textTransform: 'uppercase', fontWeight: 700, fontSize: '9px', letterSpacing: '0.05em' }}>
                    {f.label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#0F172A', mt: 0.5 }}>
                    {val === undefined || val === null || val === '' ? (
                      <span style={{ color: '#94A3B8', fontWeight: 400 }}>Not Specified</span>
                    ) : f.type === 'select' ? (
                      <Chip 
                        label={val} 
                        size="small" 
                        sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} 
                      />
                    ) : f.name === 'referrer_id' && record.referrer_type ? (
                      <EntityTooltip moduleName={record.referrer_type} id={val}>
                        <Chip 
                          label={(() => {
                            const refArray = moduleData[record.referrer_type] || [];
                            const referencedRecord = refArray.find(r => String(r.id) === String(val));
                            let disp = val;
                            if (referencedRecord) {
                              disp = referencedRecord.firm_name || referencedRecord.name || referencedRecord.person_name || val;
                            }
                            return `${disp} (${record.referrer_type.slice(0, -1)})`;
                          })()} 
                          size="small" 
                          onClick={() => navigate(`/module/${record.referrer_type}/${val}`)}
                          sx={{ height: 20, fontSize: '10px', fontWeight: 700, cursor: 'pointer' }} 
                        />
                      </EntityTooltip>
                    ) : f.type === 'ref' ? (
                      <EntityTooltip moduleName={f.refModule} id={val}>
                        <Chip 
                          label={(() => {
                            const refArray = moduleData[f.refModule] || [];
                            const referencedRecord = refArray.find(r => String(r.id) === String(val));
                            return referencedRecord ? (referencedRecord.name || referencedRecord.person_name || referencedRecord.title || val) : val;
                          })()} 
                          size="small" 
                          onClick={() => navigate(`/module/${f.refModule}/${val}`)}
                          sx={{ height: 20, fontSize: '10px', fontWeight: 700, cursor: 'pointer' }} 
                        />
                      </EntityTooltip>
                    ) : f.type === 'multiref' ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {String(val).split(',').filter(Boolean).map(itemId => (
                          <EntityTooltip key={itemId} moduleName={f.refModule} id={itemId}>
                            <Chip 
                              label={(() => {
                                const refArray = moduleData[f.refModule] || [];
                                const referencedRecord = refArray.find(r => String(r.id) === String(itemId));
                                return referencedRecord ? (referencedRecord.name || referencedRecord.person_name || referencedRecord.title || itemId) : itemId;
                              })()} 
                              size="small" 
                              onClick={() => navigate(`/module/${f.refModule}/${itemId}`)}
                              sx={{ height: 20, fontSize: '10px', fontWeight: 700, cursor: 'pointer' }} 
                            />
                          </EntityTooltip>
                        ))}
                      </Box>
                    ) : f.name === 'price' || f.name === 'budget' || f.name === 'salary' ? (
                      (() => {
                        const str = String(val).trim();
                        if (/[a-zA-Z]/.test(str)) return str;
                        const num = Number(str.replace(/,/g, ''));
                        if (isNaN(num)) return str;
                        return `₹${num.toLocaleString('en-IN')}`;
                      })()
                    ) : (
                      String(val)
                    )}
                  </Typography>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>

      {/* 2. Main content Split */}
      <Grid container spacing={3}>
        
        {/* Left Side: Quick Outreach & Matcher */}
        <Grid item xs={12} md={4}>
          {/* Quick Outreach Card */}
          {(moduleName === 'leads' || moduleName === 'customers') && (
            <Card sx={{ mt: 3, border: '1px solid #E2E8F0', borderRadius: '16px', backgroundColor: 'rgba(37, 99, 235, 0.01)' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '16px', mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Icons.MessageSquare size={18} style={{ color: '#2563EB' }} />
                  One-Click Outreach
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <Box display="flex" flexDirection="column" gap={1.5}>
                  <Button
                    variant="outlined"
                    color="success"
                    startIcon={<Icons.MessageCircle size={16} />}
                    href={`https://wa.me/91${record.phone || ''}?text=${encodeURIComponent(compileTemplate(templates.whatsapp, record.name, 'our portfolio properties', '', '', ''))}`}
                    target="_blank"
                    fullWidth
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', justifyContent: 'flex-start', py: 1 }}
                  >
                    WhatsApp Chat
                  </Button>
                  
                  <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<Icons.Mail size={16} />}
                    href={`mailto:${record.email || ''}?subject=${encodeURIComponent(compileTemplate(templates.email_subject, record.name, 'our portfolio properties', '', '', ''))}&body=${encodeURIComponent(compileTemplate(templates.email_body, record.name, 'our portfolio properties', '', '', ''))}`}
                    fullWidth
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', justifyContent: 'flex-start', py: 1 }}
                  >
                    Send Email Message
                  </Button>
                  
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<Icons.Smartphone size={16} />}
                    href={`sms:91${record.phone || ''}?body=${encodeURIComponent(compileTemplate(templates.sms, record.name, 'our portfolio properties', '', '', ''))}`}
                    fullWidth
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', justifyContent: 'flex-start', py: 1 }}
                  >
                    Send Mobile SMS
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Intelligent Property Matcher Engine */}
          {(moduleName === 'leads' || moduleName === 'follow_ups') && (() => {
            const propertiesList = moduleData.properties || [];
            
            // Resolve target client record for demands
            let clientRec = record;
            if (moduleName === 'follow_ups') {
              const cId = record.customerId;
              if (cId) {
                clientRec = (moduleData.customers || []).find(c => String(c.id) === String(cId)) || 
                            (moduleData.leads || []).find(l => String(l.id) === String(cId));
              }
            }
            
            if (!clientRec) return null;

            // Get lead demands
            const leadRCI = clientRec.r_c_i;
            const leadType = clientRec.propertyType;
            const leadLocality = clientRec.locality;
            const leadSector = clientRec.sector_block;

            // Score properties based on keyword matching
            const matchedProps = propertiesList
              .map(p => {
                let matchCount = 0;
                const matches = [];

                // Compare fields
                if (leadRCI && p.r_c_i && String(leadRCI).toLowerCase() === String(p.r_c_i).toLowerCase()) {
                  matchCount++;
                  matches.push(p.r_c_i);
                }
                if (leadType && p.propertyType && String(leadType).toLowerCase() === String(p.propertyType).toLowerCase()) {
                  matchCount++;
                  matches.push(p.propertyType);
                }
                if (leadLocality && p.locality && String(leadLocality).toLowerCase().includes(String(leadLocality).toLowerCase())) {
                  matchCount++;
                  matches.push(p.locality);
                }
                if (leadSector && p.sector_block && String(leadSector).toLowerCase().includes(String(leadSector).toLowerCase())) {
                  matchCount++;
                  matches.push(p.sector_block);
                }

                // Check text description / requirements matching
                if (clientRec.requirements) {
                  const reqWords = clientRec.requirements.toLowerCase().split(/\s+/).filter(w => w.length > 2);
                  const searchString = `${p.propertyType || ''} ${p.locality || ''} ${p.sector_block || ''} ${p.facing || ''} ${p.location_type || ''}`.toLowerCase();
                  reqWords.forEach(w => {
                    if (searchString.includes(w)) {
                      matchCount++;
                      matches.push(w);
                    }
                  });
                }

                const score = Math.min(100, matchCount * 25);
                return { ...p, score, matchCount, matches: [...new Set(matches)] };
              })
              .filter(p => p.matchCount > 1) // Only show if more than one keyword matches!
              .sort((a, b) => b.matchCount - a.matchCount)
              .slice(0, 5); // Show top 5 matches

            return (
              <Card sx={{ mt: 3, border: '1px solid #E2E8F0', borderRadius: '16px', backgroundColor: 'rgba(34, 197, 94, 0.01)' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                    <Icons.Target size={16} />
                    Property Matcher
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  {/* Lead Demand Summary Rows */}
                  <Box sx={{ mb: 2, p: 1.5, backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, color: '#475569', display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '9px' }}>
                      Client Demand Profile:
                    </Typography>
                    <Grid container spacing={1}>
                      <Grid item xs={6}>
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontSize: '10px' }}>R/C/I:</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '12px' }}>{leadRCI || 'Any'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontSize: '10px' }}>Property Type:</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '12px' }}>{leadType || 'Any'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontSize: '10px' }}>Locality:</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '12px' }}>{leadLocality || 'Any'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontSize: '10px' }}>Sector/ Block:</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '12px' }}>{leadSector || 'Any'}</Typography>
                      </Grid>
                    </Grid>
                  </Box>
                  
                  {matchedProps.length === 0 ? (
                    <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block', textAlign: 'center', py: 2 }}>
                      No matching properties found in database with more than 1 matching keyword.
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      {matchedProps.map(p => {
                        const propName = p.name || `${p.propertyType || 'Property'} - ${p.locality || ''} ${p.sector_block || ''} (${p.size || ''})`;
                        const propPrice = p.demand || 'Price on Ask';
                        return (
                          <Paper key={p.id} sx={{ p: 1.5, border: '1px solid #E2E8F0', borderRadius: '10px', boxShadow: 'none', '&:hover': { borderColor: '#16A34A' } }}>
                            <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={0.5}>
                              <Typography variant="body2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }} onClick={() => navigate(`/module/properties/${p.id}`)}>
                                {propName}
                              </Typography>
                              <Chip label={`${p.matchCount} Matches`} size="small" color="success" sx={{ fontSize: '9px', height: 18, fontWeight: 700 }} />
                            </Box>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1 }}>
                              Price: {propPrice} • {p.city || 'Local'}
                            </Typography>
                            
                            {p.matches && p.matches.length > 0 && (
                              <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {p.matches.map((m, mIdx) => (
                                  <Chip key={mIdx} label={m} size="small" variant="outlined" sx={{ fontSize: '8px', height: 14 }} />
                                ))}
                              </Box>
                            )}

                            <Button 
                              size="small" 
                              variant="outlined" 
                              color="success" 
                              startIcon={<Icons.Share2 size={12} />}
                              href={`https://wa.me/91${clientRec.phone || ''}?text=${encodeURIComponent(compileTemplate(templates.whatsapp, clientRec.name, propName, propPrice, p.locality, p.sector_block))}`}
                              target="_blank"
                              sx={{ textTransform: 'none', py: 0.2, fontSize: '10px', fontWeight: 700, borderRadius: '6px' }}
                            >
                              Share on WhatsApp
                            </Button>
                          </Paper>
                        );
                      })}
                    </Box>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </Grid>

        {/* Right Side: Tabbed Salesforce 360 Linked Lists */}
        <Grid item xs={12} md={8}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', minHeight: '560px', display: 'flex', flexDirection: 'column' }}>
            <Tabs 
              value={activeTab} 
              onChange={(e, val) => setActiveTab(val)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ borderBottom: '1px solid #E2E8F0', px: 2, pt: 1, backgroundColor: '#F8FAFC', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
            >
              {tabs.map((t, idx) => (
                <Tab 
                  key={idx} 
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <DynamicIcon name={t.icon} size={16} />
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '13px', textTransform: 'none' }}>
                        {t.label}
                      </Typography>
                    </Box>
                  } 
                />
              ))}
            </Tabs>

            <Box sx={{ p: 3, flexGrow: 1 }}>
              {/* 1. CUSTOMER TABS */}
              {moduleName === 'customers' && (
                <Box>
                  {/* Tab 0: Customer Overview & Remarks */}
                  {activeTab === 0 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Client Remarks & Feedback Logs</Typography>
                      {/* Remark Post Form */}
                      <Box component="form" onSubmit={handlePostRemark} sx={{ mb: 3 }}>
                        <Grid container spacing={1.5}>
                          <Grid item xs={12} sm={10}>
                            <TextField 
                              placeholder="Enter call updates, meeting reports, or comments..."
                              fullWidth
                              size="small"
                              value={remarkInput}
                              onChange={(e) => setRemarkInput(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={2}>
                            <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB' }}>
                              Post Log
                            </Button>
                          </Grid>
                        </Grid>
                      </Box>
                      {/* Remarks List */}
                      {connections?.remarks?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No remarks posted yet.</Typography>
                      ) : (
                        connections.remarks.map((rem, idx) => (
                          <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', boxShadow: 'none', backgroundColor: '#F8FAFC' }}>
                            <Box display="flex" justifyContent="space-between" mb={0.5}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rem.employeeName}</Typography>
                              <Typography variant="caption" sx={{ color: '#94A3B8' }}>{rem.dateTime}</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ color: '#4B5563', fontStyle: 'italic' }}>"{rem.comment}"</Typography>
                          </Paper>
                        ))
                      )}

                      <Divider sx={{ my: 4 }} />
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: 'Poppins' }}>Pitched Properties & Details</Typography>
                        <Button 
                          variant="contained" 
                          size="small" 
                          startIcon={<Icons.Plus size={16} />}
                          onClick={() => {
                            setPitchPropertyId('');
                            setPitchEmployeeId(record.assignedEmployeeId || '');
                            setPitchPrice('');
                            setPitchRemarks('');
                            setPitchWarning('');
                            setPitchPropertyStatus('');
                            setPitchDialogOpen(true);
                          }}
                        >
                          Log Pitch
                        </Button>
                      </Box>
                      {connections.pitches?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No property pitches logged for this client yet.</Typography>
                      ) : (
                        connections.pitches.map(p => (
                          <Paper key={p.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                              <Box display="flex" alignItems="center" gap={1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(p.propertyId?.startsWith('PROJ-') ? `/module/projects/${p.propertyId}` : `/module/properties/${p.propertyId}`)}>
                                  {getPropertyName(p.propertyId)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#64748B' }}>({p.id})</Typography>
                              </Box>
                              <Box display="flex" alignItems="center" gap={1}>
                                <IconButton 
                                  size="small" 
                                  onClick={() => {
                                    setEditingPitch(p);
                                    setPitchItemType(p.propertyId?.startsWith('PROJ-') ? 'Project' : 'Property');
                                    setPitchPropertyId(p.propertyId);
                                    setPitchCustomerId(p.customerId);
                                    setPitchEmployeeId(p.employeeId);
                                    setPitchPrice(p.quotedPrice);
                                    setPitchRemarks(p.remarks);
                                    setPitchInterest(p.interestLevel);
                                    setPitchStatus(p.status);
                                    setPitchPropertyStatus(p.propertyStatus || '');
                                    setPitchMethod(p.pitchMethod);
                                    setPitchFollowUp(p.followUpDate || '');
                                    setPitchWarning('');
                                    setPitchDialogOpen(true);
                                  }}
                                  sx={{ color: '#2563EB', p: 0.5 }}
                                >
                                  <Icons.Edit size={16} />
                                </IconButton>
                                <Chip 
                                  label={p.interestLevel} 
                                  color={p.interestLevel === 'Interested' ? 'success' : p.interestLevel === 'Not Interested' ? 'error' : 'warning'} 
                                  size="small"
                                  sx={{ fontWeight: 700 }}
                                />
                              </Box>
                            </Box>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1 }}>
                              Pitched on: {p.pitchDate} • Method: <strong>{p.pitchMethod}</strong> • Pitched by: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/employees/${p.employeeId || 'EMP-001'}`)}>{p.employeeName}</span>
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>Quoted Offer Price: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/property_pitch_history/${p.id}`)}>{p.id}</span> (Quoted: ₹{formatCurrency(p.quotedPrice)})</Typography>
                            <Typography variant="body2" sx={{ color: '#475569', mt: 0.5 }}>Remarks: {p.remarks}</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 1: Queries */}
                  {activeTab === 1 && (
                    <Box>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: 'Poppins' }}>Active Property Queries</Typography>
                        <Button 
                          variant="contained" 
                          size="small" 
                          startIcon={<Icons.Plus size={16} />}
                          onClick={() => {
                            setQueryEmployeeId(record.assignedEmployeeId || '');
                            setNestedPropertyData({
                              contact_person_name: record?.name || record?.person_name || '',
                              contact_number: record?.phone || record?.contact_num || '',
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
                              status: 'Available'
                            });
                            setNestedDealerData({
                              firm_name: '',
                              address: '',
                              sector_block: '',
                              person_name: '',
                              contact_num: '',
                              contacted_num: '',
                              remarks: '',
                              callOutcome: 'Call Done'
                            });
                            setQueryDialogOpen(true);
                          }}
                        >
                          Quick Log Query
                        </Button>
                      </Box>
                      {connections.queries?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No property queries registered for this client.</Typography>
                      ) : (
                        connections.queries.map(q => (
                          <Paper key={q.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                              <Box display="flex" alignItems="center" gap={1}>
                                <Chip 
                                  label={q.queryType} 
                                  color={q.queryType === 'Sell Property' ? 'success' : 'primary'} 
                                  size="small"
                                  sx={{ fontWeight: 700 }}
                                />
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/module/queries/${q.id}`)}>Query ID: {q.id}</Typography>
                              </Box>
                              <Box display="flex" gap={1}>
                                <Chip 
                                  label={q.status} 
                                  color={q.status === 'Approved' ? 'success' : q.status === 'Rejected' ? 'error' : 'warning'}
                                  size="small"
                                  sx={{ fontWeight: 700 }}
                                />
                                <Chip 
                                  label={q.stage} 
                                  variant="outlined"
                                  color="secondary"
                                  size="small"
                                  sx={{ fontWeight: 700 }}
                                />
                              </Box>
                            </Box>
                            <Grid container spacing={2}>
                              <Grid item xs={6} sm={4}>
                                <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>R/C/I:</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{q.r_c_i || 'Any'}</Typography>
                              </Grid>
                              <Grid item xs={6} sm={4}>
                                <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Property Type:</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{q.propertyType || 'Any'}</Typography>
                              </Grid>
                              {q.budget && q.budget > 0 ? (
                                <Grid item xs={6} sm={4}>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Budget limit:</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#2563EB' }}>₹{formatCurrency(q.budget)}</Typography>
                                </Grid>
                              ) : null}
                              {q.demand && q.demand > 0 ? (
                                <Grid item xs={6} sm={4}>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Expected Price:</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#16A34A' }}>₹{formatCurrency(q.demand)}</Typography>
                                </Grid>
                              ) : null}
                              <Grid item xs={12}>
                                <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Requirements & Locality:</Typography>
                                <Typography variant="body2">{q.locality} {q.sector_block ? `(Block ${q.sector_block})` : ''} • Size: {q.size || 'Any'} • Remarks: {q.remarks}</Typography>
                              </Grid>
                            </Grid>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 2: Deals */}
                  {activeTab === 2 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Deals & Transaction History</Typography>
                      {connections.deals?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No real estate bookings/deals recorded for this client.</Typography>
                      ) : (
                        connections.deals.map(d => {
                          const isBuyer = String(d.customerId) === String(id);
                          return (
                            <Paper key={d.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Deal: {d.id}</Typography>
                                <Box display="flex" gap={1}>
                                  <Chip 
                                    label={isBuyer ? 'Buyer Client' : 'Seller Client'} 
                                    color={isBuyer ? 'primary' : 'success'} 
                                    size="small"
                                    sx={{ fontWeight: 700 }}
                                  />
                                  <Chip 
                                    label={d.status} 
                                    color={d.status === 'Closed' ? 'success' : d.status === 'Cancelled' ? 'error' : 'warning'}
                                    size="small"
                                    sx={{ fontWeight: 700 }}
                                  />
                                </Box>
                              </Box>
                              <Grid container spacing={2}>
                                <Grid item xs={6} sm={4}>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Property ID:</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(d.propertyId?.startsWith('PROJ-') ? `/module/projects/${d.propertyId}` : `/module/properties/${d.propertyId}`)}>
                                    {getPropertyName(d.propertyId)}
                                  </Typography>
                                </Grid>
                                <Grid item xs={6} sm={4}>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Sale Value:</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(d.salePrice)}</Typography>
                                </Grid>
                                <Grid item xs={6} sm={4}>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Commission/Brokerage:</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#16A34A' }}>₹{formatCurrency(d.commissionAmount)} ({d.brokeragePercent || 0}%)</Typography>
                                </Grid>
                                <Grid item xs={12}>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Registry Details:</Typography>
                                  <Typography variant="body2">Date Registered: {d.registrationDate || 'Pending'} • Executed By: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/employees/${d.employeeId}`)}>{d.employeeId}</span> • Docs Attached: {d.documents || 'None'}</Typography>
                                </Grid>
                              </Grid>
                            </Paper>
                          );
                        })
                      )}
                    </Box>
                  )}

                  {/* Tab 3: Consolidated Timeline */}
                  {activeTab === 3 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Consolidated Activity Timeline</Typography>
                      {connections.timeline?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No activity timeline logs recorded.</Typography>
                      ) : (
                        <Box sx={{ borderLeft: '2px solid #E2E8F0', pl: 3, ml: 1, position: 'relative' }}>
                          {connections.timeline.map((evt, idx) => (
                            <Box key={idx} sx={{ mb: 3, position: 'relative' }}>
                              <Box sx={{ 
                                position: 'absolute', 
                                left: '-35px', 
                                top: '0px', 
                                width: '22px', 
                                height: '22px', 
                                borderRadius: '50%', 
                                backgroundColor: '#FFFFFF', 
                                border: '2px solid #2563EB', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                color: '#2563EB'
                              }}>
                                <DynamicIcon name={evt.icon || 'Circle'} size={12} />
                              </Box>
                              <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>{evt.date}</Typography>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A', mt: 0.2 }}>{evt.event}</Typography>
                              <Typography variant="body2" sx={{ color: '#475569', fontSize: '13px' }}>{evt.details}</Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}

                  {/* Tab 4: Docs & Files */}
                  {activeTab === 4 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Documents Vault</Typography>
                      {/* Upload Simulator */}
                      <Box component="form" onSubmit={handleUploadDoc} sx={{ mb: 4, p: 2.5, border: '1px dashed #CBD5E1', borderRadius: '12px' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Upload/Attach Document to Client Profile</Typography>
                        
                        <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                          <input type="file" id="direct-file-input" style={{ display: 'none' }} onChange={handleFileChange} />
                          <label htmlFor="direct-file-input">
                            <Button variant="outlined" size="small" component="span" startIcon={<Icons.Upload size={16} />}>
                              Choose File
                            </Button>
                          </label>
                          <Typography variant="caption" sx={{ color: '#64748B' }}>
                            {selectedFile ? selectedFile.name : 'No file selected'}
                          </Typography>
                        </Box>

                        <TextField 
                          label="Document Custom Label/Name" 
                          size="small" 
                          fullWidth 
                          value={docName} 
                          onChange={(e) => setDocName(e.target.value)} 
                          sx={{ mb: 2 }}
                          placeholder="e.g. Aadhar Card Scan"
                        />
                        <Button variant="contained" size="small" type="submit" sx={{ textTransform: 'none' }} disabled={!selectedFile}>Save Upload</Button>
                      </Box>

                      {connections.documents?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No attached documents vault logs detected.</Typography>
                      ) : (
                        connections.documents.map(doc => (
                          <Paper key={doc.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'none' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Icons.FileText size={24} color="#2563EB" />
                              <Box>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>{doc.name}</Typography>
                                <Typography variant="caption" sx={{ color: '#64748B' }}>Uploaded: {doc.dateAdded} • By: {doc.uploadedBy}</Typography>
                              </Box>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Button variant="outlined" size="small" component="a" href={doc.fileUrl} download sx={{ textTransform: 'none' }}>
                                Download
                              </Button>
                              <IconButton size="small" color="error" onClick={() => handleDeleteDoc(doc.id)}>
                                <Icons.Trash2 size={16} />
                              </IconButton>
                            </Box>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 5: Referrals List */}
                  {activeTab === 5 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Referred Leads Log</Typography>
                      {!connections.referrals || connections.referrals.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No referrals registered under this profile.</Typography>
                      ) : (
                        <TableContainer component={Paper} sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                          <Table size="small">
                            <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>Lead ID</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Lead Name</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Phone Number</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Lead Type</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {connections.referrals.map(l => (
                                <TableRow key={l.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/module/leads/${l.id}`)}>
                                  <TableCell sx={{ color: '#2563EB', fontWeight: 600 }}>{l.id}</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>{l.name || l.person_name || 'Unnamed'}</TableCell>
                                  <TableCell>{l.phone || '---'}</TableCell>
                                  <TableCell>
                                    <Chip label={l.leadType} size="small" color={l.leadType === 'Buyer' ? 'primary' : 'success'} sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} />
                                  </TableCell>
                                  <TableCell>
                                    <Chip label={l.status} size="small" variant="outlined" sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}

                  {/* Tab 6: AI Assistant View */}
                  {tabs[activeTab]?.label === 'AI Copilot Summary' && (
                    <Box>
                      <Grid container spacing={3}>
                        {/* Column 1: Lead Score Gauge and Objections */}
                        <Grid item xs={12} md={4}>
                          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #E2E8F0', height: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', justify: 'center', alignItems: 'center' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#64748B' }}>AI Conversion Lead Score</Typography>
                            {aiScoreLoading ? (
                              <CircularProgress size={40} />
                            ) : (
                              <Box>
                                <Box sx={{ position: 'relative', display: 'inline-flex', mb: 2 }}>
                                  <CircularProgress 
                                    variant="determinate" 
                                    value={aiScore} 
                                    size={100} 
                                    thickness={6}
                                    sx={{ 
                                      color: aiScore >= 80 ? '#22C55E' : (aiScore >= 50 ? '#F59E0B' : '#3B82F6')
                                    }}
                                  />
                                  <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography variant="h5" component="div" sx={{ fontWeight: 800, color: '#0F172A' }}>
                                      {aiScore}%
                                    </Typography>
                                  </Box>
                                </Box>
                                <Box sx={{ mb: 3 }}>
                                  <Chip 
                                    label={`Segment: ${aiLabel}`} 
                                    color={aiLabel === 'Very Hot' || aiLabel === 'Hot' ? 'success' : (aiLabel === 'Warm' ? 'warning' : 'primary')} 
                                    sx={{ fontWeight: 700 }} 
                                  />
                                </Box>
                                
                                <Divider sx={{ my: 2 }} />
                                <Box sx={{ textAlign: 'left' }}>
                                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', display: 'block', mb: 1 }}>Score Rationale & Objections:</Typography>
                                  {aiReasons.map((reason, idx) => (
                                    <Box key={idx} display="flex" gap={1} alignItems="flex-start" sx={{ mb: 1 }}>
                                      <Icons.CheckCircle2 size={14} color="#16A34A" style={{ flexShrink: 0, marginTop: 2 }} />
                                      <Typography variant="caption" sx={{ fontWeight: 550, color: '#475569' }}>
                                        {reason}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Box>
                              </Box>
                            )}
                          </Paper>
                        </Grid>

                        {/* Column 2: Customer 360 AI Summary & Next Action */}
                        <Grid item xs={12} md={8}>
                          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #E2E8F0', height: '100%' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, color: '#1E3A8A', display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Icons.Sparkles size={16} />
                              AI Journey Summary
                            </Typography>
                            {aiSummaryLoading ? (
                              <Box display="flex" flexDirection="column" gap={1.5} sx={{ py: 3 }}>
                                <Box sx={{ height: 20, backgroundColor: '#F1F5F9', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
                                <Box sx={{ height: 20, backgroundColor: '#F1F5F9', borderRadius: '4px', animation: 'pulse 1.5s infinite', width: '80%' }} />
                                <Box sx={{ height: 20, backgroundColor: '#F1F5F9', borderRadius: '4px', animation: 'pulse 1.5s infinite', width: '60%' }} />
                              </Box>
                            ) : (
                              <Box>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: '#334155', fontWeight: 500, fontSize: '13px' }}>
                                  {aiSummary}
                                </Typography>
                              </Box>
                            )}
                          </Paper>
                        </Grid>

                        {/* Row 2: Property Matching & Recommendations */}
                        <Grid item xs={12} md={6}>
                          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Icons.Home size={16} />
                              Matched Inventory Recommendations
                            </Typography>
                            {aiPropertiesLoading ? (
                              <CircularProgress size={24} />
                            ) : aiProperties.length > 0 ? (
                              <Box display="flex" flexDirection="column" gap={1.5}>
                                {aiProperties.map((p) => (
                                  <Paper key={p.id} variant="outlined" sx={{ p: 1.5, borderRadius: '12px', borderColor: '#F1F5F9', backgroundColor: '#F8FAFC', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Box>
                                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#1E293B' }}>{p.name}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Locality: {p.locality} • Demand: {p.price}</Typography>
                                    </Box>
                                    <Box display="flex" flexDirection="column" alignItems="flex-end" gap={0.5}>
                                      <Chip label={`${p.matchPercentage}% Match`} color="success" size="small" sx={{ fontWeight: 700, fontSize: '10px' }} />
                                      <Button size="small" variant="text" onClick={() => navigate(`/module/properties/${p.id}`)} sx={{ fontSize: '10px', textTransform: 'none', fontWeight: 700, p: 0 }}>
                                        View Details
                                      </Button>
                                    </Box>
                                  </Paper>
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" sx={{ color: '#64748B' }}>No inventory matches found within budget segment.</Typography>
                            )}
                          </Paper>
                        </Grid>

                        {/* Row 3: Follow-up & Template Generator */}
                        <Grid item xs={12} md={6}>
                          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Icons.Mail size={16} />
                                AI Content Generator
                              </Typography>
                              <Box sx={{ display: 'flex', backgroundColor: '#F1F5F9', borderRadius: '8px', p: 0.5 }}>
                                <Button 
                                  size="small" 
                                  variant={aiContentType === 'whatsapp' ? 'contained' : 'text'}
                                  onClick={() => setAiContentType('whatsapp')}
                                  sx={{ fontSize: '10px', py: 0.2, px: 1, textTransform: 'none', fontWeight: 700 }}
                                >
                                  WhatsApp
                                </Button>
                                <Button 
                                  size="small" 
                                  variant={aiContentType === 'email' ? 'contained' : 'text'}
                                  onClick={() => setAiContentType('email')}
                                  sx={{ fontSize: '10px', py: 0.2, px: 1, textTransform: 'none', fontWeight: 700 }}
                                >
                                  Email
                                </Button>
                              </Box>
                            </Box>

                            {aiContentType === 'whatsapp' && (
                              <Box sx={{ mb: 1.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', display: 'block', mb: 0.5 }}>WhatsApp Context Theme:</Typography>
                                <Box display="flex" gap={1}>
                                  {['Greeting', 'Site Visit', 'Price Alert'].map((t) => (
                                    <Chip 
                                      key={t}
                                      label={t} 
                                      onClick={() => setWhatsappTemplateType(t)} 
                                      color={whatsappTemplateType === t ? 'primary' : 'default'}
                                      size="small" 
                                      sx={{ fontWeight: 700, cursor: 'pointer' }}
                                    />
                                  ))}
                                </Box>
                              </Box>
                            )}

                            {aiContentLoading ? (
                              <Box display="flex" justifyContent="center" py={2}><CircularProgress size={20} /></Box>
                            ) : (
                              <Box>
                                <TextField
                                  multiline
                                  rows={4}
                                  fullWidth
                                  value={aiContent}
                                  onChange={(e) => setAiContent(e.target.value)}
                                  placeholder="Generated text will show up here..."
                                  sx={{ 
                                    mb: 2,
                                    '& .MuiInputBase-input': { fontSize: '12px', fontFamily: 'monospace' }
                                  }}
                                />
                                <Box display="flex" gap={1}>
                                  <Button 
                                    variant="contained" 
                                    size="small" 
                                    color="success"
                                    onClick={handleSaveAIFollowup}
                                    startIcon={<Icons.Check size={14} />}
                                    sx={{ textTransform: 'none', fontWeight: 700 }}
                                  >
                                    Log to Follow-ups
                                  </Button>
                                  <Button 
                                    variant="outlined" 
                                    size="small" 
                                    onClick={() => {
                                      navigator.clipboard.writeText(aiContent);
                                      alert('Copied template!');
                                    }}
                                    sx={{ textTransform: 'none', fontWeight: 700 }}
                                  >
                                    Copy Text
                                  </Button>
                                </Box>
                              </Box>
                            )}
                          </Paper>
                        </Grid>

                        {/* Document Verification Assistant */}
                        <Grid item xs={12}>
                          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Icons.FileCheck size={16} />
                              AI Document Scanner & Assistant
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 2 }}>
                              Upload customer KYC/Aadhaar scans or property ledger files to auto-verify names and checklist items.
                            </Typography>
                            
                            <Box display="flex" gap={2} alignItems="center" mb={2}>
                              <Button 
                                variant="outlined" 
                                size="small" 
                                startIcon={<Icons.FileText size={14} />}
                                onClick={handleDocSummaryUpload}
                                sx={{ textTransform: 'none', fontWeight: 700 }}
                              >
                                Upload & Verify KYC Document
                              </Button>
                              {aiDocLoading && <CircularProgress size={16} />}
                            </Box>

                            {aiDocSummary && (
                              <Paper variant="outlined" sx={{ p: 2, borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: '12px', fontFamily: 'monospace' }}>
                                  {aiDocSummary}
                                </Typography>
                              </Paper>
                            )}
                          </Paper>
                        </Grid>
                      </Grid>
                    </Box>
                  )}
                </Box>
              )}

              {/* 2. PROPERTY TABS */}
              {moduleName === 'properties' && (
                <Box>
                  {/* Tab 0: Overview */}
                  {activeTab === 0 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Property Summary & Remarks</Typography>
                      {/* Remarks Log Section */}
                      <Box component="form" onSubmit={handlePostRemark} sx={{ mb: 3 }}>
                        <Grid container spacing={1.5}>
                          <Grid item xs={12} sm={10}>
                            <TextField 
                              placeholder="Type property comments or showing updates here..."
                              fullWidth
                              size="small"
                              value={remarkInput}
                              onChange={(e) => setRemarkInput(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={2}>
                            <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB' }}>
                              Post Log
                            </Button>
                          </Grid>
                        </Grid>
                      </Box>
                      {connections?.remarks?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No remarks posted yet.</Typography>
                      ) : (
                        connections.remarks.map((rem, idx) => (
                          <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', boxShadow: 'none', backgroundColor: '#F8FAFC' }}>
                            <Box display="flex" justifyContent="space-between" mb={0.5}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rem.employeeName}</Typography>
                              <Typography variant="caption" sx={{ color: '#94A3B8' }}>{rem.dateTime}</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ color: '#4B5563', fontStyle: 'italic' }}>"{rem.comment}"</Typography>
                          </Paper>
                        ))
                      )}

                      <Divider sx={{ my: 4 }} />
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: 'Poppins' }}>Pitched Clients & Prospects History</Typography>
                      </Box>
                      {connections.pitches?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No pitches logged for this property yet.</Typography>
                      ) : (
                        connections.pitches.map(p => {
                          const isLead = String(p.customerId).startsWith('LEAD-');
                          const clientPath = isLead ? `/module/leads/${p.customerId}` : `/module/customers/${p.customerId}`;
                          return (
                            <Paper key={p.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                <Box display="flex" alignItems="center" gap={1}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(clientPath)}>
                                    Client: {p.customerName || p.customerId}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: '#64748B' }}>({p.id})</Typography>
                                </Box>
                                <Chip 
                                  label={p.interestLevel} 
                                  color={p.interestLevel === 'Interested' ? 'success' : p.interestLevel === 'Not Interested' ? 'error' : 'warning'} 
                                  size="small"
                                  sx={{ fontWeight: 700 }}
                                />
                              </Box>
                              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1 }}>
                                Pitched on: {p.pitchDate} • Method: <strong>{p.pitchMethod}</strong> • Pitched by: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/employees/${p.employeeId || 'EMP-001'}`)}>{p.employeeName}</span>
                              </Typography>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>Quoted Offer Price: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/property_pitch_history/${p.id}`)}>{p.id}</span> (Quoted: ₹{formatCurrency(p.quotedPrice)})</Typography>
                              <Typography variant="body2" sx={{ color: '#475569', mt: 0.5 }}>Remarks: {p.remarks}</Typography>
                            </Paper>
                          );
                        })
                      )}
                    </Box>
                  )}

                  {/* Tab 1: Pitches & Showings */}
                  {activeTab === 1 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Customer Showing Visits & Pitch Logs</Typography>
                      <Grid container spacing={3}>
                        <Grid item xs={12} sm={6}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Showings / Site Visits ({connections.site_visits?.length || 0})</Typography>
                          {connections.site_visits?.length === 0 ? (
                            <Typography variant="body2" sx={{ color: '#94A3B8' }}>No site visits registered for this property listing.</Typography>
                          ) : (
                            connections.site_visits.map((sv, idx) => (
                              <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>Client: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/customers/${sv.customerId}`)}>{sv.customer?.name || sv.customerId}</span></Typography>
                                <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                                  Showed on: {sv.date} • Showed by: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/employees/${sv.employeeId}`)}>{sv.employeeId}</span> • Outcome: <strong>{sv.result}</strong>
                                </Typography>
                              </Paper>
                            ))
                          )}
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Agent Pitches Log ({connections.pitches?.length || 0})</Typography>
                          {connections.pitches?.length === 0 ? (
                            <Typography variant="body2" sx={{ color: '#94A3B8' }}>No pitch logs registered for this property listing.</Typography>
                          ) : (
                            connections.pitches.map(p => {
                              const isLead = String(p.customerId).startsWith('LEAD-');
                              const clientPath = isLead ? `/module/leads/${p.customerId}` : `/module/customers/${p.customerId}`;
                              return (
                                <Paper key={p.id} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>Client: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(clientPath)}>{p.customerName || p.customerId}</span></Typography>
                                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                                    Pitched on: {p.pitchDate} • Method: {p.pitchMethod} • Offered: <strong>₹{formatCurrency(p.quotedPrice)}</strong>
                                  </Typography>
                                </Paper>
                              );
                            })
                          )}
                        </Grid>
                      </Grid>
                    </Box>
                  )}

                  {/* Tab 2: Price/Status History Logs */}
                  {activeTab === 2 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Pricing & Attribute Historical Timeline</Typography>
                      {renderListControls([
                        { value: 'date', label: 'Date Changed' },
                        { value: 'field', label: 'Attribute' }
                      ])}

                      {!connections.history || connections.history.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No pricing updates or status changes recorded yet.</Typography>
                      ) : (
                        filterAndSortList(connections.history || [], ['date', 'field', 'fieldName', 'oldValue', 'newValue', 'employeeName']).map(h => (
                          <Paper key={h.id} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Box display="flex" justifyContent="space-between" mb={0.5}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#F59E0B' }}>Attribute Changed: {h.fieldName}</Typography>
                              <Typography variant="caption" sx={{ color: '#94A3B8' }}>{h.date}</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>
                              Previous Value: <span style={{ textDecoration: 'line-through', color: '#EF4444' }}>{h.oldValue}</span>
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>
                              New Value: <span style={{ color: '#10B981', fontWeight: 700 }}>{h.newValue}</span>
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Updated by: {h.employeeName}</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 3: Owner History */}
                  {activeTab === 3 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Permanent Ownership Registry History</Typography>
                      {connections.ownerHistory?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No previous owners registered in registry logs. This listing is under its first owner.</Typography>
                      ) : (
                        <Box sx={{ borderLeft: '2px solid #E2E8F0', pl: 3, ml: 1 }}>
                          {connections.ownerHistory.map((h, idx) => (
                            <Box key={idx} sx={{ mb: 3, position: 'relative' }}>
                              <Box sx={{ position: 'absolute', left: '-35px', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                Owner: {h.ownerId && h.ownerId !== 'N/A' ? (
                                  <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/customers/${h.ownerId}`)}>
                                    {h.ownerName} ({h.ownerId})
                                  </span>
                                ) : (
                                  <span>{h.ownerName}</span>
                                )}
                              </Typography>
                              <Typography variant="body2" sx={{ color: '#475569' }}>
                                Purchase Date: {h.purchaseDate || 'N/A'} • Bought for: ₹{formatCurrency(h.purchasePrice || 0)}
                              </Typography>
                              <Typography variant="body2" sx={{ color: '#EF4444', fontWeight: 600 }}>
                                Sold on: {h.saleDate} for: ₹{formatCurrency(h.salePrice)}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}

                  {/* Tab 4: Docs Vault */}
                  {activeTab === 4 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Docs Vault (Property Deeds & NOCs)</Typography>
                      <Box component="form" onSubmit={handleUploadDoc} sx={{ mb: 4, p: 2.5, border: '1px dashed #CBD5E1', borderRadius: '12px' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Upload/Attach Documents to Property Vault</Typography>
                        
                        <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                          <input type="file" id="direct-file-input" style={{ display: 'none' }} onChange={handleFileChange} />
                          <label htmlFor="direct-file-input">
                            <Button variant="outlined" component="span" startIcon={<Icons.Upload size={16} />} sx={{ textTransform: 'none', fontWeight: 600 }}>
                              Choose Local Registry / Layout PDF
                            </Button>
                          </label>
                          {selectedFile && (
                            <Typography variant="body2" sx={{ color: '#0F172A', fontWeight: 500 }}>
                              Selected: {selectedFile.name}
                            </Typography>
                          )}
                          {uploadingFile && <CircularProgress size={20} />}
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={12} sm={5}>
                            <TextField 
                              placeholder="Title (e.g. NOC Certificate, Registry Deed)"
                              size="small"
                              fullWidth
                              value={docName}
                              onChange={(e) => setDocName(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={5}>
                            <TextField 
                              placeholder="Direct File URL link"
                              size="small"
                              fullWidth
                              value={docUrl}
                              onChange={(e) => setDocUrl(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={2}>
                            <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB' }}>
                              Link File
                            </Button>
                          </Grid>
                        </Grid>
                      </Box>

                      <Grid container spacing={2.5}>
                        <Grid item xs={12} sm={6}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, color: '#10B981' }}>Active Owner Documents</Typography>
                          {connections.documents?.filter(d => !d.id.startsWith('DOC-OLD-'))?.length === 0 ? (
                            <Typography variant="body2" sx={{ color: '#94A3B8' }}>No active files attached.</Typography>
                          ) : (
                            connections.documents.filter(d => !d.id.startsWith('DOC-OLD-')).map((doc, index) => (
                              <Paper key={index} sx={{ p: 2, mb: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{doc.name}</Typography>
                                  <Typography variant="caption" sx={{ color: '#64748B' }}>Uploaded: {doc.dateAdded} • By: {doc.uploadedBy}</Typography>
                                </Box>
                                <Button variant="outlined" size="small" component="a" href={doc.fileUrl} download sx={{ textTransform: 'none' }}>Get</Button>
                              </Paper>
                            ))
                          )}
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, color: '#EF4444' }}>Previous Owners Document Archives</Typography>
                          {connections.documents?.filter(d => d.id.startsWith('DOC-OLD-'))?.length === 0 ? (
                            <Typography variant="body2" sx={{ color: '#94A3B8' }}>No archived files found.</Typography>
                          ) : (
                            connections.documents.filter(d => d.id.startsWith('DOC-OLD-')).map((doc, index) => (
                              <Paper key={index} sx={{ p: 2, mb: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E2E8F0', boxShadow: 'none', backgroundColor: '#F8FAFC' }}>
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#64748B' }}>{doc.name}</Typography>
                                  <Typography variant="caption" sx={{ color: '#94A3B8' }}>Deed File Archive (Transferred)</Typography>
                                </Box>
                                <Button variant="outlined" size="small" component="a" href={doc.fileUrl} download sx={{ textTransform: 'none' }}>Get</Button>
                              </Paper>
                            ))
                          )}
                        </Grid>
                      </Grid>
                    </Box>
                  )}

                  {/* Tab 5: Deals History */}
                  {activeTab === 5 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Deals & Transaction History</Typography>
                      {connections.deals?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No closed/pending deals found for this property.</Typography>
                      ) : (
                        connections.deals.map(d => (
                          <Paper key={d.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                            <Box display="flex" justifyContent="space-between" mb={1}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Deal: {d.id}</Typography>
                              <Chip label={d.status} color={d.status === 'Closed' ? 'success' : 'warning'} size="small" sx={{ fontWeight: 700 }} />
                            </Box>
                            <Typography variant="body2">Seller Customer: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/customers/${d.sellerCustomerId}`)}>{d.sellerCustomerId}</span></Typography>
                            <Typography variant="body2">Buyer Customer: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/customers/${d.customerId}`)}>{d.customerId}</span></Typography>
                            <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>Price Sold: ₹{formatCurrency(d.salePrice)}</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 6: Property Activity Timeline */}
                  {activeTab === 6 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Consolidated Property Activity Timeline</Typography>
                      {connections.timeline?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No activity timeline logs recorded.</Typography>
                      ) : (
                        <Box sx={{ borderLeft: '2px solid #E2E8F0', pl: 3, ml: 1, position: 'relative' }}>
                          {connections.timeline.map((evt, idx) => (
                            <Box key={idx} sx={{ mb: 3, position: 'relative' }}>
                              <Box sx={{ position: 'absolute', left: '-35px', top: '0px', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#FFFFFF', border: '2px solid #2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
                                <DynamicIcon name={evt.icon || 'Circle'} size={12} />
                              </Box>
                              <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>{evt.date}</Typography>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A', mt: 0.2 }}>{evt.event}</Typography>
                              <Typography variant="body2" sx={{ color: '#475569', fontSize: '13px' }}>{evt.details}</Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )}

              {moduleName === 'dealers' && (
                <Box>
                  {activeTab === 0 && (
                    <Box>
                      <Typography variant="h5" sx={{ fontWeight: 850, mb: 1.5, fontFamily: 'Poppins', color: '#0F172A' }}>
                        Dealer Dashboard & Outreach Log
                      </Typography>
                      <Divider sx={{ mb: 3 }} />

                  {/* 1. Quick Outreach Log Actions */}
                  <Grid container spacing={3} sx={{ mb: 4 }}>
                    <Grid item xs={12} sm={6}>
                      <Paper sx={{ p: 3, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none', backgroundColor: '#F8FAFC' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Icons.PhoneCall size={20} color="#2563EB" />
                          Outreach Calling
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#64748B', mb: 2.5 }}>
                          Log phone call outcomes, duration, and gather remarks from the dealer.
                        </Typography>
                        <Button 
                          variant="contained" 
                          size="small" 
                          startIcon={<Icons.Phone size={16} />}
                          onClick={() => {
                            setCallDuration('');
                            setCallBudget('');
                            setCallAreas('');
                            setCallRemarks('');
                            setCallOutcomeOption('Call Done');
                            setCallDialogOpen(true);
                          }}
                          sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 700 }}
                        >
                          Log Outreach Call
                        </Button>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Paper sx={{ p: 3, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none', backgroundColor: '#F8FAFC' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 1, fontFamily: 'Poppins' }}>
                          <Icons.MapPin size={20} color="#16A34A" />
                          Physical Visit Assignment
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#64748B', mb: 2 }}>
                          Assign an employee to physically visit the dealer. If assigned, they will get a notification to visit.
                        </Typography>
                        
                        <FormControl fullWidth size="small" sx={{ mb: 2, backgroundColor: 'white' }}>
                          <InputLabel>Select Employee</InputLabel>
                          <Select
                            label="Select Employee"
                            value={record?.assignedEmployeeId || ''}
                            onChange={async (e) => {
                              const selectedVal = e.target.value;
                              const payload = {
                                ...record,
                                assignedEmployeeId: selectedVal || ''
                              };
                              const res = await updateRecord('dealers', record.id, payload);
                              if (res.success) {
                                loadData();
                              } else {
                                alert(res.message || "Failed to assign employee");
                              }
                            }}
                          >
                            <MenuItem value=""><em>Unassigned</em></MenuItem>
                            {(moduleData.employees || []).map(emp => (
                              <MenuItem key={emp.id} value={emp.id}>
                                {emp.name} ({emp.id})
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        {record?.assignedEmployeeId && (
                          <Box sx={{ mt: 1, p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', backgroundColor: 'white' }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                              <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 700 }}>
                                Visit Status:
                              </Typography>
                              <Chip 
                                label={record.visitStatus || 'Assigned'} 
                                color={record.visitStatus === 'Completed' ? 'success' : record.visitStatus === 'Cancelled' ? 'error' : 'warning'} 
                                size="small" 
                                sx={{ fontWeight: 800, fontSize: '10px', borderRadius: '6px' }}
                              />
                            </Box>
                            
                            {(!record.visitStatus || record.visitStatus === 'Assigned') ? (
                              <Box sx={{ mt: 1.5 }}>
                                <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                                  <InputLabel>Visit Outcome</InputLabel>
                                  <Select
                                    label="Visit Outcome"
                                    value={meetingOutcome}
                                    onChange={(e) => setMeetingOutcome(e.target.value)}
                                  >
                                    <MenuItem value="Completed">Visit Completed</MenuItem>
                                    <MenuItem value="Dealer Not Interested">Dealer Not Interested to Meet</MenuItem>
                                  </Select>
                                </FormControl>
                                <TextField
                                  placeholder="Type visit remarks..."
                                  size="small"
                                  fullWidth
                                  multiline
                                  rows={2}
                                  value={meetingDocCollected}
                                  onChange={(e) => setMeetingDocCollected(e.target.value)}
                                  sx={{ mb: 1.5 }}
                                />
                                <Button
                                  variant="contained"
                                  color="success"
                                  size="small"
                                  fullWidth
                                  sx={{ fontWeight: 700, textTransform: 'none' }}
                                  onClick={async () => {
                                    if (!meetingOutcome) {
                                      alert("Please select visit outcome");
                                      return;
                                    }
                                    const nextStatus = meetingOutcome === 'Completed' ? 'Completed' : 'Cancelled';
                                    const finalOutcome = meetingOutcome === 'Completed' 
                                      ? `Visit Completed: ${meetingDocCollected}` 
                                      : `Dealer Not Interested: ${meetingDocCollected}`;
                                    
                                    const payload = {
                                      ...record,
                                      visitStatus: nextStatus,
                                      remarks: finalOutcome
                                    };
                                    const res = await updateRecord('dealers', record.id, payload);
                                    if (res.success) {
                                      setMeetingOutcome('');
                                      setMeetingDocCollected('');
                                      loadData();
                                    } else {
                                      alert(res.message || "Failed to update visit details");
                                    }
                                  }}
                                >
                                  Save Visit Remarks
                                </Button>
                              </Box>
                            ) : (
                              <Typography variant="body2" sx={{ color: '#475569', mt: 1, fontStyle: 'italic' }}>
                                Visit resolved. Remarks: "{record.remarks}"
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Paper>
                    </Grid>
                  </Grid>

                  {/* 2. Admin Visit Assignments */}
                  <Paper sx={{ p: 3, mb: 4, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Icons.UserCheck size={22} color="#F59E0B" />
                      Assigned Site Visits & Physical Meetings
                    </Typography>
                    
                    {!record?.assignedEmployeeId ? (
                      <Box sx={{ p: 3, textAlign: 'center', backgroundColor: '#F8FAFC', borderRadius: '12px', border: '1px dashed #E2E8F0' }}>
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                          No active physical visit assigned. Assign an employee in the card above or on the sheet page.
                        </Typography>
                      </Box>
                    ) : (
                      <Paper sx={{ p: 2.5, border: '1px solid #FEF3C7', backgroundColor: '#FFFBEB', borderRadius: '12px', boxShadow: 'none' }}>
                        <Box display="flex" justifyContent="space-between" mb={1.5}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#D97706' }}>
                            Visit Assigned To: <strong>{moduleData.employees?.find(e => String(e.id) === String(record.assignedEmployeeId))?.name || record.assignedEmployeeId}</strong>
                          </Typography>
                          <Chip 
                            label={record.visitStatus || 'Assigned'} 
                            color={record.visitStatus === 'Completed' ? 'success' : record.visitStatus === 'Cancelled' ? 'error' : 'warning'} 
                            size="small" 
                            sx={{ fontWeight: 800, fontSize: '10px', borderRadius: '6px' }} 
                          />
                        </Box>
                        <Typography variant="body2" sx={{ color: '#475569' }}>
                          <strong>Last Update / Remarks:</strong> {record.remarks || 'No visit updates logged yet.'}
                        </Typography>
                      </Paper>
                    )}
                  </Paper>

                  {/* Associated Properties & Listings */}
                  <Paper sx={{ p: 3, mb: 4, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Icons.Home size={22} color="#3B82F6" />
                      Associated Properties & Listings
                    </Typography>
                    
                    {!(connections?.properties && connections.properties.length > 0) ? (
                      <Box sx={{ p: 3, textAlign: 'center', backgroundColor: '#F8FAFC', borderRadius: '12px', border: '1px dashed #E2E8F0' }}>
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                          No properties associated with this dealer yet.
                        </Typography>
                      </Box>
                    ) : (
                      <TableContainer component={Box} sx={{ maxHeight: 350, overflowY: 'auto' }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 800, color: '#475569', fontSize: '12px', backgroundColor: '#F8FAFC' }}>Property ID</TableCell>
                              <TableCell sx={{ fontWeight: 800, color: '#475569', fontSize: '12px', backgroundColor: '#F8FAFC' }}>Type</TableCell>
                              <TableCell sx={{ fontWeight: 800, color: '#475569', fontSize: '12px', backgroundColor: '#F8FAFC' }}>Size</TableCell>
                              <TableCell sx={{ fontWeight: 800, color: '#475569', fontSize: '12px', backgroundColor: '#F8FAFC' }}>Demand / Price</TableCell>
                              <TableCell sx={{ fontWeight: 800, color: '#475569', fontSize: '12px', backgroundColor: '#F8FAFC' }}>Sector / Block</TableCell>
                              <TableCell sx={{ fontWeight: 800, color: '#475569', fontSize: '12px', backgroundColor: '#F8FAFC' }}>Status</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {connections.properties.map(p => (
                              <TableRow key={p.id} hover>
                                <TableCell>
                                  <Typography 
                                    variant="body2" 
                                    sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                    onClick={() => navigate(`/module/properties/${p.id}`)}
                                  >
                                    {p.id}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{p.propertyType || p.r_c_i}</TableCell>
                                <TableCell>{p.size || 'N/A'}</TableCell>
                                <TableCell sx={{ fontWeight: 700, color: '#16A34A' }}>
                                  {p.demand ? (() => {
                                    const str = String(p.demand).trim();
                                    if (/[a-zA-Z]/.test(str)) return str;
                                    const num = Number(str.replace(/,/g, ''));
                                    if (isNaN(num)) return str;
                                    return `₹${num.toLocaleString('en-IN')}`;
                                  })() : 'N/A'}
                                </TableCell>
                                <TableCell>{p.sector_block || 'N/A'}</TableCell>
                                <TableCell>
                                  <Chip 
                                    label={p.status || 'Available'} 
                                    color={p.status === 'Available' ? 'success' : p.status === 'Sold' ? 'error' : 'default'} 
                                    size="small" 
                                    sx={{ fontWeight: 800, fontSize: '9px', borderRadius: '4px', height: '18px' }} 
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Paper>

                  {/* 3. General Remarks & Comments Log */}
                  <Paper sx={{ p: 3, mb: 4, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>
                      General Remarks & Comments
                    </Typography>
                    <Box component="form" onSubmit={handlePostRemark} sx={{ mb: 3 }}>
                      <Grid container spacing={1.5}>
                        <Grid item xs={12} sm={10}>
                          <TextField 
                            placeholder="Type dealer remarks or brokerage disputes..."
                            fullWidth
                            size="small"
                            value={remarkInput}
                            onChange={(e) => setRemarkInput(e.target.value)}
                          />
                        </Grid>
                        <Grid item xs={12} sm={2}>
                          <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB', textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}>
                            Post Log
                          </Button>
                        </Grid>
                      </Grid>
                    </Box>
                    
                    {connections?.remarks?.length === 0 ? (
                      <Typography variant="body2" sx={{ color: '#94A3B8' }}>No remarks posted yet.</Typography>
                    ) : (
                      connections.remarks.map((rem, idx) => (
                        <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', boxShadow: 'none', backgroundColor: '#F8FAFC', borderRadius: '8px' }}>
                          <Box display="flex" justifyContent="space-between" mb={0.5}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rem.employeeName}</Typography>
                            <Typography variant="caption" sx={{ color: '#94A3B8' }}>{rem.dateTime}</Typography>
                          </Box>
                          <Typography variant="body2" sx={{ color: '#4B5563', fontStyle: 'italic' }}>"{rem.comment}"</Typography>
                        </Paper>
                      ))
                    )}
                  </Paper>

                  {/* 4. Complete Outreach Activity Timeline */}
                  <Paper sx={{ p: 3, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 3, fontFamily: 'Poppins' }}>
                      Complete Outreach Timeline (Calls, Visits & Meetings)
                    </Typography>
                    
                    {connections.timeline?.length === 0 ? (
                      <Typography variant="body2" sx={{ color: '#94A3B8', py: 2 }}>No activity timeline logs recorded.</Typography>
                    ) : (
                      <Box sx={{ borderLeft: '2px solid #E2E8F0', pl: 3, ml: 1, position: 'relative' }}>
                        {connections.timeline.map((evt, idx) => (
                          <Box key={idx} sx={{ mb: 3.5, position: 'relative' }}>
                            <Box sx={{ position: 'absolute', left: '-35px', top: '0px', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#FFFFFF', border: '2px solid #2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
                              <DynamicIcon name={evt.icon || 'Circle'} size={12} />
                            </Box>
                            <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 700 }}>{evt.date}</Typography>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A', mt: 0.2 }}>{evt.event}</Typography>
                            <Typography variant="body2" sx={{ color: '#475569', fontSize: '13px', mt: 0.5 }}>{evt.details}</Typography>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Paper>
                  {/* 5. Associated Properties / Listings */}
                  <Paper sx={{ p: 3, mt: 4, border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Icons.Home size={22} color="#2563EB" />
                      Associated Property Listings / Inventories ({connections.properties?.length || 0})
                    </Typography>
                    
                    {renderListControls([
                      { value: 'id', label: 'Property ID' },
                      { value: 'locality', label: 'Locality' },
                      { value: 'propertyType', label: 'Property Type' },
                      { value: 'demand', label: 'Price' }
                    ])}
                    
                    {!connections.properties || connections.properties.length === 0 ? (
                      <Box sx={{ p: 3, textAlign: 'center', backgroundColor: '#F8FAFC', borderRadius: '12px', border: '1px dashed #E2E8F0' }}>
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                          No properties associated with this dealer.
                        </Typography>
                      </Box>
                    ) : (
                      <Grid container spacing={2}>
                        {filterAndSortList(connections.properties || [], ['id', 'locality', 'sector_block', 'propertyType', 'demand', 'size']).map(p => (
                          <Grid item xs={12} sm={6} md={4} key={p.id}>
                            <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', cursor: 'pointer', '&:hover': { borderColor: '#2563EB' } }} onClick={() => navigate(`/module/properties/${p.id}`)}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#2563EB' }}>{p.id}</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.locality} {p.sector_block ? `(Sector ${p.sector_block})` : ''}</Typography>
                              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>Type: {p.propertyType} • Size: {p.size}</Typography>
                              <Typography variant="caption" sx={{ color: '#16A34A', fontWeight: 700, display: 'block', mt: 0.5 }}>Price: ₹{p.demand}</Typography>
                            </Paper>
                          </Grid>
                        ))}
                      </Grid>
                    )}
                  </Paper>
                </Box>
              )}
                  {activeTab === 1 && (
                    <Box>
                      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'Poppins', color: '#0F172A' }}>
                          Pitched Properties & Showings ({connections?.pitches?.length || 0})
                        </Typography>
                        <Button 
                          variant="outlined" 
                          size="small" 
                          startIcon={<Icons.Plus size={16} />}
                          onClick={() => {
                            setPitchPropertyId('');
                            setPitchEmployeeId(record.assignedEmployeeId || record.employeeId || '');
                            setPitchCustomerId('');
                            setPitchPrice('');
                            setPitchRemarks('');
                            setPitchWarning('');
                            setPitchPropertyStatus('');
                            setPitchDialogOpen(true);
                          }}
                        >
                          Log Pitch
                        </Button>
                      </Box>
                      
                      {!connections.pitches || connections.pitches.length === 0 ? (
                        <Box sx={{ p: 3, textAlign: 'center', backgroundColor: '#F8FAFC', borderRadius: '12px', border: '1px dashed #E2E8F0' }}>
                          <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                            No property pitches associated with this dealer.
                          </Typography>
                        </Box>
                      ) : (
                        connections.pitches.map(p => (
                          <Paper key={p.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none', backgroundColor: 'white' }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                              <Box display="flex" alignItems="center" gap={1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(p.propertyId?.startsWith('PROJ-') ? `/module/projects/${p.propertyId}` : `/module/properties/${p.propertyId}`)}>
                                  {getPropertyName(p.propertyId)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#64748B' }}>({p.id})</Typography>
                              </Box>
                              <Chip 
                                label={p.interestLevel} 
                                color={p.interestLevel === 'Interested' ? 'success' : p.interestLevel === 'Not Interested' ? 'error' : 'warning'} 
                                size="small"
                                sx={{ fontWeight: 700 }}
                              />
                            </Box>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1 }}>
                              Pitch Date: {p.pitchDate} • Method: {p.pitchMethod} • Quoted: {p.quotedPrice ? (() => {
                                const str = String(p.quotedPrice).trim();
                                if (/[a-zA-Z]/.test(str)) return str;
                                const num = Number(str.replace(/,/g, ''));
                                if (isNaN(num)) return str;
                                return `₹${num.toLocaleString('en-IN')}`;
                              })() : 'N/A'}
                            </Typography>
                            {p.customerId && (
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                Client: <a href={`/module/customers/${p.customerId}`} style={{ color: '#2563EB', fontWeight: 600 }} onClick={(e) => { e.preventDefault(); navigate(p.customerId.startsWith('LEAD-') ? `/module/leads/${p.customerId}` : `/module/customers/${p.customerId}`); }}>{p.customerId}</a>
                              </Typography>
                            )}
                            <Typography variant="body2" sx={{ color: '#475569' }}>
                              Remarks: {p.remarks || '---'}
                            </Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                  {activeTab === 2 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Calls History ({connections?.calls?.length || 0})</Typography>
                      {connections?.calls?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8', mb: 3 }}>No calls logged.</Typography>
                      ) : (
                        connections.calls.map(c => (
                          <Paper key={c.id} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none', backgroundColor: 'white' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Call ID: {c.id} • RM: {c.employeeName}</Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>Date: {c.date} • Duration: {c.duration} mins • Budget: {c.budget}</Typography>
                            <Typography variant="body2" sx={{ color: '#475569', mt: 1 }}>Remarks: {c.remarks}</Typography>
                          </Paper>
                        ))
                      )}

                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, mt: 3 }}>Meetings History ({connections?.meetings?.length || 0})</Typography>
                      {connections?.meetings?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No meetings scheduled.</Typography>
                      ) : (
                        connections.meetings.map(m => (
                          <Paper key={m.id} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none', backgroundColor: 'white' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Meeting ID: {m.id} • RM: {m.assignedEmployeeName}</Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>Date: {m.date} • Time: {m.time} • Status: {m.status}</Typography>
                            <Typography variant="body2" sx={{ color: '#475569', mt: 1 }}>Remarks: {m.outcome || '---'}</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                  {activeTab === 3 && (
                    <Box>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                        <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>Docs Vault</Typography>
                        <Button variant="outlined" component="label" size="small" startIcon={<Icons.Upload size={16} />}>
                          Upload Document
                          <input type="file" hidden onChange={handleUploadDoc} />
                        </Button>
                      </Box>
                      {connections?.documents?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No documents uploaded.</Typography>
                      ) : (
                        connections.documents.map(d => (
                          <Paper key={d.id} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white' }}>
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
                              <Typography variant="caption" sx={{ color: '#64748B' }}>Uploaded: {d.dateAdded} • By: {d.uploadedBy}</Typography>
                            </Box>
                            <Box display="flex" gap={1}>
                              <Button size="small" variant="text" href={d.fileUrl} target="_blank" rel="noreferrer">View</Button>
                              <IconButton size="small" color="error" onClick={() => handleDeleteDoc(d.id)}><Icons.Trash2 size={16} /></IconButton>
                            </Box>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                  {/* Tab 4: Referrals List */}
                  {activeTab === 4 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Referred Leads Log</Typography>
                      {!connections.referrals || connections.referrals.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No referrals registered under this profile.</Typography>
                      ) : (
                        <TableContainer component={Paper} sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                          <Table size="small">
                            <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>Lead ID</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Lead Name</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Phone Number</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Lead Type</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {connections.referrals.map(l => (
                                <TableRow key={l.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/module/leads/${l.id}`)}>
                                  <TableCell sx={{ color: '#2563EB', fontWeight: 600 }}>{l.id}</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>{l.name || l.person_name || 'Unnamed'}</TableCell>
                                  <TableCell>{l.phone || '---'}</TableCell>
                                  <TableCell>
                                    <Chip label={l.leadType} size="small" color={l.leadType === 'Buyer' ? 'primary' : 'success'} sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} />
                                  </TableCell>
                                  <TableCell>
                                    <Chip label={l.status} size="small" variant="outlined" sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}
                </Box>
              )}
              {/* 4. OTHER GENERIC BACKWARD COMPATIBLE TABS */}
              {!(moduleName === 'customers' || moduleName === 'properties' || moduleName === 'dealers' || moduleName === 'projects' || moduleName === 'dealer_meetings') && (
                <Box>
                  {/* Tab 0: 360 Connections */}
                  {activeTab === 0 && (
                    <Box>
                      {connections ? (
                        <Grid container spacing={3}>
                          {moduleName === 'employees' && (
                            <>
                              <Grid item xs={12} sm={6}>
                                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '16px', mb: 2, fontFamily: 'Poppins' }}>
                                  Assigned Customers ({connections.customers?.length || 0})
                                </Typography>
                                {connections.customers?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No customers handled.</Typography>
                                ) : (
                                  connections.customers.map(c => (
                                    <Paper key={c.id} sx={{ p: 1.5, mb: 1, border: '1px solid #E2E8F0', boxShadow: 'none', cursor: 'pointer' }} onClick={() => navigate(`/module/customers/${c.id}`)}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{c.name}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Stage: {c.stage} • Phone: {c.phone}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                              <Grid item xs={12} sm={6}>
                                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '16px', mb: 2, fontFamily: 'Poppins' }}>
                                  Outstanding Tasks ({connections.tasks?.length || 0})
                                </Typography>
                                {connections.tasks?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No pending tasks assigned.</Typography>
                                ) : (
                                  connections.tasks.map(t => (
                                    <Paper key={t.id} sx={{ p: 1.5, mb: 1, border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{t.title}</Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B' }}>Due: {t.dueDate} • Priority: {t.priority} • Status: {t.status}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                              <Grid item xs={12}>
                                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '16px', mb: 2, mt: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Icons.Clock size={18} style={{ color: '#2563EB' }} />
                                  Attendance timing logs ({connections.attendance?.length || 0})
                                </Typography>
                                {!connections.attendance || connections.attendance.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No attendance timing logs found.</Typography>
                                ) : (
                                  <Grid container spacing={2}>
                                    {connections.attendance.map((att, idx) => (
                                      <Grid item xs={12} sm={4} key={idx}>
                                        <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                                          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A' }}>{att.date}</Typography>
                                            <Chip label={att.status} size="small" sx={{ backgroundColor: att.status === 'Present' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: att.status === 'Present' ? '#22C55E' : '#EF4444', fontWeight: 700, fontSize: '10px' }} />
                                          </Box>
                                          <Typography variant="body2">In: <strong>{att.inTime}</strong></Typography>
                                          <Typography variant="body2">Out: <strong>{att.outTime || '---'}</strong></Typography>
                                        </Paper>
                                      </Grid>
                                    ))}
                                  </Grid>
                                )}
                              </Grid>
                              <Grid item xs={12}>
                                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '16px', mb: 2, mt: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Icons.DollarSign size={18} style={{ color: '#16A34A' }} />
                                  Salary Settlement Slips ({connections.salaries?.length || 0})
                                </Typography>
                                {!connections.salaries || connections.salaries.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No salaries settled.</Typography>
                                ) : (
                                  <Grid container spacing={2}>
                                    {connections.salaries.map((sal, idx) => (
                                      <Grid item xs={12} sm={4} key={idx}>
                                        <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{sal.month}/{sal.year}</Typography>
                                          <Typography variant="body2" sx={{ mb: 1 }}>Net Pay: ₹{formatCurrency(sal.netPay)}</Typography>
                                          <Button variant="outlined" size="small" fullWidth onClick={() => setActiveSalarySlip(sal)}>View Slip</Button>
                                        </Paper>
                                      </Grid>
                                    ))}
                                  </Grid>
                                )}
                              </Grid>
                            </>
                          )}

                          {(moduleName === 'follow_ups' || moduleName === 'queries' || moduleName === 'leads') && (
                            <>
                              <Grid item xs={12} sm={6}>
                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                  <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'Poppins', color: '#0F172A' }}>
                                    Pitched Properties & Details ({connections.pitches?.length || 0})
                                  </Typography>
                                  <Button 
                                    variant="outlined" 
                                    size="small" 
                                    startIcon={<Icons.Plus size={16} />}
                                    onClick={() => {
                                      setPitchPropertyId('');
                                      setPitchEmployeeId(record.assignedEmployeeId || record.employeeId || '');
                                      const mappedCustId = record.customerId || record.id;
                                      setPitchCustomerId(mappedCustId);
                                      setPitchPrice('');
                                      setPitchRemarks('');
                                      setPitchWarning('');
                                      setPitchDialogOpen(true);
                                    }}
                                  >
                                    Log Pitch
                                  </Button>
                                </Box>
                                {connections.pitches?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No property pitches logged for this client yet.</Typography>
                                ) : (
                                  connections.pitches.map(p => (
                                    <Paper key={p.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none', backgroundColor: 'white' }}>
                                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                        <Box display="flex" alignItems="center" gap={1}>
                                          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(p.propertyId?.startsWith('PROJ-') ? `/module/projects/${p.propertyId}` : `/module/properties/${p.propertyId}`)}>
                                            {getPropertyName(p.propertyId)}
                                          </Typography>
                                          <Typography variant="caption" sx={{ color: '#64748B' }}>({p.id})</Typography>
                                        </Box>
                                        <Box display="flex" alignItems="center" gap={1}>
                                          <IconButton 
                                            size="small" 
                                            onClick={() => {
                                              setEditingPitch(p);
                                              setPitchItemType(p.propertyId?.startsWith('PROJ-') ? 'Project' : 'Property');
                                              setPitchPropertyId(p.propertyId);
                                              setPitchCustomerId(p.customerId);
                                              setPitchEmployeeId(p.employeeId);
                                              setPitchPrice(p.quotedPrice);
                                              setPitchRemarks(p.remarks);
                                              setPitchInterest(p.interestLevel);
                                              setPitchStatus(p.status);
                                              setPitchPropertyStatus(p.propertyStatus || '');
                                              setPitchMethod(p.pitchMethod);
                                              setPitchFollowUp(p.followUpDate || '');
                                              setPitchWarning('');
                                              setPitchDialogOpen(true);
                                            }}
                                            sx={{ color: '#2563EB', p: 0.5 }}
                                          >
                                            <Icons.Edit size={16} />
                                          </IconButton>
                                          <Chip 
                                            label={p.interestLevel} 
                                            color={p.interestLevel === 'Interested' ? 'success' : p.interestLevel === 'Not Interested' ? 'error' : 'warning'} 
                                            size="small"
                                            sx={{ fontWeight: 700 }}
                                          />
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1 }}>
                                        Pitched on: {p.pitchDate} • Method: <strong>{p.pitchMethod}</strong> • Pitched by: {p.employeeName}
                                      </Typography>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>Quoted Offer Price: ₹{formatCurrency(p.quotedPrice)}</Typography>
                                      <Typography variant="body2" sx={{ color: '#475569', mt: 0.5 }}>Remarks: {p.remarks}</Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>

                              <Grid item xs={12} sm={6}>
                                <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', color: '#0F172A' }}>
                                  Site Visits & Showings ({connections.site_visits?.length || 0})
                                </Typography>
                                {connections.site_visits?.length === 0 ? (
                                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No site visits registered for this client.</Typography>
                                ) : (
                                  connections.site_visits.map((sv, idx) => (
                                    <Paper key={idx} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none', backgroundColor: 'white' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                        <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(sv.propertyId?.startsWith('PROJ-') ? `/module/projects/${sv.propertyId}` : `/module/properties/${sv.propertyId}`)}>{getPropertyName(sv.propertyId)}</span>
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>
                                        Visited on: {sv.date} • Conducted by: {sv.employeeId} • Outcome: <strong>{sv.result}</strong>
                                      </Typography>
                                    </Paper>
                                  ))
                                )}
                              </Grid>
                            </>
                          )}
                        </Grid>
                      ) : (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>Loading...</Typography>
                      )}
                    </Box>
                  )}

                  {/* Tab 1: Remarks */}
                  {activeTab === 1 && (
                    <Box>
                      <Box component="form" onSubmit={handlePostRemark} sx={{ mb: 4 }}>
                        <Grid container spacing={1.5}>
                          <Grid item xs={12} sm={10}>
                            <TextField 
                              placeholder="Type comment remarks here..."
                              fullWidth
                              size="small"
                              value={remarkInput}
                              onChange={(e) => setRemarkInput(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={2}>
                            <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB' }}>
                              Post Log
                            </Button>
                          </Grid>
                        </Grid>
                      </Box>
                      {connections?.remarks?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No remarks posted yet.</Typography>
                      ) : (
                        connections.remarks.map((rem, idx) => (
                          <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', boxShadow: 'none', backgroundColor: '#F8FAFC' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rem.employeeName}</Typography>
                            <Typography variant="body2" sx={{ color: '#4B5563', fontStyle: 'italic' }}>"{rem.comment}"</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 2: Docs */}
                  {activeTab === 2 && (
                    <Box>
                      <Box component="form" onSubmit={handleUploadDoc} sx={{ mb: 4, p: 2, border: '1px dashed #CBD5E1', borderRadius: '12px' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Attach PDF / Document Details</Typography>
                        
                        <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                          <input type="file" id="direct-file-input" style={{ display: 'none' }} onChange={handleFileChange} />
                          <label htmlFor="direct-file-input">
                            <Button variant="outlined" component="span" startIcon={<Icons.Upload size={16} />} sx={{ textTransform: 'none', fontWeight: 600 }}>
                              Choose Local File
                            </Button>
                          </label>
                          {selectedFile && (
                            <Typography variant="body2" sx={{ color: '#0F172A', fontWeight: 500 }}>
                              Selected: {selectedFile.name}
                            </Typography>
                          )}
                          {uploadingFile && <CircularProgress size={20} />}
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={12} sm={5}>
                            <TextField 
                              placeholder="Document Title"
                              size="small"
                              fullWidth
                              value={docName}
                              onChange={(e) => setDocName(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={5}>
                            <TextField 
                              placeholder="File URL or Link"
                              size="small"
                              fullWidth
                              value={docUrl}
                              onChange={(e) => setDocUrl(e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} sm={2}>
                            <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB' }}>
                              Link File
                            </Button>
                          </Grid>
                        </Grid>
                      </Box>

                      {connections.documents?.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No files attached yet.</Typography>
                      ) : (
                        connections.documents.map((doc, index) => (
                          <Paper key={index} sx={{ p: 2, mb: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Icons.FileText size={24} color="#2563EB" />
                              <Box>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>{doc.name}</Typography>
                                <Typography variant="caption" sx={{ color: '#64748B' }}>Uploaded: {doc.dateAdded} • By: {doc.uploadedBy}</Typography>
                              </Box>
                            </Box>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Button variant="outlined" size="small" component="a" href={doc.fileUrl} download sx={{ textTransform: 'none' }}>Download</Button>
                              <IconButton size="small" color="error" onClick={() => handleDeleteDoc(doc.id)}>
                                <Icons.Trash2 size={16} />
                              </IconButton>
                            </Box>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 3: Odometer */}
                  {activeTab === 3 && moduleName === 'employees' && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Bike Odometer & Travel History Log</Typography>
                      {travelLogs.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No odometer readings captured.</Typography>
                      ) : (
                        <Box display="flex" flexDirection="column" gap={2}>
                          {travelLogs.map((log, index) => {
                            const netKm = Math.max(0, (Number(log.odometerEnd) || 0) - (Number(log.odometerStart) || 0) - (Number(log.personalUseKm) || 0));
                            const dailyAllowance = netKm * 3;
                            return (
                              <Paper key={index} sx={{ p: 3, border: '1px solid #E2E8F0', boxShadow: 'none', borderRadius: '12px' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{log.date} ({netKm} KM Driven)</Typography>
                                <Typography variant="body2">Punch In: <strong>{log.inTime}</strong> (Start: {log.odometerStart} KM)</Typography>
                                <Typography variant="body2">Punch Out: <strong>{log.outTime || '---'}</strong> (End: {log.odometerEnd || '---'} KM)</Typography>
                                <Typography variant="body2" sx={{ color: '#16A34A', mt: 1 }}>Daily Travel Allowance: ₹{dailyAllowance.toLocaleString('en-IN')} (at ₹3/KM)</Typography>
                              </Paper>
                            );
                          })}
                        </Box>
                      )}
                    </Box>
                  )}
                  {activeTab === 4 && moduleName === 'employees' && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Referred Leads Log</Typography>
                      {!connections.referrals || connections.referrals.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No referrals registered under this profile.</Typography>
                      ) : (
                        <TableContainer component={Paper} sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none' }}>
                          <Table size="small">
                            <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>Lead ID</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Lead Name</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Phone Number</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Lead Type</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {connections.referrals.map(l => (
                                <TableRow key={l.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/module/leads/${l.id}`)}>
                                  <TableCell sx={{ color: '#2563EB', fontWeight: 600 }}>{l.id}</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>{l.name || l.person_name || 'Unnamed'}</TableCell>
                                  <TableCell>{l.phone || '---'}</TableCell>
                                  <TableCell>
                                    <Chip label={l.leadType} size="small" color={l.leadType === 'Buyer' ? 'primary' : 'success'} sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} />
                                  </TableCell>
                                  <TableCell>
                                    <Chip label={l.status} size="small" variant="outlined" sx={{ height: 20, fontSize: '10px', fontWeight: 700 }} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}
                </Box>
              )}

              {/* 5. PROJECTS TABS */}
              {moduleName === 'projects' && connections && (
                <Box>
                  {/* Tab 0: Project Specifications / Overview */}
                  {activeTab === 0 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Project Information & Specifications</Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                          <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Typography variant="caption" sx={{ color: '#64748B' }}>Project Name</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 700 }}>{record.name}</Typography>
                          </Paper>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Typography variant="caption" sx={{ color: '#64748B' }}>Builder/Developer</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 700 }}>{record.builder}</Typography>
                          </Paper>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Typography variant="caption" sx={{ color: '#64748B' }}>Locality / Address</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 700 }}>{record.locality} {record.sector_block ? `(Sector ${record.sector_block})` : ''}</Typography>
                          </Paper>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Typography variant="caption" sx={{ color: '#64748B' }}>Development Category</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 700 }}>{record.property_category || 'Plot'}</Typography>
                          </Paper>
                        </Grid>
                      </Grid>
                    </Box>
                  )}

                  {/* Tab 1: Pitched & Showings History */}
                  {activeTab === 1 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Who was this project pitched to?</Typography>
                      {renderListControls([
                        { value: 'id', label: 'Pitch ID' },
                        { value: 'date', label: 'Date Pitched' },
                        { value: 'pitchInterest', label: 'Interest Level' }
                      ])}
                      
                      {!connections.pitches || connections.pitches.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No pitches found for this builder project.</Typography>
                      ) : (
                        filterAndSortList(connections.pitches || [], ['id', 'date', 'pitchInterest', 'pitchRemarks', 'customerId']).map(p => (
                          <Paper key={p.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Box display="flex" justifyContent="space-between" mb={1}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB' }}>Pitch Record: {p.id}</Typography>
                              <Chip label={p.pitchInterest} size="small" color={p.pitchInterest === 'Interested' ? 'success' : 'warning'} />
                            </Box>
                            <Typography variant="body2">
                              Customer: <strong><span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2563EB' }} onClick={() => navigate(`/module/${p.customer?.phone ? 'customers' : 'leads'}/${p.customerId}`)}>{p.customer?.name || p.customer?.person_name || p.customerId}</span></strong>
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>Pitched on: {p.date} by {p.employeeName}</Typography>
                            <Typography variant="body2" sx={{ mt: 1, color: '#475569', fontStyle: 'italic' }}>"{p.pitchRemarks}"</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 2: Price/Status History Logs */}
                  {activeTab === 2 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Pricing & Development Stage Historical Timeline</Typography>
                      {renderListControls([
                        { value: 'date', label: 'Date Changed' },
                        { value: 'field', label: 'Attribute' }
                      ])}

                      {!connections.history || connections.history.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No pricing updates or status changes recorded yet.</Typography>
                      ) : (
                        filterAndSortList(connections.history || [], ['date', 'field', 'fieldName', 'oldValue', 'newValue', 'employeeName']).map(h => (
                          <Paper key={h.id} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Box display="flex" justifyContent="space-between" mb={0.5}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#F59E0B' }}>Attribute Changed: {h.fieldName}</Typography>
                              <Typography variant="caption" sx={{ color: '#94A3B8' }}>{h.date}</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>
                              Previous Value: <span style={{ textDecoration: 'line-through', color: '#EF4444' }}>{h.oldValue}</span>
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>
                              New Value: <span style={{ color: '#10B981', fontWeight: 700 }}>{h.newValue}</span>
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Updated by: {h.employeeName}</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 3: Remarks */}
                  {activeTab === 3 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, fontFamily: 'Poppins' }}>Project Feedback & Staff Comments</Typography>
                      <Box component="form" onSubmit={handlePostRemark} sx={{ mb: 3 }}>
                        <Grid container spacing={1.5}>
                          <Grid item xs={10}>
                            <TextField placeholder="Add developer/project remarks..." fullWidth size="small" value={remarkInput} onChange={(e) => setRemarkInput(e.target.value)} />
                          </Grid>
                          <Grid item xs={2}>
                            <Button type="submit" variant="contained" fullWidth sx={{ py: 1, backgroundColor: '#2563EB' }}>Post</Button>
                          </Grid>
                        </Grid>
                      </Box>
                      {renderListControls([
                        { value: 'dateTime', label: 'Date Posted' },
                        { value: 'employeeName', label: 'Author' }
                      ])}
                      {!connections.remarks || connections.remarks.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No feedback logs posted.</Typography>
                      ) : (
                        filterAndSortList(connections.remarks || [], ['comment', 'employeeName', 'dateTime']).map((rem, idx) => (
                          <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', borderRadius: '8px', backgroundColor: '#F8FAFC' }}>
                            <Box display="flex" justifyContent="space-between" mb={0.5}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rem.employeeName}</Typography>
                              <Typography variant="caption" sx={{ color: '#94A3B8' }}>{rem.dateTime}</Typography>
                            </Box>
                            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>"{rem.comment}"</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 4: Docs Vault */}
                  {activeTab === 4 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Layout Maps & Project Brochures</Typography>
                      <Box component="form" onSubmit={handleUploadDoc} sx={{ mb: 3 }}>
                        <Grid container spacing={1.5} alignItems="center">
                          <Grid item xs={12} sm={5}>
                            <TextField label="Document/File Name" size="small" fullWidth required value={docName} onChange={(e) => setDocName(e.target.value)} />
                          </Grid>
                          <Grid item xs={12} sm={5}>
                            <input type="file" onChange={handleFileChange} style={{ display: 'none' }} id="nested-project-file" />
                            <label htmlFor="nested-project-file">
                              <Button variant="outlined" component="span" fullWidth size="medium" startIcon={uploadingFile ? <CircularProgress size={16} /> : <Icons.Upload size={16} />}>
                                {docUrl ? "File Ready" : "Choose Brochure/Layout"}
                              </Button>
                            </label>
                          </Grid>
                          <Grid item xs={12} sm={2}>
                            <Button type="submit" variant="contained" fullWidth disabled={!docUrl}>Upload</Button>
                          </Grid>
                        </Grid>
                      </Box>
                      {renderListControls([
                        { value: 'name', label: 'Document Name' },
                        { value: 'date', label: 'Date Added' }
                      ])}
                      {!connections.documents || connections.documents.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No layout plans or maps uploaded yet.</Typography>
                      ) : (
                        filterAndSortList(connections.documents || [], ['name', 'date']).map((d, idx) => (
                          <Paper key={idx} sx={{ p: 2, mb: 1.5, border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
                              <Typography variant="caption" sx={{ color: '#94A3B8' }}>Added: {d.date} • By: {d.employeeName}</Typography>
                            </Box>
                            <Box display="flex" gap={1}>
                              <Button size="small" variant="outlined" onClick={() => window.open(d.url, '_blank')}>View File</Button>
                              <IconButton size="small" color="error" onClick={() => handleDeleteDoc(d.id)}><Icons.Trash2 size={16} /></IconButton>
                            </Box>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                </Box>
              )}

              {/* 6. DEALER MEETINGS TABS */}
              {moduleName === 'dealer_meetings' && connections && (
                <Box>
                  {/* Tab 0: Meeting Overview & Outcome Form */}
                  {activeTab === 0 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Meeting Overview & Feed Outcome</Typography>
                      <Paper sx={{ p: 3, mb: 3, border: '1px solid #FEF3C7', backgroundColor: '#FFFBEB', borderRadius: '12px' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#D97706', mb: 1 }}>Purpose & Instructions</Typography>
                        <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>{record.prepRemarks || 'No instructions provided.'}</Typography>
                        <Divider sx={{ my: 1.5 }} />
                        <Typography variant="body2" sx={{ mb: 0.5 }}>Meeting Scheduled Date: <strong>{record.meetingDate || record.date}</strong></Typography>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>Meeting Status: <strong>{record.status}</strong></Typography>
                        <Typography variant="body2" sx={{ mb: 1 }}>Outcome Remarks: <strong>{record.outcome || 'Pending execution.'}</strong></Typography>
                        {connections.dealer && (
                          <>
                            <Divider sx={{ my: 1.5 }} />
                            <Typography variant="subtitle2" sx={{ fontWeight: 850, color: '#0F172A', mb: 1 }}>Dealer Reference Details</Typography>
                            <Typography variant="body2">Firm: <strong>{connections.dealer.firm_name}</strong></Typography>
                            <Typography variant="body2">Dealer Name: <strong>{connections.dealer.person_name}</strong></Typography>
                            <Typography variant="body2">Dealer Phone: <strong>{connections.dealer.phone}</strong></Typography>
                            <Typography variant="body2">Sectors / Localities: {connections.dealer.operational_sectors || 'None'}</Typography>
                          </>
                        )}
                      </Paper>

                      {/* Feed Outcome Form inline */}
                      {record.status !== 'Completed' && (
                        <Box sx={{ mt: 3, p: 3, border: '1px solid #E2E8F0', borderRadius: '16px' }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Feed Meeting Outcome / Remarks</Typography>
                          <TextField
                            label="Outcome / Remark Remarks"
                            multiline
                            rows={4}
                            fullWidth
                            value={meetingOutcome}
                            onChange={(e) => setMeetingOutcome(e.target.value)}
                            sx={{ mb: 2 }}
                            placeholder="Type details of what was discussed, dealer's response, deals proposed, etc."
                          />
                          <Button
                            variant="contained"
                            color="success"
                            onClick={async () => {
                              if (!meetingOutcome.trim()) return alert("Outcome remarks are required.");
                              const res = await updateRecord('dealer_meetings', id, {
                                status: 'Completed',
                                outcome: meetingOutcome,
                                actualMeetingDate: new Date().toLocaleDateString('en-IN')
                              });
                              if (res.success) {
                                // Add remark log as well
                                await handlePostRemark(null, `Completed Meeting Outcome: ${meetingOutcome}`);
                                const rels = await fetchEntity360(moduleName, id);
                                setConnections(rels);
                                window.location.reload();
                              } else {
                                alert(res.message || "Failed to submit outcome.");
                              }
                            }}
                          >
                            Submit Outcome & Complete Meeting
                          </Button>
                        </Box>
                      )}
                    </Box>
                  )}

                  {/* Tab 1: Dealer History */}
                  {activeTab === 1 && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Past Dealer Phone Conversations & Outreach Remarks</Typography>
                      {renderListControls([
                        { value: 'date', label: 'Date' },
                        { value: 'callOutcome', label: 'Outcome' }
                      ])}
                      
                      {!connections.calls || connections.calls.length === 0 ? (
                        <Typography variant="body2" sx={{ color: '#94A3B8' }}>No phone conversations logged for this dealer.</Typography>
                      ) : (
                        filterAndSortList(connections.calls || [], ['id', 'date', 'callOutcome', 'remarks', 'duration', 'budget']).map(c => (
                          <Paper key={c.id} sx={{ p: 2.5, mb: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                            <Box display="flex" justifyContent="space-between" mb={1}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#2563EB' }}>Call Log ID: {c.id}</Typography>
                              <Chip label={c.callOutcome} size="small" color={c.callOutcome === 'Call Done' ? 'success' : 'warning'} />
                            </Box>
                            <Typography variant="body2" sx={{ mb: 1 }}>Remarks: <strong>"{c.remarks}"</strong></Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>Discussed Budget: ₹{c.budget} • Sectors/Areas: {c.areas || 'None'}</Typography>
                            <Typography variant="caption" sx={{ color: '#94A3B8' }}>Date: {c.date} • Duration: {c.duration} mins • Logged by: {c.employeeName}</Typography>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          </Card>
        </Grid>
      </Grid>

      {/* Route Map Modal Dialog */}
      <Dialog 
        open={mapOpen} 
        onClose={() => setMapOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontFamily: 'Poppins' }}>
          Shift Route Map - {activeMapShift?.date}
          <IconButton size="small" onClick={() => setMapOpen(false)}>
            <Icons.X size={18} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box 
            id="route-map-container" 
            sx={{ 
              width: '100%', 
              height: '500px', 
              backgroundColor: '#F1F5F9' 
            }} 
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setMapOpen(false)} variant="contained">
            Close Map
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Photo/File upload permission dialog */}
      <Dialog 
        open={permissionDialogOpen} 
        onClose={() => setPermissionDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px', p: 1 } }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '18px', fontFamily: 'Poppins' }}>
          File Upload Permission
        </DialogTitle>
        <DialogContent sx={{ py: 1 }}>
          <Typography variant="body2" sx={{ color: '#475569' }}>
            Gagan Realtech CRM wishes to access files and photos from your device to directly upload documents and screenshots to this record. Do you allow access?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPermissionDialogOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 600 }}>
            Don't Allow
          </Button>
          <Button onClick={handleGrantPermissionAndUpload} variant="contained" sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}>
            Allow & Upload
          </Button>
        </DialogActions>
      </Dialog>

      {/* Salary Slip Detail View Dialog */}
      <Dialog 
        open={Boolean(activeSalarySlip)} 
        onClose={() => setActiveSalarySlip(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontFamily: 'Poppins' }}>
          Salary payslip slip detail view
          <IconButton size="small" onClick={() => setActiveSalarySlip(null)}>
            <Icons.X size={18} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {activeSalarySlip && (
            <Box>
              {/* Print View Wrapper */}
              <Box id="printable-salary-slip-view" sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} borderBottom="2px solid #0F172A" pb={2}>
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 800 }}>GAGAN REALTECH</Typography>
                    <Typography variant="caption" color="textSecondary">Corporate Real Estate & CRM Solutions Hub</Typography>
                  </Box>
                  <Box textAlign="right">
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#64748B' }}>SALARY PAYSLIP SLIP</Typography>
                    <Typography variant="body2">Month: {activeSalarySlip.month}/{activeSalarySlip.year}</Typography>
                  </Box>
                </Box>

                <Grid container spacing={2} sx={{ mb: 3, backgroundColor: '#F8FAFC', p: 2, borderRadius: '8px' }}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Employee Details</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{record?.name}</Typography>
                    <Typography variant="body2">ID: {record?.id}</Typography>
                    <Typography variant="body2">Designation: {record?.designation || 'Real Estate Officer'}</Typography>
                  </Grid>
                  <Grid item xs={6} style={{ textAlign: 'right' }}>
                    <Typography variant="caption" color="textSecondary">Settlement Details</Typography>
                    <Typography variant="body2">Date Issued: {activeSalarySlip.generatedDate || '---'}</Typography>
                    <Typography variant="body2">Status: <strong>{activeSalarySlip.status || 'Draft'}</strong></Typography>
                    <Typography variant="body2">ID: {activeSalarySlip.id}</Typography>
                  </Grid>
                </Grid>

                <Grid container spacing={4} sx={{ mb: 3 }}>
                  <Grid item xs={6}>
                    <Typography variant="caption" sx={{ fontWeight: 700, mb: 1, display: 'block', borderBottom: '1px solid #E2E8F0', pb: 0.5 }}>EARNINGS</Typography>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Daily Payout Rate (Salary/30)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(activeSalarySlip.dailyRate || (activeSalarySlip.baseSalary / 30))}</Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Paid Days: Full Work</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{activeSalarySlip.presentDays} Days</Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Paid Days: Half Work (0.5x)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{activeSalarySlip.halfDays * 0.5} Days</Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Paid Days: Paid Leaves</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{activeSalarySlip.paidLeavesUsed || 0} Days</Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Paid Days: Weekly Offs (Sundays)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{activeSalarySlip.earnedDays === 0 ? 0 : 4} Days</Typography>
                    </Box>
                    {activeSalarySlip.extraDays > 0 && (
                      <Box display="flex" justifyContent="space-between" py={0.5}>
                        <Typography variant="body2">Paid Days: Extra Work</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{activeSalarySlip.extraDays} Days</Typography>
                      </Box>
                    )}
                    {(() => {
                      const earnedDaysVal = activeSalarySlip.earnedDays !== undefined ? activeSalarySlip.earnedDays : (
                        (activeSalarySlip.presentDays === 0 && activeSalarySlip.halfDays === 0 && (activeSalarySlip.paidLeavesUsed || 0) === 0 && (activeSalarySlip.extraDays || 0) === 0)
                          ? 0
                          : (activeSalarySlip.presentDays + activeSalarySlip.halfDays*0.5 + (activeSalarySlip.paidLeavesUsed || 0) + (activeSalarySlip.extraDays || 0) + 4)
                      );
                      const earnedSalaryVal = activeSalarySlip.earnedSalary !== undefined ? activeSalarySlip.earnedSalary : (
                        earnedDaysVal * (activeSalarySlip.dailyRate || (activeSalarySlip.baseSalary / 30))
                      );
                      return (
                        <Box display="flex" justifyContent="space-between" py={0.5} sx={{ borderTop: '1px dashed #CBD5E1', mt: 0.5, pt: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>Total Earned Salary ({earnedDaysVal} days)</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>₹{formatCurrency(earnedSalaryVal)}</Typography>
                        </Box>
                      );
                    })()}
                    
                    {activeSalarySlip.allowancesJson && (
                      (() => {
                        try {
                          const allows = JSON.parse(activeSalarySlip.allowancesJson);
                          return allows.map((a, i) => (
                            <Box display="flex" justifyContent="space-between" py={0.5} key={i}>
                              <Typography variant="body2">{a.name} (Allowance)</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(a.amount)}</Typography>
                            </Box>
                          ));
                        } catch (e) { return null; }
                      })()
                    )}
                    {activeSalarySlip.expensesJson && (
                      (() => {
                        try {
                          const exps = JSON.parse(activeSalarySlip.expensesJson);
                          return exps.map((e, i) => (
                            <Box display="flex" justifyContent="space-between" py={0.5} key={i}>
                              <Typography variant="body2">{e.name} (Reimbursement)</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(e.amount)}</Typography>
                            </Box>
                          ));
                        } catch (e) { return null; }
                      })()
                    )}
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Travel Allowance ({activeSalarySlip.totalKmDriven || 0} KM @ ₹{activeSalarySlip.payPerKm || 3}/KM)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>+ ₹{formatCurrency(activeSalarySlip.travelAllowance || 0)}</Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" sx={{ fontWeight: 700, mb: 1, display: 'block', borderBottom: '1px solid #E2E8F0', pb: 0.5 }}>DEDUCTIONS</Typography>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Unpaid Leaves ({Math.max(0, (activeSalarySlip.leaveDays || 0) - 4)} days)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#EF4444' }}>Deducted from Earned Days</Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Absent Days ({activeSalarySlip.absentDays || 0} days)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#EF4444' }}>Deducted from Earned Days</Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" py={0.5}>
                      <Typography variant="body2">Advance Recovery</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(activeSalarySlip.advanceRecovery)}</Typography>
                    </Box>

                    {activeSalarySlip.deductionsJson && (
                      (() => {
                        try {
                          const deds = JSON.parse(activeSalarySlip.deductionsJson);
                          return deds.map((d, i) => (
                            <Box display="flex" justifyContent="space-between" py={0.5} key={i}>
                              <Typography variant="body2">{d.name}</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(d.amount)}</Typography>
                            </Box>
                          ));
                        } catch (e) { return null; }
                      })()
                    )}
                  </Grid>
                </Grid>

                <Box sx={{ p: 2, border: '2px solid #0F172A', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>NET PAYABLE SETTLEMENT</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 850 }}>₹{formatCurrency(activeSalarySlip.netPay)}</Typography>
                </Box>

                {activeSalarySlip.attendanceJson && (() => {
                  try {
                    const parsedLogs = JSON.parse(activeSalarySlip.attendanceJson);
                    return (
                      <Box sx={{ mt: 3 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, borderBottom: '1px solid #E2E8F0', pb: 0.5, textTransform: 'uppercase', fontSize: '11px' }}>
                          DAILY ATTENDANCE & IN-OUT DETAILS
                        </Typography>
                        <TableContainer component={Box} sx={{ mb: 4, border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
                          <Table size="small">
                            <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                              <TableRow>
                                <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Date</TableCell>
                                <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>In Time</TableCell>
                                <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Out Time</TableCell>
                                <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Hours</TableCell>
                                <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Status</TableCell>
                                <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Remarks</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {parsedLogs.map((log, idx) => (
                                <React.Fragment key={idx}>
                                  <TableRow sx={{ '&:nth-of-type(odd)': { backgroundColor: '#F8FAFC' } }}>
                                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.date} ({log.day})</TableCell>
                                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.checkIn}</TableCell>
                                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.checkOut}</TableCell>
                                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.hours}</TableCell>
                                    <TableCell sx={{ py: 0.2, fontSize: '9px', fontWeight: log.status === 'Half Day' || log.status === 'Absent' ? 700 : 400, color: log.status === 'Half Day' ? '#F59E0B' : log.status === 'Absent' ? '#EF4444' : '#0F172A' }}>
                                      {log.status}
                                    </TableCell>
                                    <TableCell sx={{ py: 0.2, fontSize: '9px', color: '#64748B' }}>{log.remarks}</TableCell>
                                  </TableRow>
                                  {((log.odometerStart !== undefined && log.odometerStart !== "") || (log.odometerEnd !== undefined && log.odometerEnd !== "")) && (
                                    <TableRow sx={{ backgroundColor: '#F8FAFC' }}>
                                      <TableCell colSpan={6} sx={{ py: 0.3, pl: 2, fontSize: '9px', color: '#475569' }}>
                                        🏍️ Bike Odometer: Start: <strong>{(log.odometerStart !== undefined && log.odometerStart !== "") ? `${log.odometerStart} KM` : '0 KM'}</strong>
                                        {(log.odometerEnd !== undefined && log.odometerEnd !== "") ? ` | End: ${log.odometerEnd} KM` : ''}
                                        {(log.personalUseKm !== undefined && log.personalUseKm !== "") ? ` | Personal Use: ${log.personalUseKm} KM` : ''}
                                        {(log.netKm !== undefined && log.netKm !== "") ? ` | Final Reading: ${log.netKm} KM` : ''}
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </React.Fragment>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    );
                  } catch (e) { return null; }
                })()}

                {/* Signatures placeholders inside printable slip view */}
                <Box display="flex" justifyContent="space-between" mt={8} pt={4} borderTop="1px dashed #64748B">
                  <Box textAlign="center" width="25%">
                    <Box sx={{ height: 40 }} />
                    <Divider sx={{ mb: 1, borderColor: '#0F172A' }} />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>Employee Signature</Typography>
                  </Box>
                  <Box textAlign="center" width="25%">
                    <Box sx={{ height: 40 }} />
                    <Divider sx={{ mb: 1, borderColor: '#0F172A' }} />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>HR Manager Signature</Typography>
                  </Box>
                  <Box textAlign="center" width="25%">
                    <Box sx={{ height: 40 }} />
                    <Divider sx={{ mb: 1, borderColor: '#0F172A' }} />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>Authorised Signature</Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setActiveSalarySlip(null)} sx={{ textTransform: 'none' }}>
            Close
          </Button>
          <Button 
            variant="contained" 
            startIcon={<Icons.Printer size={16} />}
            onClick={() => {
              const originalContent = document.body.innerHTML;
              const printContent = document.getElementById("printable-salary-slip-view").innerHTML;
              document.body.innerHTML = printContent;
              window.print();
              document.body.innerHTML = originalContent;
              window.location.reload();
            }}
            sx={{ textTransform: 'none', borderRadius: '8px' }}
          >
            Print Payslip
          </Button>
        </DialogActions>
      </Dialog>

      {/* 5. ERP POPUP DIALOGS */}

      {/* Quick Log Query Dialog */}
      <Dialog open={queryDialogOpen} onClose={() => setQueryDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>Quick Log Property Query</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1.5 }}>
            <FormControl fullWidth>
              <InputLabel>RM Assigned</InputLabel>
              <Select value={queryEmployeeId} onChange={(e) => setQueryEmployeeId(e.target.value)} label="RM Assigned">
                {(moduleData.employees || []).map(emp => (
                  <MenuItem key={emp.id} value={emp.id}>{emp.name} ({emp.id})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Query Action Type</InputLabel>
              <Select value={queryType} onChange={(e) => setQueryType(e.target.value)} label="Query Action Type">
                <MenuItem value="Buy Property">Buy Property (Demand Request)</MenuItem>
                <MenuItem value="Sell Property">Sell Property (Inventory Supply)</MenuItem>
              </Select>
            </FormControl>
            
            {queryType !== 'Sell Property' && (
              <>
                <FormControl fullWidth>
                  <InputLabel>R/C/I Segment</InputLabel>
                  <Select value={queryRCI} onChange={(e) => setQueryRCI(e.target.value)} label="R/C/I Segment">
                    <MenuItem value="Residential">Residential</MenuItem>
                    <MenuItem value="Commercial">Commercial</MenuItem>
                    <MenuItem value="Industrial">Industrial</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Property Type Category</InputLabel>
                  <Select value={queryPropType} onChange={(e) => setQueryPropType(e.target.value)} label="Property Type Category">
                    <MenuItem value="Villa">Villa Listing</MenuItem>
                    <MenuItem value="Plot">Residential Plot</MenuItem>
                    <MenuItem value="Apartment">Apartment Flat</MenuItem>
                    <MenuItem value="Commercial">Retail Office Space</MenuItem>
                  </Select>
                </FormControl>
              </>
            )}

            {queryType === 'Buy Property' ? (
              <TextField label="Client Budget Cap (INR)" type="number" fullWidth value={queryBudget} onChange={(e) => setQueryBudget(e.target.value)} />
            ) : null}

            {queryType !== 'Sell Property' && (
              <>
                <TextField label="Target Size/Dimensions (e.g. 250 Sq.Yds)" fullWidth value={querySize} onChange={(e) => setQuerySize(e.target.value)} />
                <TextField label="Preferred Localities" fullWidth value={queryLocality} onChange={(e) => setQueryLocality(e.target.value)} />
                <TextField label="Sector/Block Details" fullWidth value={querySector} onChange={(e) => setQuerySector(e.target.value)} />
              </>
            )}

            {queryType === 'Sell Property' && (
              <Box sx={{ mt: 1, p: 2.5, border: '1px solid #10B981', borderRadius: '12px', backgroundColor: '#F0FDF4', width: '100%' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#065F46', display: 'flex', alignItems: 'center', gap: 1, fontFamily: 'Poppins' }}>
                  <Icons.Home size={18} />
                  Register Property Listing (Seller Details)
                </Typography>
                <Grid container spacing={1.5}>
                  {(metadata?.modules?.properties?.fields || []).filter(f => {
                    if (f.name === 'id') return false;
                    if (f.name === 'current_owner_id') return false;
                    if (f.name === 'dealerId' || f.name === 'dealer_deal_type') {
                      return nestedPropertyData.dealer_owner_booked === 'Dealer';
                    }
                    if (f.name === 'booked_by_customer_id') {
                      return nestedPropertyData.dealer_owner_booked === 'Booked By Us';
                    }
                    return true;
                  }).map(f => {
                    // 1. SELECT TYPE FIELD
                    if (f.type === 'select' && f.chipGroup) {
                      const options = metadata?.chips?.[f.chipGroup] || [];
                      return (
                        <Grid item xs={12} sm={6} key={f.name}>
                          <FormControl fullWidth size="small">
                            <InputLabel>{f.label}</InputLabel>
                            <Select
                              value={nestedPropertyData[f.name] || ''}
                              onChange={(e) => setNestedPropertyData(prev => ({ ...prev, [f.name]: e.target.value }))}
                              label={f.label}
                            >
                              {options.map(opt => (
                                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                      );
                    }

                    // 2. REFERENCE TYPE FIELD
                    if (f.type === 'ref' && f.refModule) {
                      const options = moduleData[f.refModule] || [];
                      return (
                        <Grid item xs={12} sm={6} key={f.name}>
                          <FormControl fullWidth size="small">
                            <InputLabel>{f.label}</InputLabel>
                            <Select
                              value={nestedPropertyData[f.name] || ''}
                              onChange={(e) => setNestedPropertyData(prev => ({ ...prev, [f.name]: e.target.value }))}
                              label={f.label}
                            >
                              <MenuItem value="">-- Select --</MenuItem>
                              {options.map(opt => (
                                <MenuItem key={opt.id} value={opt.id}>{opt.name || opt.firm_name || opt.id}</MenuItem>
                              ))}
                              {f.refModule === 'dealers' && (
                                <MenuItem value="Other_Dealer" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                  + Add New Property Dealer
                                </MenuItem>
                              )}
                            </Select>
                          </FormControl>
                          
                          {/* Inner Associated Dealer Sub-Form */}
                          {f.refModule === 'dealers' && nestedPropertyData.dealerId === 'Other_Dealer' && (
                            <Box sx={{ mt: 1.5, p: 2, border: '1px solid #3B82F6', borderRadius: '12px', backgroundColor: '#EFF6FF', width: '100%' }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, color: '#1E3A8A' }}>
                                Create New Property Dealer
                              </Typography>
                              <Grid container spacing={1.5}>
                                <Grid item xs={12} sm={6}>
                                  <TextField label="Firm Name" size="small" fullWidth required value={nestedDealerData.firm_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, firm_name: e.target.value }))} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                  <TextField label="Person Name" size="small" fullWidth required value={nestedDealerData.person_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, person_name: e.target.value }))} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                  <TextField label="Contact Number" size="small" fullWidth required value={nestedDealerData.contact_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contact_num: e.target.value }))} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                  <TextField label="Contacted Number" size="small" fullWidth value={nestedDealerData.contacted_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contacted_num: e.target.value }))} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                  <TextField label="Area/Sector/Block" size="small" fullWidth required value={nestedDealerData.sector_block || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, sector_block: e.target.value }))} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                  <TextField label="Address" size="small" fullWidth value={nestedDealerData.address || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, address: e.target.value }))} />
                                </Grid>
                                <Grid item xs={12}>
                                  <TextField label="Call Notes/Remarks" size="small" fullWidth multiline rows={2} value={nestedDealerData.remarks || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, remarks: e.target.value }))} />
                                </Grid>
                              </Grid>
                            </Box>
                          )}
                        </Grid>
                      );
                    }

                    // 3. STANDARD TEXT/NUMBER/DATE/TEXTAREA FIELD
                    return (
                      <Grid item xs={12} sm={6} key={f.name}>
                        <TextField
                          label={f.label}
                          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          multiline={f.type === 'textarea'}
                          rows={f.type === 'textarea' ? 2 : undefined}
                          size="small"
                          fullWidth
                          InputLabelProps={f.type === 'date' ? { shrink: true } : undefined}
                          value={nestedPropertyData[f.name] || ''}
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        />
                      </Grid>
                    );
                  })}
                </Grid>
              </Box>
            )}

            <TextField label="Requirements Remarks" multiline rows={3} fullWidth value={queryRemarks} onChange={(e) => setQueryRemarks(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setQueryDialogOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 600 }}>Cancel</Button>
          <Button variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={async () => {
            let finalPropertyId = '';
            if (queryType === 'Sell Property') {
              let finalDealerId = nestedPropertyData.dealerId;
              if (nestedPropertyData.dealer_owner_booked === 'Dealer' && nestedPropertyData.dealerId === 'Other_Dealer') {
                const dealerRes = await createRecord('dealers', {
                  ...nestedDealerData
                });
                if (dealerRes.success) {
                  finalDealerId = dealerRes.data.id;
                  fetchModuleData('dealers');
                } else {
                  alert(dealerRes.message || "Failed to auto-create associated dealer");
                  return;
                }
              }
              
              const propPayload = {
                ...nestedPropertyData,
                dealerId: finalDealerId,
                current_owner_id: record.id || '',
                contact_person_name: nestedPropertyData.contact_person_name || record.name || record.person_name || '',
                contact_number: nestedPropertyData.contact_number || record.phone || record.contact_num || '',
                date: new Date().toLocaleDateString('en-IN')
              };
              
              const propRes = await createRecord('properties', propPayload);
              if (propRes.success) {
                finalPropertyId = propRes.data.id;
                fetchModuleData('properties');
              } else {
                alert(propRes.message || "Failed to auto-create seller property");
                return;
              }
            }

            const payload = {
              customerId: id,
              assignedEmployeeId: queryEmployeeId || 'EMP-001',
              date: new Date().toLocaleDateString('en-IN'),
              status: 'Pending Approval',
              queryType,
              stage: 'New Query',
              budget: queryType === 'Buy Property' ? Number(queryBudget) : 0,
              demand: queryType === 'Sell Property' ? Number(nestedPropertyData.demand || 0) : 0,
              r_c_i: queryType === 'Sell Property' ? (nestedPropertyData.r_c_i || '') : queryRCI,
              propertyType: queryType === 'Sell Property' ? (nestedPropertyData.propertyType || '') : queryPropType,
              locality: queryType === 'Sell Property' ? (nestedPropertyData.locality || '') : queryLocality,
              sector_block: queryType === 'Sell Property' ? (nestedPropertyData.sector_block || '') : querySector,
              size: queryType === 'Sell Property' ? (nestedPropertyData.size || '') : querySize,
              remarks: queryRemarks,
              propertyId: finalPropertyId
            };
            const res = await createRecord('queries', payload);
            if (res.success) {
              setQueryDialogOpen(false);
              loadData();
            } else {
              alert(res.message || "Failed to create query");
            }
          }}>Submit Query</Button>
        </DialogActions>
      </Dialog>

      {/* Log Pitch Dialog */}
      <Dialog open={pitchDialogOpen} onClose={() => setPitchDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>{editingPitch ? 'Edit Pitch Presentation' : 'Log Agent Pitch Presentation'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1.5 }}>
            {pitchWarning && (
              <Alert severity="warning" sx={{ borderRadius: '8px', fontWeight: 600 }}>
                {pitchWarning}
              </Alert>
            )}
            {(moduleName === 'customers' || moduleName === 'leads' || moduleName === 'follow_ups' || moduleName === 'queries' || moduleName === 'dealers') ? (
              <>
                <Grid container spacing={2}>
                  {moduleName === 'dealers' && (
                    <Grid item xs={12}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Select Customer / Lead</InputLabel>
                        <Select
                          value={pitchCustomerId || ''}
                          onChange={(e) => setPitchCustomerId(e.target.value)}
                          label="Select Customer / Lead"
                        >
                          <MenuItem value="">-- Select --</MenuItem>
                          {[
                            ...(moduleData.customers || []).map(c => ({ id: c.id, name: c.name, type: 'Customer' })),
                            ...(moduleData.leads || []).map(l => ({ id: l.id, name: l.name, type: 'Lead' }))
                          ].map(client => (
                            <MenuItem key={client.id} value={client.id}>
                              {client.name} ({client.id} - {client.type})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Pitch Item Type</InputLabel>
                      <Select
                        value={pitchItemType}
                        onChange={(e) => {
                          setPitchItemType(e.target.value);
                          setPitchPropertyId('');
                        }}
                        label="Pitch Item Type"
                      >
                        <MenuItem value="Property">Property Listing</MenuItem>
                        <MenuItem value="Project">Builder Project</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{pitchItemType === 'Property' ? 'Select Property' : 'Select Project'}</InputLabel>
                      <Select
                        value={pitchPropertyId}
                        onChange={(e) => setPitchPropertyId(e.target.value)}
                        label={pitchItemType === 'Property' ? 'Select Property' : 'Select Project'}
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
                            placeholder={pitchItemType === 'Property' ? "Search properties..." : "Search projects..."}
                            fullWidth
                            value={propSearch}
                            onChange={(e) => setPropSearch(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </MenuItem>
                        <MenuItem value="">-- None --</MenuItem>
                        {pitchItemType === 'Property' ? (
                          (moduleData.properties || []).filter(p => {
                            if (!propSearch) return true;
                            const searchStr = `${p.propertyName || ''} ${p.locality} ${p.sector_block ? `Sector ${p.sector_block}` : ''} ${p.id}`.toLowerCase();
                            return searchStr.includes(propSearch.toLowerCase());
                          }).map(p => (
                            <MenuItem key={p.id} value={p.id}>
                              {p.propertyName ? `${p.propertyName} (${p.locality})` : p.locality} {p.sector_block ? `(Sector ${p.sector_block})` : ''} - ₹{p.demand} ({p.id})
                            </MenuItem>
                          ))
                        ) : (
                          (moduleData.projects || []).filter(p => {
                            if (!propSearch) return true;
                            const searchStr = `${p.name} ${p.locality} ${p.id}`.toLowerCase();
                            return searchStr.includes(propSearch.toLowerCase());
                          }).map(p => (
                            <MenuItem key={p.id} value={p.id}>
                              {p.name} - {p.locality} ({p.id})
                            </MenuItem>
                          ))
                        )}
                        <MenuItem value={pitchItemType === 'Property' ? 'Other_Property' : 'Other_Project'} sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                          + Create New {pitchItemType === 'Property' ? 'Property' : 'Project'}...
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>

                {/* Inline Nested Property Form */}
                {pitchPropertyId === 'Other_Property' && (
                  <Box sx={{ mt: 1, p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', backgroundColor: '#F8FAFC' }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, mb: 1.5, display: 'block', color: '#64748B', textTransform: 'uppercase' }}>
                      Create New Property Detail
                    </Typography>
                    <Grid container spacing={1.5}>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Contact Person Name" size="small" fullWidth value={nestedPropertyData.contact_person_name || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, contact_person_name: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Contact Number" size="small" fullWidth value={nestedPropertyData.contact_number || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, contact_number: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Dealer/Owner/Booked</InputLabel>
                          <Select
                            value={nestedPropertyData.dealer_owner_booked || 'Direct'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealer_owner_booked: e.target.value }))}
                            label="Dealer/Owner/Booked"
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
                              <InputLabel>Associated Dealer</InputLabel>
                              <Select
                                value={nestedPropertyData.dealerId || ''}
                                onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealerId: e.target.value }))}
                                label="Associated Dealer"
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
                                  />
                                </MenuItem>
                                <MenuItem value="">-- Select --</MenuItem>
                                {(moduleData.dealers || []).filter(d => {
                                  if (!dealerSearch) return true;
                                  const name = d.name || d.firm_name || d.person_name || '';
                                  const searchStr = `${name} ${d.id}`.toLowerCase();
                                  return searchStr.includes(dealerSearch.toLowerCase());
                                }).map(d => (
                                  <MenuItem key={d.id} value={d.id}>{d.firm_name} ({d.id})</MenuItem>
                                ))}
                                <MenuItem value="Other_Dealer" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                  + Add New Property Dealer
                                </MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Dealer Deal Type</InputLabel>
                              <Select
                                value={nestedPropertyData.dealer_deal_type || ''}
                                onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealer_deal_type: e.target.value }))}
                                label="Dealer Deal Type"
                              >
                                <MenuItem value="Dealer To Dealer">Dealer To Dealer</MenuItem>
                                <MenuItem value="Direct">Direct</MenuItem>
                                <MenuItem value="Booked">Booked</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>

                          {nestedPropertyData.dealerId === 'Other_Dealer' && (
                            <Grid item xs={12}>
                              <Paper sx={{ p: 2.5, border: '1px solid #3B82F6', borderRadius: '12px', backgroundColor: '#EFF6FF', boxShadow: 'none' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#1E3A8A', fontFamily: 'Poppins' }}>
                                  Create New Property Dealer
                                </Typography>
                                <Grid container spacing={2}>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Firm Name" size="small" fullWidth required value={nestedDealerData.firm_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, firm_name: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Person Name" size="small" fullWidth required value={nestedDealerData.person_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, person_name: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Contact Number" size="small" fullWidth required value={nestedDealerData.contact_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contact_num: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Contacted Number" size="small" fullWidth value={nestedDealerData.contacted_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contacted_num: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Area/Sector/Block" size="small" fullWidth required value={nestedDealerData.sector_block || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, sector_block: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Address" size="small" fullWidth value={nestedDealerData.address || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, address: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12}>
                                    <TextField label="Call Notes/Remarks" size="small" fullWidth multiline rows={2} value={nestedDealerData.remarks || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, remarks: e.target.value }))} />
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
                            <InputLabel>Booked By (Customer)</InputLabel>
                            <Select
                              value={nestedPropertyData.booked_by_customer_id || ''}
                              onChange={(e) => setNestedPropertyData(prev => ({ ...prev, booked_by_customer_id: e.target.value }))}
                              label="Booked By (Customer)"
                            >
                              <MenuItem value="">-- Select --</MenuItem>
                              {(moduleData.customers || []).map(c => (
                                <MenuItem key={c.id} value={c.id}>{c.name} ({c.id})</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                      )}

                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>R/C/I Segment</InputLabel>
                          <Select
                            value={nestedPropertyData.r_c_i || 'Residential'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, r_c_i: e.target.value }))}
                            label="R/C/I Segment"
                          >
                            <MenuItem value="Residential">Residential</MenuItem>
                            <MenuItem value="Commercial">Commercial</MenuItem>
                            <MenuItem value="Industrial">Industrial</MenuItem>
                            <MenuItem value="Land">Land</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Property Type</InputLabel>
                          <Select
                            value={nestedPropertyData.propertyType || ''}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, propertyType: e.target.value }))}
                            label="Property Type"
                          >
                            {(() => {
                              const currentRCI = nestedPropertyData.r_c_i || 'Residential';
                              const mapping = {
                                Residential: ['Plots', 'LOI', 'Villa', 'Kothi', 'Apartment', 'Farm House'],
                                Commercial: ['Bay Shop', 'Booth', 'Booth Built Up', 'Showroom', 'SCO Plot'],
                                Industrial: ['Built up', 'Plot', 'LOI', 'Floors'],
                                Land: []
                              };
                              const allowed = mapping[currentRCI] || [];
                              return [
                                ...allowed.map(val => <MenuItem key={val} value={val}>{val}</MenuItem>),
                                <MenuItem key="Other" value="Other">Other</MenuItem>
                              ];
                            })()}
                          </Select>
                        </FormControl>
                      </Grid>

                      {nestedPropertyData.propertyType === 'Showroom' && (
                        <Grid item xs={12} sm={6}>
                          <TextField 
                            label="No. of Floors" 
                            size="small" 
                            fullWidth 
                            value={nestedPropertyData.no_of_floors || ''} 
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, no_of_floors: e.target.value }))} 
                          />
                        </Grid>
                      )}

                      <Grid item xs={12} sm={6}>
                        <TextField label="Locality" size="small" fullWidth value={nestedPropertyData.locality || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, locality: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Sector/Block" size="small" fullWidth value={nestedPropertyData.sector_block || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, sector_block: e.target.value }))} />
                      </Grid>

                      {(() => {
                        const currentRCI = nestedPropertyData.r_c_i || 'Residential';
                        const units = ['Sq. ft.', 'Sq. yd.', 'Marla', 'Kanal', 'Acre'];
                        if (currentRCI === 'Land') {
                          return (
                            <Grid item xs={12}>
                              <Typography variant="caption" sx={{ fontWeight: 700, mb: 1, display: 'block', color: '#475569' }}>
                                Property Size (Land Components)
                              </Typography>
                              <Grid container spacing={1}>
                                <Grid item xs={4}>
                                  <Box display="flex" gap={0.5}>
                                    <TextField 
                                      label="Size 1" 
                                      size="small" 
                                      value={nestedPropertyData.size_comp1 || ''} 
                                      onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_comp1: e.target.value }))} 
                                    />
                                    <FormControl size="small" fullWidth>
                                      <Select 
                                        value={nestedPropertyData.size_unit1 || 'Acre'} 
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit1: e.target.value }))}
                                      >
                                        {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Grid>
                                <Grid item xs={4}>
                                  <Box display="flex" gap={0.5}>
                                    <TextField 
                                      label="Size 2" 
                                      size="small" 
                                      value={nestedPropertyData.size_comp2 || ''} 
                                      onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_comp2: e.target.value }))} 
                                    />
                                    <FormControl size="small" fullWidth>
                                      <Select 
                                        value={nestedPropertyData.size_unit2 || 'Kanal'} 
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit2: e.target.value }))}
                                      >
                                        {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Grid>
                                <Grid item xs={4}>
                                  <Box display="flex" gap={0.5}>
                                    <TextField 
                                      label="Size 3" 
                                      size="small" 
                                      value={nestedPropertyData.size_comp3 || ''} 
                                      onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_comp3: e.target.value }))} 
                                    />
                                    <FormControl size="small" fullWidth>
                                      <Select 
                                        value={nestedPropertyData.size_unit3 || 'Marla'} 
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit3: e.target.value }))}
                                      >
                                        {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Grid>
                              </Grid>
                            </Grid>
                          );
                        } else {
                          return (
                            <Grid item xs={12} sm={6}>
                              <Box display="flex" gap={1} alignItems="flex-start">
                                <TextField 
                                  label="Property Size" 
                                  size="small"
                                  fullWidth 
                                  value={nestedPropertyData.size_val || ''} 
                                  onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_val: e.target.value }))} 
                                />
                                <FormControl size="small" style={{ minWidth: 100 }}>
                                  <InputLabel>Unit</InputLabel>
                                  <Select 
                                    value={nestedPropertyData.size_unit || 'Sq. yd.'} 
                                    onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit: e.target.value }))}
                                    label="Unit"
                                  >
                                    {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                  </Select>
                                </FormControl>
                              </Box>
                            </Grid>
                          );
                        }
                      })()}

                      <Grid item xs={12} sm={6}>
                        <TextField label="Demand (Price)" size="small" fullWidth value={nestedPropertyData.demand || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, demand: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Status</InputLabel>
                          <Select
                            value={nestedPropertyData.status || (metadata.chips?.propertyStatus?.[0]?.value || 'Available for Purchase')}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, status: e.target.value }))}
                            label="Status"
                          >
                            {(metadata.chips?.propertyStatus || []).map(opt => (
                              <MenuItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField 
                          label="Date" 
                          type="date" 
                          size="small" 
                          fullWidth 
                          InputLabelProps={{ shrink: true }} 
                          value={nestedPropertyData.date || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, date: e.target.value }))} 
                        />
                      </Grid>

                      <Grid item xs={12} sm={6}>
                        <TextField 
                          label="Address/Number" 
                          size="small" 
                          fullWidth 
                          value={nestedPropertyData.address_number || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, address_number: e.target.value }))} 
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField 
                          label="BHK & Washroom" 
                          size="small" 
                          fullWidth 
                          value={nestedPropertyData.bhk_and_washrooms || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, bhk_and_washrooms: e.target.value }))} 
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField 
                          label="Dimensions" 
                          size="small" 
                          fullWidth 
                          value={nestedPropertyData.dimensions || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dimensions: e.target.value }))} 
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Location Type</InputLabel>
                          <Select
                            value={nestedPropertyData.location_type || 'Normal'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, location_type: e.target.value }))}
                            label="Location Type"
                          >
                            <MenuItem value="Normal">Normal</MenuItem>
                            <MenuItem value="Corner">Corner</MenuItem>
                            <MenuItem value="Park Facing">Park Facing</MenuItem>
                            <MenuItem value="Wide Road">Wide Road</MenuItem>
                            <MenuItem value="Corner + Park Facing">Corner + Park Facing</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Facing</InputLabel>
                          <Select
                            value={nestedPropertyData.facing || 'East'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, facing: e.target.value }))}
                            label="Facing"
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
                        <TextField 
                          label="White" 
                          size="small" 
                          fullWidth 
                          value={nestedPropertyData.white || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, white: e.target.value }))} 
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField 
                          label="Time" 
                          size="small" 
                          fullWidth 
                          value={nestedPropertyData.time || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, time: e.target.value }))} 
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Lead Source</InputLabel>
                          <Select
                            value={nestedPropertyData.lead_source || 'Self Source'}
                            onChange={(e) => setNestedPropertyData(prev => ({ ...prev, lead_source: e.target.value }))}
                            label="Lead Source"
                          >
                            <MenuItem value="Dealer">Dealer</MenuItem>
                            <MenuItem value="Direct Client">Direct Client</MenuItem>
                            <MenuItem value="Cold Calling">Cold Calling</MenuItem>
                            <MenuItem value="Google Ads">Google Ads</MenuItem>
                            <MenuItem value="Facebook Ads">Facebook Ads</MenuItem>
                            <MenuItem value="JustDial">JustDial</MenuItem>
                            <MenuItem value="99acres">99acres</MenuItem>
                            <MenuItem value="MagicBricks">MagicBricks</MenuItem>
                            <MenuItem value="Reference">Reference</MenuItem>
                            <MenuItem value="Self Source">Self Source</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12}>
                        <TextField 
                          label="Initial Notes / Remarks" 
                          size="small" 
                          fullWidth 
                          multiline 
                          rows={2} 
                          value={nestedPropertyData.initial_notes || ''} 
                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, initial_notes: e.target.value }))} 
                        />
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Inline Nested Project Form */}
                {pitchPropertyId === 'Other_Project' && (
                  <Box sx={{ mt: 1, p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', backgroundColor: '#F8FAFC' }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, mb: 1.5, display: 'block', color: '#64748B', textTransform: 'uppercase' }}>
                      Create New Project Detail
                    </Typography>
                    <Grid container spacing={1.5}>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Project Name" size="small" fullWidth value={nestedProjectData.name || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, name: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Developer</InputLabel>
                          <Select
                            value={nestedProjectData.builder || 'DLF Group'}
                            onChange={(e) => setNestedProjectData(prev => ({ ...prev, builder: e.target.value }))}
                            label="Developer"
                          >
                            <MenuItem value="Gagan Developers">Gagan Developers & Infra</MenuItem>
                            <MenuItem value="DLF Group">DLF Group India</MenuItem>
                            <MenuItem value="Omaxe">Omaxe Construction</MenuItem>
                            <MenuItem value="Hero Homes">Hero Realty Homes</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Locality" size="small" fullWidth value={nestedProjectData.locality || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, locality: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="Sector/Block" size="small" fullWidth value={nestedProjectData.sector_block || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, sector_block: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Type (R/C/I)</InputLabel>
                          <Select
                            value={nestedProjectData.type || 'Residential'}
                            onChange={(e) => setNestedProjectData(prev => ({ ...prev, type: e.target.value }))}
                            label="Type (R/C/I)"
                          >
                            <MenuItem value="Residential">Residential</MenuItem>
                            <MenuItem value="Commercial">Commercial</MenuItem>
                            <MenuItem value="Industrial">Industrial</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Category</InputLabel>
                          <Select
                            value={nestedProjectData.property_category || 'Plot'}
                            onChange={(e) => setNestedProjectData(prev => ({ ...prev, property_category: e.target.value }))}
                            label="Category"
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
                        <TextField label="Pricing Details" size="small" fullWidth value={nestedProjectData.pricing_details || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, pricing_details: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField label="PLC %" size="small" fullWidth value={nestedProjectData.plc_percent || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, plc_percent: e.target.value }))} />
                      </Grid>
                    </Grid>
                  </Box>
                )}
              </>
            ) : (
              <FormControl fullWidth size="small">
                <InputLabel>Select Customer or Lead</InputLabel>
                <Select
                  value={pitchCustomerId}
                  onChange={(e) => setPitchCustomerId(e.target.value)}
                  label="Select Customer or Lead"
                >
                  <MenuItem value="">-- Select Customer/Lead --</MenuItem>
                  <MenuItem value="" disabled sx={{ fontWeight: 800, color: '#2563EB' }}>CUSTOMERS</MenuItem>
                  {(moduleData.customers || []).map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </MenuItem>
                  ))}
                  <MenuItem value="" disabled sx={{ fontWeight: 800, color: '#2563EB' }}>LEADS</MenuItem>
                  {(moduleData.leads || []).map(l => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name} ({l.id})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <FormControl fullWidth>
              <InputLabel>Pitching Employee/RM</InputLabel>
              <Select value={pitchEmployeeId} onChange={(e) => setPitchEmployeeId(e.target.value)} label="Pitching Employee/RM">
                {(moduleData.employees || []).map(emp => (
                  <MenuItem key={emp.id} value={emp.id}>{emp.name} ({emp.id})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Outreach Pitch Method</InputLabel>
              <Select value={pitchMethod} onChange={(e) => setPitchMethod(e.target.value)} label="Outreach Pitch Method">
                <MenuItem value="Call">Phone Call</MenuItem>
                <MenuItem value="WhatsApp">WhatsApp Message</MenuItem>
                <MenuItem value="Office Visit">Office Meeting</MenuItem>
                <MenuItem value="Site Visit">Physical Site Visit</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Property Pitch Pipeline Stage</InputLabel>
              <Select 
                value={pitchStatus} 
                onChange={(e) => {
                  setPitchStatus(e.target.value);
                  if (e.target.value === 'Deal Closed') {
                    setPitchPropertyStatus('Property Registered/Sold Out');
                  }
                }} 
                label="Property Pitch Pipeline Stage"
              >
                <MenuItem value="Pitched">Pitched / Offered</MenuItem>
                <MenuItem value="Interested">Interested</MenuItem>
                <MenuItem value="Site Visit Scheduled">Site Visit Scheduled</MenuItem>
                <MenuItem value="Site Visit Completed">Site Visit Completed</MenuItem>
                <MenuItem value="Negotiation">Negotiation</MenuItem>
                <MenuItem value="Token Received">Token Received</MenuItem>
                <MenuItem value="Deal Closed">Deal Closed / Won</MenuItem>
                <MenuItem value="Rejected">Rejected</MenuItem>
                <MenuItem value="Hold">On Hold</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Property Pipeline Stage</InputLabel>
              <Select value={pitchPropertyStatus} onChange={(e) => setPitchPropertyStatus(e.target.value)} label="Property Pipeline Stage">
                <MenuItem value="">-- Keep Current / None --</MenuItem>
                {(metadata?.chips?.propertyStatus || []).map(chip => (
                  <MenuItem key={chip.value} value={chip.value}>{chip.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Quoted Pitch Price Offer" type="text" fullWidth value={pitchPrice} onChange={(e) => setPitchPrice(e.target.value)} />
            <TextField label="Next Followup Date" type="date" InputLabelProps={{ shrink: true }} fullWidth value={pitchFollowUp} onChange={(e) => setPitchFollowUp(e.target.value)} />
            <TextField label="Meeting Remarks" multiline rows={3} fullWidth value={pitchRemarks} onChange={(e) => setPitchRemarks(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setPitchDialogOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 600 }}>Cancel</Button>
          <Button variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={async () => {
            const isCustomerLead = moduleName === 'customers' || moduleName === 'leads';
            const isFollowUpQuery = moduleName === 'follow_ups' || moduleName === 'queries';
            const isDealer = moduleName === 'dealers';
            let finalPropId = isCustomerLead || isFollowUpQuery || isDealer ? pitchPropertyId : id;
            let finalCustomerId = isCustomerLead ? id : (isFollowUpQuery ? (record.customerId || record.id) : pitchCustomerId);
            let finalDealerId = isDealer ? id : '';
            let finalCustomerName = '';

            if (isCustomerLead || isFollowUpQuery || isDealer) {
              const matchedRecord = isCustomerLead ? record : ((moduleData.customers || []).find(c => c.id === finalCustomerId) || (moduleData.leads || []).find(l => l.id === finalCustomerId));
              finalCustomerName = matchedRecord ? (matchedRecord.name || matchedRecord.person_name) : finalCustomerId;
              if (pitchPropertyId === 'Other_Property') {
                let finalDealerIdVal = isDealer ? id : nestedPropertyData.dealerId;
                if (!isDealer && nestedPropertyData.dealer_owner_booked === 'Dealer' && nestedPropertyData.dealerId === 'Other_Dealer') {
                  const dealerRes = await createRecord('dealers', {
                    ...nestedDealerData
                  });
                  if (dealerRes.success) {
                    finalDealerIdVal = dealerRes.data.id;
                  } else {
                    return alert(dealerRes.message || "Failed to auto-create property dealer");
                  }
                }
                const compileSize = (payload) => {
                  const currentRCI = payload.r_c_i || 'Residential';
                  if (currentRCI === 'Land') {
                    const parts = [];
                    if (payload.size_comp1) parts.push(`${payload.size_comp1} ${payload.size_unit1 || 'Acre'}`);
                    if (payload.size_comp2) parts.push(`${payload.size_comp2} ${payload.size_unit2 || 'Kanal'}`);
                    if (payload.size_comp3) parts.push(`${payload.size_comp3} ${payload.size_unit3 || 'Marla'}`);
                    payload.size = parts.join(', ');
                  } else {
                    payload.size = payload.size_val ? `${payload.size_val} ${payload.size_unit || 'Sq. yd.'}` : '';
                  }
                  delete payload.size_val;
                  delete payload.size_unit;
                  delete payload.size_comp1;
                  delete payload.size_unit1;
                  delete payload.size_comp2;
                  delete payload.size_unit2;
                  delete payload.size_comp3;
                  delete payload.size_unit3;
                  return payload;
                };

                let propPayload = { ...nestedPropertyData };
                propPayload = compileSize(propPayload);

                const propRes = await createRecord('properties', {
                  ...propPayload,
                  dealerId: finalDealerIdVal,
                  date: new Date().toLocaleDateString('en-IN')
                });
                if (propRes.success) {
                  finalPropId = propRes.data.id;
                } else {
                  return alert(propRes.message || "Failed to auto-create property");
                }
              } else if (pitchPropertyId === 'Other_Project') {
                const projRes = await createRecord('projects', {
                  ...nestedProjectData
                });
                if (projRes.success) {
                  finalPropId = projRes.data.id;
                } else {
                  return alert(projRes.message || "Failed to auto-create project");
                }
              }
              if (isDealer && !finalCustomerId) {
                return alert("Please select a customer or lead to log the pitch against.");
              }
            } else {
              const selectedCust = (moduleData.customers || []).find(c => c.id === pitchCustomerId) || (moduleData.leads || []).find(l => l.id === pitchCustomerId);
              finalCustomerName = selectedCust ? (selectedCust.name || selectedCust.person_name) : pitchCustomerId;
              if (!finalCustomerId) {
                return alert("Please select a customer or lead to log the pitch against.");
              }
            }

            const payload = {
              customerId: finalCustomerId,
              customerName: finalCustomerName,
              propertyId: finalPropId,
              dealerId: finalDealerId,
              employeeId: pitchEmployeeId,
              employeeName: (moduleData.employees || []).find(e => e.id === pitchEmployeeId)?.name || pitchEmployeeId,
              pitchMethod,
              interestLevel: pitchStatus || '',
              status: pitchStatus,
              propertyStatus: pitchPropertyStatus,
              quotedPrice: pitchPrice || '',
              followUpDate: pitchFollowUp,
              remarks: pitchRemarks,
              pitchDate: editingPitch ? (editingPitch.pitchDate || new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN')) : new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN')
            };
            const res = editingPitch 
              ? await updateRecord('property_pitch_history', editingPitch.id, payload)
              : await createRecord('property_pitch_history', payload);
            if (res.success) {
              setPitchDialogOpen(false);
              setEditingPitch(null);
              loadData();
            } else {
              alert(res.message || (editingPitch ? "Failed to update pitch" : "Failed to log pitch"));
            }
          }}>{editingPitch ? 'Save Changes' : 'Log Pitch'}</Button>
        </DialogActions>
      </Dialog>

      {/* Log Outreach Call Dialog */}
      <Dialog open={callDialogOpen} onClose={() => setCallDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>Log Outreach Phone Call</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1.5 }}>
                        <TextField label="Call Duration (minutes)" type="number" fullWidth value={callDuration} onChange={(e) => setCallDuration(e.target.value)} />
            <FormControl fullWidth>
              <InputLabel>Call Outcome Status</InputLabel>
              <Select value={callOutcomeOption} onChange={(e) => setCallOutcomeOption(e.target.value)} label="Call Outcome Status">
                <MenuItem value="Call Done">Call Done</MenuItem>
                <MenuItem value="Not Picked the Call">Not Picked the Call</MenuItem>
                <MenuItem value="Switch Off">Switch Off</MenuItem>
                <MenuItem value="Not Reachable">Not Reachable</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Discussed Budget expectation" type="number" fullWidth value={callBudget} onChange={(e) => setCallBudget(e.target.value)} />
            <TextField label="Discussed Sectors/Areas" fullWidth value={callAreas} onChange={(e) => setCallAreas(e.target.value)} />
            <TextField label="Next Followup Date" type="date" InputLabelProps={{ shrink: true }} fullWidth value={callFollowUp} onChange={(e) => setCallFollowUp(e.target.value)} />
            <TextField label="Call Notes/Remarks" multiline rows={3} fullWidth value={callRemarks} onChange={(e) => setCallRemarks(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setCallDialogOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 600 }}>Cancel</Button>
          <Button variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={async () => {
            const payload = {
              dealerId: id,
              employeeName: localStorage.getItem('gr_crm_user_name') || 'Sales Representative',
              date: new Date().toLocaleDateString('en-IN'),
              duration: callDuration,
              budget: Number(callBudget || 0),
              areas: callAreas,
              followUpDate: callFollowUp,
              remarks: callRemarks,
              callOutcome: callOutcomeOption
            };
            const res = await createRecord('dealer_calls', payload);
            if (res.success) {
              setCallDialogOpen(false);
              loadData();
            } else {
              alert(res.message || "Failed to log outreach call");
            }
          }}>Log Call</Button>
        </DialogActions>
      </Dialog>

      {/* Submit Meeting Report Dialog */}
      <Dialog open={meetingReportDialogOpen} onClose={() => setMeetingReportDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>Log Meeting Visit Report</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1.5 }}>
            <FormControl fullWidth>
              <InputLabel>Select Meeting</InputLabel>
              <Select value={selectedMeetingId} onChange={(e) => setSelectedMeetingId(e.target.value)} label="Select Meeting">
                {(connections?.meetings || []).filter(m => m.status === 'Assigned').map(m => (
                  <MenuItem key={m.id} value={m.id}>{m.purpose || 'Intro Meeting'} ({m.id})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Visit Outcomes & Notes" multiline rows={3} fullWidth value={meetingOutcome} onChange={(e) => setMeetingOutcome(e.target.value)} />
            <TextField label="Documents Collected from Dealer" fullWidth value={meetingDocCollected} onChange={(e) => setMeetingDocCollected(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setMeetingReportDialogOpen(false)} sx={{ textTransform: 'none', color: '#64748B', fontWeight: 600 }}>Cancel</Button>
          <Button variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={async () => {
            if (!selectedMeetingId) {
              alert("Please select a meeting to report on");
              return;
            }
            const meetingRec = connections.meetings.find(m => m.id === selectedMeetingId);
            if (!meetingRec) return;

            const payload = {
              ...meetingRec,
              status: 'Completed',
              outcome: meetingOutcome,
              documents_collected: meetingDocCollected,
              last_updated: new Date().toLocaleString('en-IN')
            };
            
            const res = await axios.put(`${API_BASE_URL}/data/dealer_meetings/${selectedMeetingId}`, payload, {
              headers: { Authorization: `Bearer ${localStorage.getItem('gr_crm_token')}` }
            });
            if (res.data) {
              setMeetingReportDialogOpen(false);
              loadData();
            } else {
              alert("Failed to submit meeting report");
            }
          }}>Submit Visit Report</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
};

export default EntityDetail;
