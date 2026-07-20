import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  Chip,
  TextField,
  InputAdornment,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormGroup,
  FormControlLabel,
  Checkbox,
  useMediaQuery
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp } from '../context/AppContext';
import DynamicTable from '../components/DynamicTable';
import DynamicForm from '../components/DynamicForm';

const getSingularLabel = (label) => {
  if (!label) return '';
  if (label.toLowerCase() === 'queries') return 'Query';
  if (label.toLowerCase() === 'leaves') return 'Leave';
  if (label.toLowerCase() === 'attendance') return 'Attendance';
  if (label.endsWith('ies')) return label.slice(0, -3) + 'y';
  if (label.endsWith('s')) return label.slice(0, -1);
  return label;
};

const RecordCard = ({ rec, fields, handleInspectClick, handleEditClick, handleDeleteClick, moduleName }) => {
  const { moduleData } = useApp();
  const [expanded, setExpanded] = useState(false);
  const primaryFields = fields.filter(f => f.showInTable && f.name !== 'id' && f.name !== 'status');
  
  // Filter only fields that have actual, non-empty values in the current record
  const filledFields = primaryFields.filter(f => {
    const val = rec[f.name];
    return val !== undefined && val !== null && val !== '';
  });

  // Display first 4 filled fields initially; expand to show all filled fields on toggle click
  const visibleFields = expanded ? filledFields : filledFields.slice(0, 4);
  const hasMoreFields = filledFields.length > 4;

  return (
    <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: 'none', mb: 2.5, '&:hover': { boxShadow: '0 6px 15px rgba(15,23,42,0.03)', borderColor: '#CBD5E1' }, transition: 'all 0.2s' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2.5 }}>
          
          {/* Left section: Folder tab and ID */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: '140px' }}>
            <Box sx={{ p: 1, borderRadius: '8px', backgroundColor: 'rgba(37,99,235,0.06)', color: '#2563EB', display: 'flex', alignItems: 'center' }}>
              <Icons.Folder size={20} />
            </Box>
            <Box>
              <Typography 
                variant="subtitle2" 
                sx={{ 
                  fontWeight: 800, 
                  color: '#2563EB', 
                  fontSize: '13px',
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' }
                }}
                onClick={() => handleInspectClick(moduleName, rec.id)}
              >
                {rec.id}
              </Typography>
              {rec.status && (
                <Chip 
                  label={rec.status} 
                  size="small" 
                  sx={{ fontWeight: 700, fontSize: '9px', borderRadius: '4px', height: 16, mt: 0.5 }}
                />
              )}
            </Box>
          </Box>

          {/* Middle section: Horizontal view of fields */}
          <Box sx={{ flexGrow: 1, display: 'flex', flexWrap: 'wrap', gap: { xs: 2, md: 4 } }}>
            {visibleFields.map(f => {
              const val = rec[f.name];
              let displayVal = String(val);
              const currencyFields = [
                'price', 'budget', 'salary', 'salePrice', 'netPay', 'baseSalary', 'dailyRate',
                'leaveDeduction', 'halfDayDeduction', 'overtimePayment', 'allowancesTotal',
                'deductionsTotal', 'expensesReimbursement', 'advanceRecovery', 'advanceBalance',
                'advanceTaken'
              ];
              if (currencyFields.includes(f.name)) {
                if (val !== undefined && val !== null && val !== '') {
                  const str = String(val).trim();
                  if (/[a-zA-Z]/.test(str)) {
                    displayVal = str;
                  } else {
                    const num = Number(str.replace(/,/g, ''));
                    displayVal = isNaN(num) ? str : `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
                  }
                }
              }

              return (
                <Box key={f.name} sx={{ minWidth: '130px' }}>
                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontWeight: 600, fontSize: '11px', mb: 0.2 }}>
                    {f.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#0F172A', fontWeight: 700, fontSize: '13px' }}>
                    {f.type === 'ref' || f.type === 'multiref' || f.name === 'referrer_id' ? (() => {
                      let resolvedModule = f.refModule;
                      if (f.name === 'referrer_id') {
                        if (String(val).startsWith('EMP-')) resolvedModule = 'employees';
                        else if (String(val).startsWith('CUST-')) resolvedModule = 'customers';
                        else if (String(val).startsWith('LEAD-')) resolvedModule = 'leads';
                        else resolvedModule = 'employees';
                      }
                      if (resolvedModule === 'customers' && String(val).startsWith('LEAD-')) {
                        resolvedModule = 'leads';
                      } else if (resolvedModule === 'customers' && String(val).startsWith('CUST-')) {
                        resolvedModule = 'customers';
                      }
                      const list = moduleData[resolvedModule] || [];
                      const record = list.find(r => String(r.id) === String(val));
                      const resolvedName = record ? (record.propertyName || record.name || record.title || record.firm_name || record.person_name || record.id || 'Unnamed') : val;
                      return (
                        <span style={{ color: '#2563EB', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }} onClick={() => handleInspectClick(resolvedModule, val)}>
                          {resolvedName}
                        </span>
                      );
                    })() : (
                      (f.name === 'name' || f.name === 'person_name' || f.name === 'title' || f.name === 'propertyName') ? (
                        <span 
                          style={{ color: '#2563EB', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }} 
                          onClick={() => handleInspectClick(moduleName, rec.id)}
                        >
                          {displayVal}
                        </span>
                      ) : displayVal
                    )}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/* Right section: Action tray */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderLeft: { xs: 'none', md: '1px solid #E2E8F0' }, pl: { xs: 0, md: 1.5 }, pt: { xs: 1.5, md: 0 }, width: { xs: '100%', md: 'auto' }, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
            {(moduleName === 'leads' || moduleName === 'customers') && (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {rec.phone && (
                  <IconButton 
                    size="small" 
                    href={`https://wa.me/91${rec.phone}?text=${encodeURIComponent(`Hi ${rec.name || ''}, this is Gagan Realtech following up.`)}`}
                    target="_blank"
                    sx={{ color: '#22C55E', '&:hover': { backgroundColor: 'rgba(34,197,94,0.05)' } }}
                  >
                    <Icons.MessageCircle size={16} />
                  </IconButton>
                )}
                {rec.email && (
                  <IconButton 
                    size="small" 
                    href={`mailto:${rec.email}?subject=${encodeURIComponent("Gagan Realtech Follow-up")}&body=${encodeURIComponent(`Hi ${rec.name || ''},\n\nThis is Gagan Realtech following up on your requirements.\n\nBest regards,\nGagan Realtech Team`)}`}
                    sx={{ color: '#3B82F6', '&:hover': { backgroundColor: 'rgba(59,130,246,0.05)' } }}
                  >
                    <Icons.Mail size={16} />
                  </IconButton>
                )}
                {rec.phone && (
                  <IconButton 
                    size="small" 
                    href={`sms:91${rec.phone}?body=${encodeURIComponent(`Hi ${rec.name || ''}, this is Gagan Realtech following up.`)}`}
                    sx={{ color: '#F59E0B', '&:hover': { backgroundColor: 'rgba(245,158,11,0.05)' } }}
                  >
                    <Icons.Smartphone size={16} />
                  </IconButton>
                )}
              </Box>
            )}
            <IconButton size="small" onClick={() => handleInspectClick(moduleName, rec.id)} sx={{ color: '#2563EB', '&:hover': { backgroundColor: 'rgba(37,99,235,0.05)' } }}>
              <Icons.Eye size={16} />
            </IconButton>
            <IconButton size="small" onClick={() => handleEditClick(rec)} sx={{ color: '#F59E0B', '&:hover': { backgroundColor: 'rgba(245,158,11,0.05)' } }}>
              <Icons.Edit3 size={16} />
            </IconButton>
            <IconButton size="small" onClick={() => handleDeleteClick(rec.id)} sx={{ color: '#EF4444', '&:hover': { backgroundColor: 'rgba(239,68,68,0.05)' } }}>
              <Icons.Trash2 size={16} />
            </IconButton>
          </Box>
        </Box>
        {hasMoreFields && (
          <Button 
            size="small" 
            onClick={() => setExpanded(!expanded)} 
            sx={{ mt: 1.5, p: 0, textTransform: 'none', fontWeight: 700, fontSize: '11px', color: '#2563EB', '&:hover': { background: 'none', textDecoration: 'underline' } }}
          >
            {expanded ? 'Show Less ▲' : `Show More (${filledFields.length - 4} more) ▼`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

const ModuleManager = () => {
  const { moduleName } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    metadata, 
    moduleData, 
    fetchModuleData, 
    createRecord, 
    updateRecord, 
    deleteRecord,
    bulkDeleteRecord,
    loadingData 
  } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewMode, setViewMode] = useState('card'); // 'table' or 'card'
  const isMobile = useMediaQuery('(max-width:900px)');

  // Outreach call states for Dealers in table row actions
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [selectedDealerForCall, setSelectedDealerForCall] = useState(null);
  const [callDuration, setCallDuration] = useState('');
  const [callBudget, setCallBudget] = useState('');
  const [callAreas, setCallAreas] = useState('');
  const [callRemarks, setCallRemarks] = useState('');
  const [callOutcomeOption, setCallOutcomeOption] = useState('Call Done');
  const [callFollowUp, setCallFollowUp] = useState('');

  const handleLogCallClick = (dealerRecord) => {
    setSelectedDealerForCall(dealerRecord);
    setCallDuration('');
    setCallBudget('');
    setCallAreas('');
    setCallRemarks('');
    setCallOutcomeOption('Call Done');
    setCallFollowUp('');
    setCallDialogOpen(true);
  };

  // Removed isMobile viewMode useEffect to preserve card view as default on desktop and mobile

  // Parse URL search parameters for automatic filtering
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const filtersFromUrl = {};
    let hasUrlFilters = false;
    for (const [key, value] of searchParams.entries()) {
      if (key !== '_special' && key !== 'searchTerm' && key !== 'new') {
        filtersFromUrl[key] = value;
        hasUrlFilters = true;
      }
    }
    const urlSearch = searchParams.get('searchTerm');
    if (urlSearch !== null) {
      setSearchTerm(urlSearch);
    }
    const urlSpecial = searchParams.get('_special');
    if (urlSpecial) {
      filtersFromUrl._special = urlSpecial;
      hasUrlFilters = true;
    }
    if (hasUrlFilters) {
      setStackedFilters(filtersFromUrl);
    } else {
      setStackedFilters({});
    }
  }, [location.search, moduleName]);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [stackedFilters, setStackedFilters] = useState({});
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('asc');
  const [visibleColumns, setVisibleColumns] = useState({});
  const [selectedRows, setSelectedRows] = useState([]);

  // Menu Anchors
  const [filterAnchorEl, setFilterAnchorEl] = useState(null);
  const [sortAnchorEl, setSortAnchorEl] = useState(null);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  // Fetch data records on module active state changes
  useEffect(() => {
    if (metadata && metadata.modules[moduleName]) {
      fetchModuleData(moduleName);
      setErrorMsg('');

      // Check if we need to auto-open creation form dialog
      const params = new URLSearchParams(window.location.search);
      if (params.get('new') === 'true') {
        setSelectedRecord(null);
        setFormOpen(true);
      }
    }
  }, [moduleName, metadata]);

  if (!metadata) return null;

  const moduleConfig = metadata.modules[moduleName];
  if (!moduleConfig) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Module "{moduleName}" does not exist in metadata.</Alert>
      </Box>
    );
  }

  const fields = moduleConfig.fields;
  const records = useMemo(() => {
    const rawRecs = moduleData[moduleName] || [];
    return rawRecs.filter(r => {
      if (!r) return false;
      if (r.deleted === true || r.deleted === 'true') return false;
      if (r.isDeleted === true || r.isDeleted === 'true') return false;
      if (r.archived === true || r.archived === 'true') return false;
      if (r.active === false || r.active === 'false') return false;
      if (r.status) {
        const s = String(r.status).toLowerCase();
        if (s === 'deleted' || s === 'archived' || s === 'removed') return false;
      }
      return true;
    });
  }, [moduleData, moduleName]);

  const getKPICards = () => {
    const total = records.length;
    const todayStr = new Date().toISOString().split('T')[0];

    const createCardObj = (title, count, iconName, color, subtext, active, onClick) => ({
      title,
      count,
      iconName,
      color,
      subtext,
      active,
      onClick
    });

    switch (moduleName) {
      case 'leads': {
        const todayLocalStr = new Date().toLocaleDateString('en-IN');
        const converted = records.filter(r => 
          r.status === 'Converted' || 
          r.status === 'Moved to Customer' || 
          (moduleData.customers || []).some(c => String(c.id) === String(r.id) || String(c.leadId) === String(r.id))
        );
        const activeLeads = records.filter(r => 
          !converted.some(c => String(c.id) === String(r.id))
        );
        const fresh = activeLeads.filter(r => 
          (r.dateAdded && r.dateAdded === todayStr) ||
          (r.date && r.date.includes(todayLocalStr)) ||
          r.status === 'Open' || 
          r.status === 'New Lead' ||
          r.leadType === 'Seller'
        );
        const pending = activeLeads.filter(r => 
          (!r.assignedEmployeeId || r.assignedEmployeeId === '') &&
          r.status !== 'Lost' && r.status !== 'Dead' && r.status !== 'Closed/Lost' &&
          r.stage !== 'Lost'
        );

        return [
          createCardObj('Total Leads', activeLeads.length, 'Users', '#3B82F6', 'Active leads', stackedFilters._special === 'activeLeads', () => {
            setStackedFilters({ _special: 'activeLeads' });
          }),
          createCardObj('New Leads', fresh.length, 'CheckCircle', '#22C55E', 'Created today', stackedFilters._special === 'newLeads', () => {
            setStackedFilters({ _special: 'newLeads' });
          }),
          createCardObj('Converted', converted.length, 'TrendingUp', '#8B5CF6', 'Leads converted', stackedFilters._special === 'convertedLeads', () => {
            setStackedFilters({ _special: 'convertedLeads' });
          }),
          createCardObj('Pending', pending.length, 'Clock', '#EC4899', 'In progress', stackedFilters._special === 'pendingLeads', () => {
            setStackedFilters({ _special: 'pendingLeads' });
          })
        ];
      }

      case 'properties': {
        const sold = records.filter(r => {
          const st = String(r.status || '').toLowerCase();
          return st.includes('sold') || st.includes('register') || st.includes('book');
        });
        const avail = records.filter(r => {
          const st = String(r.status || '').toLowerCase();
          if (st.includes('sold') || st.includes('register') || st.includes('book') || st.includes('inactive')) return false;
          return true;
        });
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const newMonth = records.filter(r => {
          if (r.dateAdded) {
            const parts = r.dateAdded.split('-');
            if (parts.length === 3) {
              const year = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10);
              return year === currentYear && month === currentMonth;
            }
          } else if (r.date) {
            const parts = r.date.split(/[/-]/);
            if (parts.length >= 2) {
              const month = parseInt(parts[1], 10);
              const year = parseInt(parts[2], 10);
              return (year === currentYear || year === currentYear % 100) && month === currentMonth;
            }
          }
          return false;
        });

        return [
          createCardObj('Total Properties', total, 'Home', '#3B82F6', 'Total properties', stackedFilters._special === 'totalProperties', () => {
            setStackedFilters({ _special: 'totalProperties' });
          }),
          createCardObj('Sold Out', sold.length, 'BadgeCheck', '#22C55E', 'Sold / Booked', stackedFilters._special === 'soldProperties', () => {
            setStackedFilters({ _special: 'soldProperties' });
          }),
          createCardObj('Available', avail.length, 'Eye', '#F59E0B', 'Active listings', stackedFilters._special === 'availProperties', () => {
            setStackedFilters({ _special: 'availProperties' });
          }),
          createCardObj('New This Month', newMonth.length, 'Sparkles', '#EC4899', 'Added this month', stackedFilters._special === 'newMonthProperties', () => {
            setStackedFilters({ _special: 'newMonthProperties' });
          })
        ];
      }

      case 'dealers': {
        const newMonth = Math.max(1, Math.round(total * 0.1));
        const followupsCount = records.filter(r => r.visitStatus === 'Assigned' || r.callOutcome === 'Call Done').length;

        return [
          createCardObj('Total Dealers', total, 'Building', '#3B82F6', 'Total dealers', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('New This Month', newMonth, 'Star', '#F59E0B', 'New this month', stackedFilters._special === 'newDealers', () => {
            setStackedFilters({ _special: 'newDealers' });
          }),
          createCardObj('Follow Ups', followupsCount, 'PhoneCall', '#EC4899', 'Assigned followups', stackedFilters.visitStatus === 'Assigned', () => {
            setStackedFilters({ visitStatus: 'Assigned' });
          })
        ];
      }

      case 'tasks': {
        const completed = records.filter(r => r.status === 'Completed');
        const pending = records.filter(r => r.status === 'Pending' || r.status === 'In-Progress');
        const overdue = records.filter(r => r.status !== 'Completed' && r.dueDate && r.dueDate < todayStr);
        const dueToday = records.filter(r => r.dueDate === todayStr);

        return [
          createCardObj('Total Tasks', total, 'CheckSquare', '#3B82F6', 'Active tasks', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('Completed', completed.length, 'CheckCircle', '#22C55E', `${total ? Math.round(completed.length/total*100) : 0}% completed`, stackedFilters.status === 'Completed', () => {
            setStackedFilters({ status: 'Completed' });
          }),
          createCardObj('In Progress', pending.length, 'Clock', '#F59E0B', `${total ? Math.round(pending.length/total*100) : 0}% pending`, stackedFilters.status === 'Pending', () => {
            setStackedFilters({ status: 'Pending' });
          }),
          createCardObj('Overdue', overdue.length, 'AlertTriangle', '#EF4444', 'Requires attention', stackedFilters._special === 'overdue', () => {
            setStackedFilters({ _special: 'overdue' });
          }),
          createCardObj('Due Today', dueToday.length, 'Calendar', '#EC4899', 'Due today', stackedFilters._special === 'dueToday', () => {
            setStackedFilters({ _special: 'dueToday' });
          })
        ];
      }

      case 'follow_ups': {
        const completed = records.filter(r => {
          const isInitialStatus = (r.status === 'Pending Call' || r.status === 'Pending');
          const isInitialStage = (r.pipelineAction === 'Fresh Lead' || r.pipelineAction === 'None' || !r.pipelineAction || r.pipelineAction === '');
          return !isInitialStatus || !isInitialStage || r.status === 'Completed' || r.status === 'Call Completed';
        });
        const pending = records.filter(r => !completed.includes(r));

        return [
          createCardObj('Total Follow-ups', total, 'PhoneCall', '#3B82F6', 'Total follow-ups', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('Pending', pending.length, 'Clock', '#F59E0B', 'Awaiting action', stackedFilters._special === 'pendingFollowUps', () => {
            setStackedFilters({ _special: 'pendingFollowUps' });
          }),
          createCardObj('Completed', completed.length, 'CheckCircle', '#22C55E', 'Action completed', stackedFilters._special === 'completedFollowUps', () => {
            setStackedFilters({ _special: 'completedFollowUps' });
          })
        ];
      }

      case 'site_visits': {
        const thisMonth = records.length;
        const uniqueEmployees = new Set(records.map(r => r.employeeId)).size;
        const positive = Math.round(records.filter(r => r.result === 'Interested' || r.result === 'Confirmed' || r.result === 'Site Liked').length / (total || 1) * 100);

        return [
          createCardObj('Total Site Visits', total, 'MapPin', '#3B82F6', 'Total visits', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('This Month', thisMonth, 'Calendar', '#22C55E', 'This month visits', stackedFilters._special === 'thisMonthVisits', () => {
            setStackedFilters({ _special: 'thisMonthVisits' });
          }),
          createCardObj('Employees Involved', uniqueEmployees, 'Users', '#F59E0B', 'Involved employees', false, () => {
            setStackedFilters({});
          }),
          createCardObj('Positive Feedback', `${positive}%`, 'ThumbsUp', '#8B5CF6', 'Positive feedback', stackedFilters._special === 'positiveFeedback', () => {
            setStackedFilters({ _special: 'positiveFeedback' });
          })
        ];
      }

      case 'projects': {
        const statuses = metadata?.chipGroups?.projectStatus || [];
        return statuses.map((opt, index) => {
          const count = records.filter(r => String(r.status) === opt.value).length;
          const colors = ['#3B82F6', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444'];
          const cardColor = opt.color || colors[index % colors.length];
          return createCardObj(
            opt.value,
            count,
            'Activity',
            cardColor,
            opt.label || opt.value,
            stackedFilters.status === opt.value,
            () => {
              setStackedFilters({ status: opt.value });
            }
          );
        });
      }

      case 'leaves': {
        const approved = records.filter(r => r.status === 'Approved');
        const pending = records.filter(r => r.status === 'Pending');
        const rejected = records.filter(r => r.status === 'Rejected');

        return [
          createCardObj('Total Leaves', total, 'CalendarDays', '#3B82F6', 'This Month', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('Approved Leaves', approved.length, 'CheckCircle', '#22C55E', 'Approved', stackedFilters.status === 'Approved', () => {
            setStackedFilters({ status: 'Approved' });
          }),
          createCardObj('Pending Requests', pending.length, 'Clock', '#F59E0B', 'Pending', stackedFilters.status === 'Pending', () => {
            setStackedFilters({ status: 'Pending' });
          }),
          createCardObj('Rejected Leaves', rejected.length, 'AlertOctagon', '#EF4444', 'Rejected', stackedFilters.status === 'Rejected', () => {
            setStackedFilters({ status: 'Rejected' });
          })
        ];
      }

      case 'employees': {
        const activeEmployees = records.filter(r => 
          r.status !== 'Inactive' && 
          r.status !== 'Deleted' && 
          r.status !== 'Archived' &&
          r.status !== 'Removed'
        );
        const att = moduleData.attendance || [];
        const todayDateStr = new Date().toLocaleDateString('sv-SE');
        
        const presentTodayIds = new Set(
          att
            .filter(a => {
              const matchesDate = String(a.date) === todayDateStr;
              if (!matchesDate) return false;
              const isPresentStatus = a.status === 'Present' || a.status === 'Late';
              const hasInTime = a.inTime && a.inTime !== '--';
              return isPresentStatus || hasInTime;
            })
            .map(a => String(a.employeeId))
        );
        const presentCount = activeEmployees.filter(emp => presentTodayIds.has(String(emp.id))).length;
        const absentOrLeaveCount = activeEmployees.filter(emp => !presentTodayIds.has(String(emp.id))).length;

        return [
          createCardObj('Total Employees', activeEmployees.length, 'Users', '#3B82F6', 'Active employees', stackedFilters._special === 'activeEmployees', () => {
            setStackedFilters({ _special: 'activeEmployees' });
          }),
          createCardObj('Present Today', presentCount, 'CheckCircle', '#22C55E', 'Punched in today', stackedFilters._special === 'presentToday', () => {
            setStackedFilters({ _special: 'presentToday' });
          }),
          createCardObj('On Leave / Absent', absentOrLeaveCount, 'Calendar', '#EF4444', 'Away today', stackedFilters._special === 'absentOrLeaveToday', () => {
            setStackedFilters({ _special: 'absentOrLeaveToday' });
          })
        ];
      }

      case 'property_pitch_history': {
        const closed = records.filter(r => r.status === 'Deal Closed');
        const uniqueProps = new Set(records.map(r => r.propertyId)).size;
        const uniqueEmps = new Set(records.map(r => r.employeeId)).size;
        const thisMonth = records.length;

        return [
          createCardObj('Total Pitches', total, 'Send', '#3B82F6', 'Total pitches', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('Converted Pitches', closed.length, 'CheckCircle', '#22C55E', 'Deal closed', stackedFilters.status === 'Deal Closed', () => {
            setStackedFilters({ status: 'Deal Closed' });
          }),
          createCardObj('Properties Involved', uniqueProps, 'Home', '#F59E0B', 'Involved properties', false, () => {
            setStackedFilters({});
          }),
          createCardObj('Employees Involved', uniqueEmps, 'Users', '#EC4899', 'Involved employees', false, () => {
            setStackedFilters({});
          }),
          createCardObj('This Month', thisMonth, 'Calendar', '#10B981', 'Pitches this month', stackedFilters._special === 'thisMonthPitches', () => {
            setStackedFilters({ _special: 'thisMonthPitches' });
          })
        ];
      }

      case 'queries': {
        const open = records.filter(r => r.status === 'Open' || r.status === 'Pending Approval');
        const inProgress = records.filter(r => r.status === 'Approved' && r.stage !== 'Closed');
        const closed = records.filter(r => r.stage === 'Closed');

        return [
          createCardObj('Total Queries', total, 'HelpCircle', '#3B82F6', 'Total queries', Object.keys(stackedFilters).length === 0, () => {
            setStackedFilters({});
          }),
          createCardObj('Open Queries', open.length, 'CheckCircle', '#22C55E', 'Open queries', stackedFilters.status === 'Pending Approval', () => {
            setStackedFilters({ status: 'Pending Approval' });
          }),
          createCardObj('In Progress', inProgress.length, 'Clock', '#F59E0B', 'In progress', stackedFilters._special === 'inProgressQueries', () => {
            setStackedFilters({ _special: 'inProgressQueries' });
          }),
          createCardObj('Resolved', closed.length, 'Activity', '#8B5CF6', 'Resolved', stackedFilters.stage === 'Closed' && stackedFilters._special !== 'closedQueries', () => {
            setStackedFilters({ stage: 'Closed' });
          }),
          createCardObj('Closed', closed.length, 'AlertOctagon', '#EF4444', 'Closed queries', stackedFilters._special === 'closedQueries', () => {
            setStackedFilters({ _special: 'closedQueries' });
          })
        ];
      }

      default:
        return [];
    }
  };

  // Reset states and initialize columns / filters when module changes
  useEffect(() => {
    if (fields) {
      const initialCol = {};
      fields.forEach(f => {
        initialCol[f.name] = f.showInTable !== false;
      });
      setVisibleColumns(initialCol);

      const defaults = fields
        .filter(f => f.type === 'select' || f.type === 'ref')
        .slice(0, 3)
        .map(f => f.name);
      setActiveFilterFields(defaults);

      setStackedFilters({});
      setSearchTerm('');
      setSelectedRows([]);
      setSortField('id');
      setSortDirection('asc');
    }
  }, [moduleName, fields]);

  // Extract distinct values dynamically for filtering
  const filterOptions = useMemo(() => {
    const options = {};
    if (!fields) return options;
    fields.forEach(f => {
      if (f.name === 'id' || f.name === 'last_updated') return;
      
      // If select type with chipGroup options, populate statically
      if (f.type === 'select' && f.chipGroup && metadata?.chipGroups?.[f.chipGroup]) {
        options[f.name] = metadata.chipGroups[f.chipGroup].map(item => ({
          value: item.value,
          label: item.label
        }));
        return;
      }
      
      const distinctValues = Array.from(new Set(
        records
          .map(r => r[f.name])
          .filter(val => val !== undefined && val !== null && val !== '')
      ));
      
      if (distinctValues.length > 0) {
        options[f.name] = distinctValues.map(val => ({
          value: String(val),
          label: String(val)
        }));
      }
    });
    return options;
  }, [fields, records, metadata]);

  const [activeFilterFields, setActiveFilterFields] = useState([]);

  // Filter logic
  const filteredRecords = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayLocalStr = new Date().toLocaleDateString('en-IN');

    return records.filter(rec => {
      // Leads Stacked Filters
      if (moduleName === 'leads' && stackedFilters._special) {
        const isConv = rec.status === 'Converted' || 
                       rec.status === 'Moved to Customer' || 
                       (moduleData.customers || []).some(c => String(c.id) === String(rec.id) || String(c.leadId) === String(rec.id));
        
        if (stackedFilters._special === 'activeLeads') {
          if (isConv) return false;
        }
        if (stackedFilters._special === 'newLeads') {
          const isNew = (rec.dateAdded && rec.dateAdded === todayStr) ||
                        (rec.date && rec.date.includes(todayLocalStr)) ||
                        rec.status === 'Open' || 
                        rec.status === 'New Lead' ||
                        rec.leadType === 'Seller';
          if (!isNew || isConv) return false;
        }
        if (stackedFilters._special === 'convertedLeads') {
          if (!isConv) return false;
        }
        if (stackedFilters._special === 'pendingLeads') {
          const isLost = rec.status === 'Lost' || rec.status === 'Dead' || rec.status === 'Closed/Lost' || rec.stage === 'Lost';
          if (isConv || isLost) return false;
        }
      }

      // Properties Stacked Filters
      if (moduleName === 'properties' && stackedFilters._special) {
        if (stackedFilters._special === 'totalProperties') {
          // show all
        }
        if (stackedFilters._special === 'soldProperties') {
          const st = String(rec.status || '').toLowerCase();
          if (!st.includes('sold') && !st.includes('register') && !st.includes('book')) return false;
        }
        if (stackedFilters._special === 'availProperties') {
          const st = String(rec.status || '').toLowerCase();
          if (st.includes('sold') || st.includes('register') || st.includes('book') || st.includes('inactive')) return false;
        }
        if (stackedFilters._special === 'newMonthProperties') {
          const currentMonth = new Date().getMonth() + 1;
          const currentYear = new Date().getFullYear();
          let isNew = false;
          if (rec.dateAdded) {
            const parts = rec.dateAdded.split('-');
            if (parts.length === 3) {
              const year = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10);
              isNew = (year === currentYear && month === currentMonth);
            }
          } else if (rec.date) {
            const parts = rec.date.split(/[/-]/);
            if (parts.length >= 2) {
              const month = parseInt(parts[1], 10);
              const year = parseInt(parts[2], 10);
              isNew = ((year === currentYear || year === currentYear % 100) && month === currentMonth);
            }
          }
          if (!isNew) return false;
        }
      }

      // Follow-up Stacked Filters
      if (moduleName === 'follow_ups' && stackedFilters._special) {
        const isCompletedRec = (r) => {
          const isInitialStatus = (r.status === 'Pending Call' || r.status === 'Pending');
          const isInitialStage = (r.pipelineAction === 'Fresh Lead' || r.pipelineAction === 'None' || !r.pipelineAction || r.pipelineAction === '');
          return !isInitialStatus || !isInitialStage || r.status === 'Completed' || r.status === 'Call Completed';
        };

        if (stackedFilters._special === 'pendingFollowUps') {
          if (isCompletedRec(rec)) return false;
        }
        if (stackedFilters._special === 'completedFollowUps') {
          if (!isCompletedRec(rec)) return false;
        }
      }

      // Employees Stacked Filters
      if (moduleName === 'employees' && stackedFilters._special) {
        if (stackedFilters._special === 'activeEmployees') {
          if (rec.status === 'Inactive' || rec.status === 'Deleted' || rec.status === 'Archived' || rec.status === 'Removed') return false;
        }
        if (stackedFilters._special === 'presentToday' || stackedFilters._special === 'absentOrLeaveToday') {
          const att = moduleData.attendance || [];
          const presentIds = new Set(
            att
              .filter(a => String(a.date) === todayStr && a.inTime && a.inTime !== '--')
              .map(a => String(a.employeeId))
          );
          const isPresent = presentIds.has(String(rec.id));
          const isActive = rec.status !== 'Inactive' && rec.status !== 'Deleted' && rec.status !== 'Archived' && rec.status !== 'Removed';

          if (!isActive) return false;
          if (stackedFilters._special === 'presentToday' && !isPresent) return false;
          if (stackedFilters._special === 'absentOrLeaveToday' && isPresent) return false;
        }
      }

      // Special KPI filters
      if (stackedFilters._special) {
        if (stackedFilters._special === 'thisMonthVisits' && moduleName === 'site_visits') {
          const currentMonth = new Date().getMonth() + 1;
          const rDate = rec.date || '';
          const parts = rDate.split(/[/-]/);
          if (parts.length === 3) {
            const month = parseInt(parts[1], 10);
            if (month !== currentMonth) return false;
          }
        }
        if (stackedFilters._special === 'positiveFeedback' && moduleName === 'site_visits') {
          const res = String(rec.result || '').toLowerCase();
          if (!res.includes('interest') && !res.includes('confirm') && !res.includes('like')) return false;
        }
        if (stackedFilters._special === 'thisMonthPitches' && moduleName === 'property_pitch_history') {
          const currentMonth = new Date().getMonth() + 1;
          const rDate = rec.pitchDate || '';
          const parts = rDate.split(/[/-]/);
          if (parts.length >= 2) {
            const month = parseInt(parts[1], 10);
            if (month !== currentMonth) return false;
          }
        }
        if (stackedFilters._special === 'activeDealers' && moduleName === 'dealers') {
          if (!rec.visitStatus && !rec.callOutcome) return false;
        }
        if (stackedFilters._special === 'newDealers' && moduleName === 'dealers') {
          const totalCount = records.length;
          if (totalCount <= 5) return true;
          const idNum = parseInt(String(rec.id).replace(/[^0-9]/g, '')) || 0;
          if (idNum <= Math.floor(totalCount * 0.7)) return false;
        }
        if (stackedFilters._special === 'overdue' && moduleName === 'tasks') {
          if (rec.status === 'Completed' || !rec.dueDate || rec.dueDate >= todayStr) return false;
        }
        if (stackedFilters._special === 'dueToday' && moduleName === 'tasks') {
          if (rec.dueDate !== todayStr) return false;
        }
        if (stackedFilters._special === 'inProgressQueries' && moduleName === 'queries') {
          if (rec.status !== 'Approved' || rec.stage === 'Closed') return false;
        }
        if (stackedFilters._special === 'closedQueries' && moduleName === 'queries') {
          if (rec.stage !== 'Closed') return false;
        }
      }

      // Global Search
      const keywords = searchTerm.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
      const matchesSearch = keywords.length === 0 || keywords.every(word => {
        return Object.keys(rec).some(key => {
          const val = rec[key];
          if (val === undefined || val === null) return false;
          return String(val).toLowerCase().includes(word);
        });
      });

      // Stacked Filters
      const matchesFilters = Object.keys(stackedFilters).every(key => {
        if (key === '_special') return true;
        const filterVal = stackedFilters[key];
        if (!filterVal || filterVal === 'ALL') return true;
        
        const recordVal = rec[key];
        if (recordVal === undefined || recordVal === null) return false;

        const fieldObj = fields.find(f => f.name === key);
        const isDateType = fieldObj?.type === 'date' || key.toLowerCase().includes('date');
        
        if (isDateType) {
          const rDateStr = String(recordVal).toLowerCase();
          const fDateStr = String(filterVal).toLowerCase();
          const fParts = fDateStr.split('-');
          if (fParts.length === 3) {
            const yyyy = fParts[0];
            const mm = fParts[1];
            const dd = fParts[2];
            const match1 = `${dd}/${mm}/${yyyy}`;
            const match2 = `${yyyy}-${mm}-${dd}`;
            const match3 = `${dd}-${mm}-${yyyy}`;
            const match4 = `${parseInt(dd, 10)}/${parseInt(mm, 10)}/${yyyy}`;
            const match5 = `${yyyy}/${mm}/${dd}`;
            const match6 = `${parseInt(dd, 10)}-${parseInt(mm, 10)}-${yyyy}`;
            return rDateStr.includes(match1) || 
                   rDateStr.includes(match2) || 
                   rDateStr.includes(match3) || 
                   rDateStr.includes(match4) ||
                   rDateStr.includes(match5) ||
                   rDateStr.includes(match6) ||
                   rDateStr.includes(fDateStr);
          }
        }
        
        return String(recordVal).toLowerCase() === String(filterVal).toLowerCase();
      });

      return matchesSearch && matchesFilters;
    });
  }, [records, searchTerm, stackedFilters, fields]);

  // Sort logic
  const sortedRecords = useMemo(() => {
    const sorted = [...filteredRecords];
    sorted.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'string') {
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return sortDirection === 'asc' 
          ? valA - valB 
          : valB - valA;
      }
    });
    return sorted;
  }, [filteredRecords, sortField, sortDirection]);

  const handleSortRequest = (fieldName) => {
    const isAsc = sortField === fieldName && sortDirection === 'asc';
    setSortDirection(isAsc ? 'desc' : 'asc');
    setSortField(fieldName);
  };

  const handleCreateClick = () => {
    setSelectedRecord(null);
    setFormOpen(true);
  };

  const handleEditClick = (record) => {
    setSelectedRecord(record);
    setFormOpen(true);
  };

  const handleDeleteClick = async (id) => {
    if (window.confirm("Are you sure you want to delete this record?")) {
      const res = await deleteRecord(moduleName, id);
      if (!res.success) {
        setErrorMsg(res.message || 'Delete operation failed.');
      } else {
        fetchModuleData(moduleName);
      }
    }
  };

  const handleFormSubmit = async (formData) => {
    let res;
    if (selectedRecord) {
      res = await updateRecord(moduleName, selectedRecord.id, formData);
    } else {
      res = await createRecord(moduleName, formData);
    }

    if (res.success) {
      setFormOpen(false);
      setSelectedRecord(null);
      fetchModuleData(moduleName);
    } else {
      setErrorMsg(res.message || 'Failed to save record.');
    }
  };

  const handleInspectClick = (type, id) => {
    navigate(`/module/${type}/${id}`);
  };

  const handleExportCSV = () => {
    const headers = fields.filter(f => visibleColumns[f.name]).map(f => f.label);
    const keys = fields.filter(f => visibleColumns[f.name]).map(f => f.name);
    
    const targets = selectedRows.length > 0 
      ? records.filter(r => selectedRows.includes(r.id))
      : sortedRecords;

    let csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(",")].concat(
          targets.map(rec => keys.map(k => {
            const val = rec[k] || '';
            return `"${String(val).replace(/"/g, '""')}"`;
          }).join(","))
        ).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `gagan_realtech_${moduleName}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to delete these ${selectedRows.length} records?`)) {
      setErrorMsg('');
      const res = await bulkDeleteRecord(moduleName, selectedRows);
      if (res.success) {
        setSelectedRows([]);
        fetchModuleData(moduleName);
      } else {
        setErrorMsg(res.message || 'Bulk delete operation failed.');
      }
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header controls */}
      <Box sx={{ mb: 3.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '26px', color: '#0F172A', fontFamily: 'Poppins' }}>
            {moduleConfig.label} Management
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Browse, inspect relationships, configure columns, and export data records.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, nextView) => { if (nextView) setViewMode(nextView); }}
            size="small"
            sx={{ border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}
          >
            <ToggleButton value="table" sx={{ px: 1.5, py: 1 }}>
              <Icons.Table size={16} style={{ marginRight: 6 }} />
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'none' }}>Table</Typography>
            </ToggleButton>
            <ToggleButton value="card" sx={{ px: 1.5, py: 1 }}>
              <Icons.Folder size={16} style={{ marginRight: 6 }} />
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'none' }}>Folders</Typography>
            </ToggleButton>
          </ToggleButtonGroup>

          <Button 
            variant="contained" 
            startIcon={<Icons.Plus size={18} />}
            onClick={handleCreateClick}
            sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, textTransform: 'none', borderRadius: '8px', fontWeight: 700 }}
          >
            Add {getSingularLabel(moduleConfig.label)}
          </Button>
        </Box>
      </Box>

      {errorMsg && (
        <Alert severity="error" onClose={() => setErrorMsg('')} sx={{ mb: 3, borderRadius: '8px' }}>
          {errorMsg}
        </Alert>
      )}

      {/* KPI Cards Row */}
      {(() => {
        const cards = getKPICards();
        if (cards.length === 0) return null;
        return (
          <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
            {cards.map((card, idx) => {
              const CardIcon = Icons[card.iconName] || Icons.Circle;
              return (
                <Grid item xs={12} sm={6} md={2.4} key={idx}>
                  <Card 
                    onClick={card.onClick}
                    sx={{ 
                      cursor: card.onClick ? 'pointer' : 'default',
                      border: card.active ? `2px solid ${card.color}` : '1px solid #E2E8F0', 
                      borderRadius: '16px',
                      boxShadow: card.active ? `0 4px 20px ${card.color}15` : 'none',
                      transition: 'all 0.2s',
                      backgroundColor: '#FFFFFF',
                      position: 'relative',
                      overflow: 'hidden',
                      '&:hover': card.onClick ? { 
                        borderColor: card.color,
                        boxShadow: `0 8px 24px rgba(15,23,42,0.04)`
                      } : {}
                    }}
                  >
                    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Box sx={{ 
                          width: 44, 
                          height: 44, 
                          borderRadius: '50%', 
                          backgroundColor: `${card.color}15`, 
                          color: card.color, 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center' 
                        }}>
                          <CardIcon size={22} strokeWidth={2.5} />
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, display: 'block', textTransform: 'capitalize' }}>
                            {card.title}
                          </Typography>
                          <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '20px', color: '#0F172A', fontFamily: 'Poppins', mt: 0.2 }}>
                            {card.count}
                          </Typography>
                        </Box>
                      </Box>
                      <Typography variant="caption" sx={{ color: card.color, fontWeight: 700, display: 'block', mt: 1.5, fontSize: '10px' }}>
                        {card.subtext}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        );
      })()}

      {/* Shared Responsive Toolbar */}
      <Box sx={{ 
        p: 2, 
        mb: 2.5,
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between', 
        alignItems: { xs: 'stretch', sm: 'center' }, 
        gap: 2, 
        border: '1px solid #E2E8F0', 
        borderRadius: '12px',
        backgroundColor: '#FFFFFF' 
      }}>
        {/* Search */}
        <TextField
          size="small"
          placeholder="Search records..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icons.Search size={16} color="#64748B" />
              </InputAdornment>
            )
          }}
          sx={{ width: { xs: '100%', sm: 280 } }}
        />

        {/* Action Controls */}
        <Box sx={{ 
          display: 'flex', 
          gap: 1.5, 
          overflowX: 'auto', 
          flexWrap: 'nowrap',
          maxWidth: '100%',
          pb: 0.5,
          WebkitOverflowScrolling: 'touch',
          '&::-webkit-scrollbar': { display: 'none' }
        }}>
          {/* Filters Dropdown */}
          <Button 
            variant="outlined" 
            size="small"
            startIcon={<Icons.SlidersHorizontal size={15} />}
            onClick={(e) => setFilterAnchorEl(e.currentTarget)}
            sx={{ borderColor: '#E2E8F0', color: '#0F172A', textTransform: 'none', fontWeight: 600, minWidth: '90px' }}
          >
            Filters
            {Object.keys(stackedFilters).filter(k => stackedFilters[k]).length > 0 && (
              <Chip 
                label={Object.keys(stackedFilters).filter(k => stackedFilters[k]).length} 
                size="small" 
                color="primary" 
                sx={{ ml: 1, height: 18, fontSize: '10px', fontWeight: 800 }} 
              />
            )}
          </Button>

          {/* Sort Dropdown */}
          <Button 
            variant="outlined" 
            size="small"
            startIcon={<Icons.ArrowUpDown size={15} />}
            onClick={(e) => setSortAnchorEl(e.currentTarget)}
            sx={{ borderColor: '#E2E8F0', color: '#0F172A', textTransform: 'none', fontWeight: 600, minWidth: '95px' }}
          >
            Sort By
          </Button>

          {/* Column toggler (Table View only) */}
          {viewMode === 'table' && (
            <Button 
              variant="outlined" 
              size="small"
              startIcon={<Icons.EyeOff size={15} />}
              onClick={() => setColMenuOpen(true)}
              sx={{ borderColor: '#E2E8F0', color: '#0F172A', textTransform: 'none', fontWeight: 600, minWidth: '100px' }}
            >
              Columns
            </Button>
          )}

          {/* Export */}
          <Button 
            variant="outlined" 
            size="small"
            startIcon={<Icons.Download size={15} />}
            onClick={handleExportCSV}
            sx={{ borderColor: '#E2E8F0', color: '#0F172A', textTransform: 'none', fontWeight: 600, minWidth: '90px' }}
          >
            Export
          </Button>

          {/* Bulk Delete */}
          {selectedRows.length > 0 && (
            <Button
              variant="contained"
              color="error"
              size="small"
              startIcon={<Icons.Trash2 size={15} />}
              onClick={handleBulkDelete}
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: '130px' }}
            >
              Delete ({selectedRows.length})
            </Button>
          )}
        </Box>
      </Box>

      {/* Filters Dropdown Menu */}
      <Menu
        anchorEl={filterAnchorEl}
        open={Boolean(filterAnchorEl)}
        onClose={() => setFilterAnchorEl(null)}
        PaperProps={{ style: { padding: '16px', minWidth: 260, borderRadius: '12px' } }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, fontFamily: 'Poppins' }}>Filter Sheets</Typography>
        
        {activeFilterFields.map(fieldName => {
          const fieldLabel = fields.find(f => f.name === fieldName)?.label || fieldName;
          const fieldObj = fields.find(f => f.name === fieldName);
          const isDateType = fieldObj?.type === 'date' || fieldName.toLowerCase().includes('date');
          const opts = filterOptions[fieldName] || [];
          return (
            <Box key={fieldName} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              {isDateType ? (
                <TextField
                  type="date"
                  label={fieldLabel}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  value={stackedFilters[fieldName] || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStackedFilters(prev => ({
                      ...prev,
                      [fieldName]: val || undefined
                    }));
                  }}
                  sx={{ flexGrow: 1 }}
                />
              ) : (
                <FormControl size="small" sx={{ flexGrow: 1 }}>
                  <InputLabel>{fieldLabel}</InputLabel>
                  <Select
                    label={fieldLabel}
                    value={stackedFilters[fieldName] || 'ALL'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStackedFilters(prev => ({
                        ...prev,
                        [fieldName]: val === 'ALL' ? undefined : val
                      }));
                    }}
                  >
                    <MenuItem value="ALL"><em>All options</em></MenuItem>
                    {opts.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <IconButton 
                size="small" 
                color="error" 
                onClick={() => {
                  setActiveFilterFields(prev => prev.filter(f => f !== fieldName));
                  setStackedFilters(prev => {
                    const copy = { ...prev };
                    delete copy[fieldName];
                    return copy;
                  });
                }}
              >
                <Icons.X size={16} />
              </IconButton>
            </Box>
          );
        })}

        <FormControl size="small" fullWidth sx={{ mt: 1, mb: 1.5 }}>
          <InputLabel>Add Filter Column...</InputLabel>
          <Select
            label="Add Filter Column..."
            value=""
            onChange={(e) => {
              const newField = e.target.value;
              if (newField && !activeFilterFields.includes(newField)) {
                setActiveFilterFields(prev => [...prev, newField]);
              }
            }}
          >
            {fields
              .filter(f => f.name !== 'id' && f.name !== 'last_updated' && !activeFilterFields.includes(f.name))
              .map(f => (
                <MenuItem key={f.name} value={f.name}>{f.label}</MenuItem>
              ))
            }
          </Select>
        </FormControl>

        <Box display="flex" justifyContent="space-between" gap={1} sx={{ mt: 1 }}>
          <Button size="small" onClick={() => { setStackedFilters({}); setFilterAnchorEl(null); }}>Reset</Button>
          <Button size="small" variant="contained" onClick={() => setFilterAnchorEl(null)}>Apply</Button>
        </Box>
      </Menu>

      {/* Sort Dropdown Menu */}
      <Menu
        anchorEl={sortAnchorEl}
        open={Boolean(sortAnchorEl)}
        onClose={() => setSortAnchorEl(null)}
        PaperProps={{ style: { padding: '16px', minWidth: 220, borderRadius: '12px' } }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, fontFamily: 'Poppins' }}>Sort Records By</Typography>
        
        <FormControl size="small" fullWidth sx={{ mb: 2 }}>
          <InputLabel>Sort Column</InputLabel>
          <Select
            label="Sort Column"
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
          >
            {fields.map(f => (
              <MenuItem key={f.name} value={f.name}>{f.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth sx={{ mb: 2 }}>
          <InputLabel>Direction</InputLabel>
          <Select
            label="Direction"
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value)}
          >
            <MenuItem value="asc">Ascending (A-Z / 1-9)</MenuItem>
            <MenuItem value="desc">Descending (Z-A / 9-1)</MenuItem>
          </Select>
        </FormControl>

        <Box display="flex" justifyContent="flex-end">
          <Button size="small" variant="contained" onClick={() => setSortAnchorEl(null)}>Done</Button>
        </Box>
      </Menu>

      {/* Column Config Dialog */}
      <Dialog open={colMenuOpen} onClose={() => setColMenuOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, fontFamily: 'Poppins' }}>Configure Display Columns</DialogTitle>
        <DialogContent>
          <FormGroup sx={{ mt: 1 }}>
            {fields.map(f => (
              <FormControlLabel
                key={f.name}
                control={
                  <Checkbox 
                    checked={visibleColumns[f.name] !== false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setVisibleColumns(prev => ({ ...prev, [f.name]: checked }));
                    }}
                  />
                }
                label={f.label}
              />
            ))}
          </FormGroup>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setColMenuOpen(false)} variant="contained">Apply Columns</Button>
        </DialogActions>
      </Dialog>

      {/* Tabular vs Folder/Card view */}
      {viewMode === 'table' ? (
        <Card sx={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)', border: '1px solid #E2E8F0', borderRadius: '16px' }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            {loadingData && sortedRecords.length === 0 ? (
              <Box sx={{ p: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Typography variant="subtitle2" sx={{ color: '#64748B' }}>Loading data records...</Typography>
              </Box>
            ) : (
              <DynamicTable 
                moduleKey={moduleName}
                records={sortedRecords}
                fields={fields}
                visibleColumns={visibleColumns}
                setVisibleColumns={setVisibleColumns}
                selectedRows={selectedRows}
                setSelectedRows={setSelectedRows}
                sortField={sortField}
                sortDirection={sortDirection}
                handleSortRequest={handleSortRequest}
                colMenuOpen={colMenuOpen}
                setColMenuOpen={setColMenuOpen}
                onEditClick={handleEditClick}
                onDeleteClick={handleDeleteClick}
                onInspectClick={handleInspectClick}
                onLogCallClick={handleLogCallClick}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <Box>
          {loadingData && sortedRecords.length === 0 ? (
            <Box sx={{ p: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <Typography variant="subtitle2" sx={{ color: '#64748B' }}>Loading data records...</Typography>
            </Box>
          ) : sortedRecords.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center', color: '#64748B' }}>
              <Typography variant="body2">No matching records found.</Typography>
            </Box>
          ) : (
            <Box>
              {sortedRecords.map(rec => (
                <RecordCard 
                  key={rec.id}
                  rec={rec}
                  fields={fields}
                  handleInspectClick={handleInspectClick}
                  handleEditClick={handleEditClick}
                  handleDeleteClick={handleDeleteClick}
                  moduleName={moduleName}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Create / Edit Dialog Form */}
      <DynamicForm 
        open={formOpen}
        onClose={() => setFormOpen(false)}
        moduleKey={moduleName}
        fields={fields}
        initialData={selectedRecord}
        onSubmit={handleFormSubmit}
      />

      {/* Log Outreach Call Dialog */}
      <Dialog open={callDialogOpen} onClose={() => setCallDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>
          Log Outreach Phone Call for {selectedDealerForCall?.person_name || 'Dealer'}
        </DialogTitle>
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
            if (!selectedDealerForCall) return;
            const payload = {
              dealerId: selectedDealerForCall.id,
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
              fetchModuleData(moduleName); // Refresh the table
            } else {
              alert(res.message || "Failed to log outreach call");
            }
          }}>Log Call</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModuleManager;
