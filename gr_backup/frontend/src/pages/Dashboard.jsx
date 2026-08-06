import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { 
  Box, 
  Grid, 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  List, 
  ListItem, 
  ListItemText,
  Divider,
  Paper,
  Chip,
  Menu,
  MenuItem,
  TextField,
  CircularProgress
} from '@mui/material';
import EntityTooltip from '../components/EntityTooltip';
import * as Icons from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { useApp, API_BASE_URL } from '../context/AppContext';

const COLORS = ['#22C55E', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#6B7280'];

const Dashboard = () => {
  const { 
    moduleData, 
    fetchModuleData, 
    activityLogs, 
    user,
    metadata,
    hasPermission,
    updateRecord,
    createRecord,
    logEmployeeLocation
  } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [swiperIndex, setSwiperIndex] = useState(0);

  // AI Briefing states
  const [aiBriefing, setAiBriefing] = useState(null);
  const [aiBriefingType, setAiBriefingType] = useState('morning');
  const [aiBriefingLoading, setAiBriefingLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState([]);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);

  // Attendance shift timer states
  const [elapsedTimeStr, setElapsedTimeStr] = useState('00:00:00');
  const [timerStatus, setTimerStatus] = useState('Not Checked In');

  const todayDateStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const todayRecord = useMemo(() => {
    return (moduleData.attendance || []).find(
      a => String(a.employeeId) === String(user?.id) && a.date === todayDateStr
    );
  }, [moduleData.attendance, user, todayDateStr]);

  useEffect(() => {
    const fetchBriefing = async () => {
      setAiBriefingLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/ai/daily-evening-summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
          },
          body: JSON.stringify({ type: aiBriefingType })
        });
        const data = await res.json();
        setAiBriefing(data);
      } catch (e) {
        console.error("AI briefing failed:", e);
      } finally {
        setAiBriefingLoading(false);
      }
    };
    fetchBriefing();
  }, [aiBriefingType]);

  useEffect(() => {
    const fetchInsights = async () => {
      setAiInsightsLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/ai/insights`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
          },
          body: JSON.stringify({})
        });
        const data = await res.json();
        setAiInsights(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("AI insights failed:", e);
      } finally {
        setAiInsightsLoading(false);
      }
    };
    fetchInsights();
  }, []);

  useEffect(() => {
    let intervalId = null;

    const parseTime = (timeStr, dateStr) => {
      if (!timeStr || timeStr === '--') return null;
      try {
        const timeMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!timeMatch) return null;
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3].toUpperCase();
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        
        const [year, month, day] = dateStr.split('-').map(Number);
        const d = new Date(year, month - 1, day);
        d.setHours(hours, minutes, 0, 0);
        return d;
      } catch (e) {
        console.error("Error parsing time:", e);
        return null;
      }
    };

    const updateTimer = () => {
      if (!todayRecord) {
        setElapsedTimeStr('00:00:00');
        setTimerStatus('Not Checked In');
        return;
      }

      const checkInTime = parseTime(todayRecord.inTime, todayRecord.date);
      if (!checkInTime) {
        setElapsedTimeStr('00:00:00');
        setTimerStatus('Not Checked In');
        return;
      }

      if (todayRecord.outTime && todayRecord.outTime !== '--') {
        const checkOutTime = parseTime(todayRecord.outTime, todayRecord.date);
        if (checkOutTime) {
          const diffMs = Math.max(0, checkOutTime.getTime() - checkInTime.getTime());
          const hours = Math.floor(diffMs / 3600000);
          const minutes = Math.floor((diffMs % 3600000) / 60000);
          const seconds = Math.floor((diffMs % 60000) / 1000);
          setElapsedTimeStr(
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
          );
          setTimerStatus('Checked Out');
        } else {
          setElapsedTimeStr('00:00:00');
          setTimerStatus('Checked Out');
        }
        return;
      }

      setTimerStatus('Active Shift');
      const now = new Date();
      const diffMs = Math.max(0, now.getTime() - checkInTime.getTime());
      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      setElapsedTimeStr(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateTimer();

    if (todayRecord && (!todayRecord.outTime || todayRecord.outTime === '--')) {
      intervalId = setInterval(updateTimer, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [todayRecord]);

  const handlePunchIn = async () => {
    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30);
      const statusStr = isLate ? 'Late' : 'Present';
      
      const payload = {
        employeeId: user?.id || 'EMP-001',
        date: todayDateStr,
        inTime: timeStr,
        outTime: '--',
        status: statusStr
      };
      await createRecord('attendance', payload);
      fetchModuleData('attendance');
      
      // Auto share location
      if (Capacitor.isNativePlatform()) {
        try {
          await logEmployeeLocation(user?.id, todayDateStr, "Check In via Dashboard");
        } catch (err) {
          console.error("Location share error:", err);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePunchOut = async () => {
    if (!todayRecord) return;
    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      await updateRecord('attendance', todayRecord.id, {
        ...todayRecord,
        outTime: timeStr
      });
      fetchModuleData('attendance');
      
      // Auto stop/log location check-out
      if (Capacitor.isNativePlatform()) {
        try {
          await logEmployeeLocation(user?.id, todayDateStr, "Check Out via Dashboard");
        } catch (err) {
          console.error("Location share error:", err);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Dashboard quick-add dropdown menu controls
  const [addMenuAnchor, setAddMenuAnchor] = useState(null);
  const addMenuOpen = Boolean(addMenuAnchor);
  
  const handleAddClick = (event) => {
    setAddMenuAnchor(event.currentTarget);
  };
  
  const handleAddClose = () => {
    setAddMenuAnchor(null);
  };
  
  const handleAddOption = (moduleKey) => {
    handleAddClose();
    navigate(`/module/${moduleKey}?new=true`);
  };

  const handleToggleTask = async (taskId) => {
    const taskList = moduleData.tasks || [];
    const t = taskList.find(x => x.id === taskId);
    if (!t) return;
    const newStatus = t.status === 'Completed' ? 'Pending' : 'Completed';
    await updateRecord('tasks', taskId, { ...t, status: newStatus });
    fetchModuleData('tasks');
  };

  // Load modules on dashboard boot
  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true);
      const modulesToFetch = [
        'employees',
        'customers',
        'leads',
        'properties',
        'sales',
        'site_visits',
        'follow_ups',
        'attendance',
        'queries',
        'deals',
        'property_pitch_history',
        'dealer_calls',
        'dealer_meetings',
        'documents',
        'tasks'
      ];
      await Promise.all(
        modulesToFetch.map(async (m) => {
          if (hasPermission(m, 'view')) {
            try {
              await fetchModuleData(m);
            } catch (e) {
              console.error(e);
            }
          }
        })
      );
      setLoading(false);
    };
    if (metadata) {
      loadAllData();
    }
  }, [metadata]);

  // Calculate Metrics (Declared at top level so Hooks execute unconditionally)
  const employees = moduleData.employees || [];
  const customers = moduleData.customers || [];
  const leads = moduleData.leads || [];
  const properties = moduleData.properties || [];
  const sales = moduleData.sales || [];
  const followUps = moduleData.follow_ups || [];
  const siteVisits = moduleData.site_visits || [];
  const attendance = moduleData.attendance || [];
  const queries = moduleData.queries || [];
  const deals = moduleData.deals || [];
  const dealerMeetings = moduleData.dealer_meetings || [];
  const dealerCalls = moduleData.dealer_calls || [];
  const documents = moduleData.documents || [];
  const propertyPitches = moduleData.property_pitch_history || [];
  const tasks = moduleData.tasks || [];

  const myTasks = useMemo(() => {
    let filtered = tasks;
    if (user?.role !== 'Admin') {
      filtered = tasks.filter(t => String(t.assignedTo) === String(user?.id));
    }
    // Fetch assignedToName from employee record
    const empList = moduleData.employees || [];
    return [...filtered].map(t => {
      const emp = empList.find(e => String(e.id) === String(t.assignedTo));
      return {
        ...t,
        assignedToName: emp ? emp.name : t.assignedTo
      };
    }).sort((a, b) => {
      if (a.status === 'Completed' && b.status !== 'Completed') return 1;
      if (a.status !== 'Completed' && b.status === 'Completed') return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }, [tasks, user, moduleData.employees]);

  // Upgraded deals-driven revenue intelligence calculations
  const closedDeals = deals.filter(d => d.status === 'Closed');
  const totalSalesVal = closedDeals.reduce((sum, d) => sum + (Number(d.salePrice) || 0), 0);
  const totalCommissionVal = closedDeals.reduce((sum, d) => sum + (Number(d.commissionAmount) || 0), 0);
  
  const revenueToday = closedDeals.filter(d => d.registrationDate === '2026-07-08' || d.registrationDate === '08/07/2026').reduce((sum, d) => sum + (Number(d.salePrice) || 0), 0);
  const revenue7Days = closedDeals.reduce((sum, d) => sum + (Number(d.salePrice) || 0), 0) * 0.4; // Weighted approximation for dashboard representation
  const revenue30Days = closedDeals.reduce((sum, d) => sum + (Number(d.salePrice) || 0), 0) * 0.8;
  const revenueQuarter = totalSalesVal;

  const todayStr = new Date().toISOString().split('T')[0];
  const refDate = '2026-07-08';
  
  // Smart Leads Statistics
  const todayLeadsCount = leads.filter(l => l.dateAdded === refDate).length;
  
  // Smart Queries Statistics
  const activeBuyerQueries = queries.filter(q => q.queryType === 'Buy Property' && (q.status === 'Pending Approval' || q.stage === 'New Query')).length;
  const activeSellerQueries = queries.filter(q => q.queryType === 'Sell Property' && (q.status === 'Pending Approval' || q.stage === 'New Query')).length;
  const pendingDocsCount = documents.filter(d => d.status === 'Pending' || !d.status).length;
  
  // Properties Counters
  const availablePropsCount = properties.filter(p => p.status === 'Available' || !p.status).length;
  const reservedPropsCount = properties.filter(p => p.status === 'Reserved').length;
  const soldPropsCount = properties.filter(p => p.status === 'Sold').length;
  
  // Today's site visits (ref date 2026-07-04 or 2026-07-08)
  const todaysVisitsCount = siteVisits.filter(sv => sv.date === '2026-07-04' || sv.date === '2026-07-08').length;

  const pipelineChartData = useMemo(() => {
    const stages = metadata?.configs?.customerStages || [
      'Fresh Lead / Scheduled',
      'Contacted',
      'Interested / Nurture',
      'Site Visit Arranged',
      'Under Negotiation',
      'Property Booked',
      'Deal Closed',
      'Lost Lead'
    ];
    return stages.map(stage => {
      const count = followUps.filter(f => f.pipelineAction === stage || f.status === stage).length;
      return {
        name: stage,
        "Active Deals": count
      };
    });
  }, [followUps, metadata]);

  // Outreach Leaderboard Map
  const leaderboardMap = {};
  dealerCalls.forEach(c => {
    const rm = c.employeeName || 'Unknown RM';
    leaderboardMap[rm] = (leaderboardMap[rm] || 0) + 1;
  });
  dealerMeetings.filter(m => m.status === 'Completed').forEach(m => {
    const rm = m.assignedEmployeeName || 'Unknown RM';
    leaderboardMap[rm] = (leaderboardMap[rm] || 0) + 2; // Meetings count double weight!
  });
  const leaderboard = Object.keys(leaderboardMap).map(rm => ({
    name: rm,
    score: leaderboardMap[rm]
  })).sort((a, b) => b.score - a.score).slice(0, 5);
  
  const presentToday = attendance.filter(a => a.date === '2026-07-03' && (a.status === 'Present' || a.status === 'Late')).length;
  const availableProperties = availablePropsCount;
  const pendingFollowupsToday = followUps.filter(f => f.status === 'Pending').length;

  const salesChartData = [
    { name: 'Jan', Sales: 12 },
    { name: 'Feb', Sales: 18 },
    { name: 'Mar', Sales: 25 },
    { name: 'Apr', Sales: 22 },
    { name: 'May', Sales: 34 },
    { name: 'Jun', Sales: sales.length * 15 }
  ];

  const leadsByStageMap = leads.reduce((acc, lead) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {});

  const leadsChartData = Object.keys(leadsByStageMap).map(key => ({
    name: key,
    Leads: leadsByStageMap[key]
  }));

  const propertyStatusMap = properties.reduce((acc, prop) => {
    acc[prop.status] = (acc[prop.status] || 0) + 1;
    return acc;
  }, {});

  const propertyPieData = Object.keys(propertyStatusMap).map(key => ({
    name: key,
    value: propertyStatusMap[key]
  }));

  const todaysFollowups = followUps.filter(f => f.date === '2026-07-04');

  const swiperLeads = React.useMemo(() => {
    return leads.filter(l => l.status === 'New' || l.status === 'In Progress' || l.status === 'Assigned');
  }, [leads]);

  const todaysAgenda = React.useMemo(() => {
    const list = [];
    todaysFollowups.forEach(f => {
      list.push({
        id: f.id,
        type: 'followup',
        label: 'Follow Up Callback',
        time: f.time || '11:00 AM',
        title: `Follow-up: ${customers.find(c => c.id === f.customerId)?.name || f.customerId}`,
        status: f.status,
        color: '#F59E0B',
        icon: <Icons.Phone size={14} />,
        link: `/module/follow_ups/${f.id}`
      });
    });

    const todaysVisits = siteVisits.filter(sv => sv.date === '2026-07-04');
    todaysVisits.forEach(sv => {
      list.push({
        id: sv.id,
        type: 'visit',
        label: 'Site Visit Scheduled',
        time: sv.time || '02:00 PM',
        title: `Site Visit: ${customers.find(c => c.id === sv.customerId)?.name || sv.customerId}`,
        status: sv.result || 'Scheduled',
        color: '#2563EB',
        icon: <Icons.MapPin size={14} />,
        link: `/module/site_visits/${sv.id}`
      });
    });

    return list.sort((a, b) => a.time.localeCompare(b.time));
  }, [todaysFollowups, siteVisits, customers]);

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh', gap: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, color: '#475569' }}>Loading Enterprise Dashboard...</Typography>
        <Typography variant="body2" sx={{ color: '#94A3B8' }}>Populating metrics, pipelines, and activities.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, pb: '100px' }}>
      {/* Welcome Greetings Banner */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
        <Box>
          <Typography variant="h2" sx={{ fontWeight: 800, fontSize: { xs: '22px', sm: '28px' }, color: '#0F172A', fontFamily: 'Poppins' }}>
            Welcome back, {user?.name || 'Manager'}
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '13px' }}>
            Here is your sales performance and operational overview for Gagan Realtech today.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, width: { xs: '100%', sm: 'auto' }, justifyContent: 'flex-end' }}>
          <Button 
            variant="outlined" 
            startIcon={<Icons.CalendarDays size={18} />} 
            onClick={() => navigate('/module/attendance')}
            sx={{ borderColor: '#E2E8F0', color: '#0F172A', '&:hover': { backgroundColor: '#F8FAFC' } }}
          >
            Attendance Logs
          </Button>
          <Button 
            variant="contained" 
            startIcon={<Icons.Plus size={18} />} 
            onClick={handleAddClick}
            sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' } }}
          >
            + Add
          </Button>
          <Menu
            anchorEl={addMenuAnchor}
            open={addMenuOpen}
            onClose={handleAddClose}
            PaperProps={{
              sx: {
                borderRadius: '12px',
                mt: 1,
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                border: '1px solid #E2E8F0',
                minWidth: 180
              }
            }}
          >
            {hasPermission('properties', 'create') && (
              <MenuItem onClick={() => handleAddOption('properties')}>
                <Icons.Home size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Property
              </MenuItem>
            )}
            {hasPermission('customers', 'create') && (
              <MenuItem onClick={() => handleAddOption('customers')}>
                <Icons.Users size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Customer
              </MenuItem>
            )}
            {hasPermission('leads', 'create') && (
              <MenuItem onClick={() => handleAddOption('leads')}>
                <Icons.Compass size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Lead
              </MenuItem>
            )}
            {hasPermission('employees', 'create') && (
              <MenuItem onClick={() => handleAddOption('employees')}>
                <Icons.UserSquare2 size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Employee
              </MenuItem>
            )}
            {hasPermission('projects', 'create') && (
              <MenuItem onClick={() => handleAddOption('projects')}>
                <Icons.Layers size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Project
              </MenuItem>
            )}
            {hasPermission('daily_prices', 'create') && (
              <MenuItem onClick={() => handleAddOption('daily_prices')}>
                <Icons.BadgePercent size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Daily Price List
              </MenuItem>
            )}
             {hasPermission('dealers', 'create') && (
              <MenuItem onClick={() => handleAddOption('dealers')}>
                <Icons.Building size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Property Dealer
              </MenuItem>
            )}
            {hasPermission('queries', 'create') && (
              <MenuItem onClick={() => handleAddOption('queries')}>
                <Icons.HelpCircle size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Query
              </MenuItem>
            )}
            {hasPermission('follow_ups', 'create') && (
              <MenuItem onClick={() => handleAddOption('follow_ups')}>
                <Icons.PhoneCall size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Follow Up
              </MenuItem>
            )}
            {hasPermission('property_pitch_history', 'create') && (
              <MenuItem onClick={() => handleAddOption('property_pitch_history')}>
                <Icons.Target size={16} style={{ marginRight: 8, color: '#64748B' }} />
                Property Pitch
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>

      {/* Premium Dashboard KPI Cards Row */}
      <Grid container spacing={3} sx={{ mb: 4.5 }}>
        {[
          { label: 'Total Clients', count: customers.length, icon: <Icons.Users size={20} />, color: '#3B82F6', change: '↑ 18.2% vs last month', path: '/module/customers' },
          { label: 'Total Leads', count: leads.length, icon: <Icons.Target size={20} />, color: '#EC4899', change: '↑ 12.5% vs last month', path: '/module/leads' },
          { label: 'Properties', count: properties.length, icon: <Icons.Home size={20} />, color: '#10B981', change: '↑ 8.4% vs last month', path: '/module/properties' },
          { label: 'Site Visits', count: siteVisits.length, icon: <Icons.MapPin size={20} />, color: '#F59E0B', change: '↓ 5.3% vs last month', path: '/module/site_visits' },
          { label: 'Follow Ups', count: followUps.length, icon: <Icons.PhoneCall size={20} />, color: '#8B5CF6', change: '↑ 15.6% vs last month', path: '/module/follow_ups' }
        ].map((card, idx) => (
          <Grid item xs={12} sm={6} md={2.4} key={idx}>
            <Card 
              onClick={() => navigate(card.path)}
              sx={{ 
                cursor: 'pointer',
                border: '1px solid #E2E8F0', 
                borderRadius: '16px',
                boxShadow: 'none',
                transition: 'all 0.2s',
                backgroundColor: '#FFFFFF',
                '&:hover': { 
                  borderColor: card.color,
                  boxShadow: `0 10px 25px -5px ${card.color}15`,
                  transform: 'translateY(-2px)'
                }
              }}
            >
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2 } }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 700, textTransform: 'uppercase', tracking: '0.05em' }}>
                    {card.label}
                  </Typography>
                  <Box sx={{ 
                    width: 32, 
                    height: 32, 
                    borderRadius: '8px', 
                    backgroundColor: `${card.color}12`, 
                    color: card.color, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    {card.icon}
                  </Box>
                </Box>
                
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: '24px', color: '#0F172A', fontFamily: 'Poppins', mt: 1.5, mb: 0.5 }}>
                  {card.count}
                </Typography>
                
                <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
                  <Typography variant="caption" sx={{ color: card.change.startsWith('↑') ? '#22C55E' : '#EF4444', fontWeight: 700, fontSize: '10px' }}>
                    {card.change}
                  </Typography>
                </Box>

                {/* Smooth wave sparkline */}
                <svg width="100%" height="20" viewBox="0 0 100 20" style={{ overflow: 'visible', marginTop: 8 }}>
                  <path
                    d={idx % 2 === 0 ? "M0,15 Q15,5 30,12 T60,8 T90,14 L100,10" : "M0,10 Q20,16 40,8 T70,12 T100,6"}
                    fill="none"
                    stroke={card.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* QUICK ACTIONS GRID FOR MOBILE-FIRST ONE-HAND USE */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '11px' }}>
          <Icons.Zap size={14} color="#2563EB" /> Quick Actions
        </Typography>
        <Grid container spacing={1.5}>
          {[
            { label: 'Add Client', icon: <Icons.UserPlus size={18} />, color: '#2563EB', path: '/module/customers?new=true' },
            { label: 'Add Lead', icon: <Icons.Star size={18} />, color: '#16A34A', path: '/module/leads?new=true' },
            { label: 'Attendance', icon: <Icons.Clock size={18} />, color: '#F59E0B', path: '/module/attendance' },
            { label: 'Salary', icon: <Icons.CircleDollarSign size={18} />, color: '#10B981', path: '/module/salary' },
            { label: 'Projects', icon: <Icons.FolderOpen size={18} />, color: '#8B5CF6', path: '/module/projects' },
            { label: 'Properties', icon: <Icons.Home size={18} />, color: '#EC4899', path: '/module/properties' },
            { label: 'Employees', icon: <Icons.Users size={18} />, color: '#14B8A6', path: '/module/employees' },
            { label: 'Expenses', icon: <Icons.Receipt size={18} />, color: '#DC2626', path: '/module/salary' }
          ].map((act, idx) => (
            <Grid item xs={6} sm={3} key={idx}>
              <Button
                variant="contained"
                fullWidth
                onClick={() => navigate(act.path)}
                startIcon={act.icon}
                sx={{
                  height: 48,
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '13px',
                  backgroundColor: '#FFFFFF',
                  color: '#0F172A',
                  border: '1px solid #E2E8F0',
                  boxShadow: 'none',
                  justifyContent: 'flex-start',
                  px: 2,
                  '&:hover': {
                    backgroundColor: '#F8FAFC',
                    borderColor: '#CBD5E1',
                    boxShadow: 'none'
                  },
                  '& .MuiButton-startIcon': {
                    color: act.color,
                    mr: 1
                  }
                }}
              >
                {act.label}
              </Button>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* KPI Cards Row (Upgraded with Revenue Intelligence & Mobile Smart Lead Swiper) */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        
        {/* Column 1: Duty Punch Timer */}
        <Grid item xs={12} md={6}>
          <Card sx={{ 
            border: '1px solid #E2E8F0', 
            borderRadius: '16px',
            background: timerStatus === 'Active Shift' 
              ? 'linear-gradient(135deg, #1E1B4B 0%, #311042 100%)' // premium dark space gradient for active
              : 'linear-gradient(135deg, #F8FAFC 0%, #E2E8F0 100%)', // light grey gradient for inactive
            color: timerStatus === 'Active Shift' ? '#FFFFFF' : '#1E293B',
            boxShadow: timerStatus === 'Active Shift' ? '0 10px 25px -5px rgba(30, 27, 75, 0.4)' : 'none',
            position: 'relative',
            overflow: 'hidden',
            transition: 'all 0.3s ease-in-out'
          }}>
            <CardContent sx={{ p: 3, position: 'relative', zIndex: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography variant="caption" sx={{ 
                    color: timerStatus === 'Active Shift' ? '#A5B4FC' : '#64748B', 
                    fontWeight: 700, 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.05em' 
                  }}>
                    Duty Shift Timer
                  </Typography>
                  <Box display="flex" alignItems="center" gap={1.5} sx={{ mt: 1.5 }}>
                    <Icons.Clock size={28} color={timerStatus === 'Active Shift' ? '#818CF8' : '#64748B'} />
                    <Typography variant="h3" sx={{ 
                      fontWeight: 800, 
                      fontFamily: 'Poppins', 
                      letterSpacing: '-0.02em',
                      textShadow: timerStatus === 'Active Shift' ? '0 2px 10px rgba(99, 102, 241, 0.3)' : 'none'
                    }}>
                      {elapsedTimeStr}
                    </Typography>
                  </Box>
                </Box>
                
                <Chip 
                  label={timerStatus === 'Active Shift' ? 'ON DUTY' : (timerStatus === 'Checked Out' ? 'OFF DUTY' : 'NOT PUNCHED')} 
                  size="small" 
                  sx={{ 
                    fontWeight: 700, 
                    backgroundColor: timerStatus === 'Active Shift' ? '#22C55E' : (timerStatus === 'Checked Out' ? '#3B82F6' : '#94A3B8'),
                    color: '#FFFFFF',
                    border: 'none',
                    px: 1,
                    '& .MuiChip-label': { px: 1 }
                  }} 
                />
              </Box>

              <Box sx={{ mt: 3, mb: 1.5 }}>
                {timerStatus === 'Active Shift' ? (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22C55E', animation: 'pulse 1.5s infinite' }} />
                    <Typography variant="body2" sx={{ color: '#E2E8F0', fontWeight: 500 }}>
                      Shift started at <strong>{todayRecord?.inTime}</strong>. Keep up the great work!
                    </Typography>
                  </Box>
                ) : timerStatus === 'Checked Out' ? (
                  <Typography variant="body2" sx={{ color: '#475569', fontWeight: 500 }}>
                    Today's shift: <strong>{todayRecord?.inTime}</strong> to <strong>{todayRecord?.outTime}</strong>.
                  </Typography>
                ) : (
                  <Typography variant="body2" sx={{ color: '#64748B', fontWeight: 500 }}>
                    You have not checked in today yet. Please start your shift to log activities.
                  </Typography>
                )}
              </Box>

              <Divider sx={{ my: 2, borderColor: timerStatus === 'Active Shift' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', borderStyle: 'dashed' }} />

              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" sx={{ color: timerStatus === 'Active Shift' ? '#C7D2FE' : '#64748B', fontWeight: 600 }}>
                  Logged Employee: <strong>{user?.name} ({user?.id})</strong>
                </Typography>
                <Box display="flex" gap={1}>
                  {timerStatus !== 'Active Shift' && timerStatus !== 'Checked Out' && (
                    <Button 
                      size="small" 
                      variant="contained"
                      color="success"
                      onClick={handlePunchIn}
                      sx={{ 
                        borderRadius: '8px', 
                        textTransform: 'none', 
                        fontWeight: 700,
                        boxShadow: 'none',
                        '&:hover': { boxShadow: 'none' }
                      }}
                    >
                      Punch In
                    </Button>
                  )}
                  {timerStatus === 'Active Shift' && (
                    <Button 
                      size="small" 
                      variant="contained"
                      color="error"
                      onClick={handlePunchOut}
                      sx={{ 
                        borderRadius: '8px', 
                        textTransform: 'none', 
                        fontWeight: 700,
                        boxShadow: 'none',
                        '&:hover': { boxShadow: 'none' }
                      }}
                    >
                      Punch Out
                    </Button>
                  )}
                  <Button 
                    size="small" 
                    variant="outlined"
                    sx={{ 
                      borderRadius: '8px', 
                      textTransform: 'none', 
                      fontWeight: 600,
                      color: timerStatus === 'Active Shift' ? '#A5B4FC' : '#475569',
                      borderColor: timerStatus === 'Active Shift' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)',
                      '&:hover': { borderColor: timerStatus === 'Active Shift' ? '#FFFFFF' : '#2563EB' }
                    }}
                    onClick={() => navigate('/module/attendance')}
                  >
                    Terminal
                  </Button>
                </Box>
              </Box>
            </CardContent>
            
            {/* Ambient Background Glow for Active State */}
            {timerStatus === 'Active Shift' && (
              <Box sx={{
                position: 'absolute',
                top: '-50%',
                right: '-30%',
                width: '200px',
                height: '200px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(99,102,241,0) 70%)',
                zIndex: 1,
                pointerEvents: 'none'
              }} />
            )}
          </Card>
        </Grid>

        {/* Column 2: Active Listings & Reps Stats */}
        <Grid item xs={12} md={6}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 700, textTransform: 'uppercase', tracking: '0.05em', display: 'block', mb: 2 }}>
                Active Properties & Listings
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Paper 
                    onClick={() => navigate('/module/customers')}
                    sx={{ p: 1.5, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', cursor: 'pointer', textAlign: 'center', boxShadow: 'none', '&:hover': { borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.01)' } }}
                  >
                    <Icons.Users size={16} style={{ color: '#2563EB', marginBottom: 2 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{customers.length}</Typography>
                    <Typography variant="caption" sx={{ color: '#64748B', fontSize: '10px' }}>Active Customers</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Paper 
                    onClick={() => navigate('/module/properties')}
                    sx={{ p: 1.5, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', cursor: 'pointer', textAlign: 'center', boxShadow: 'none', '&:hover': { borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.01)' } }}
                  >
                    <Icons.Home size={16} style={{ color: '#8B5CF6', marginBottom: 2 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{availableProperties}</Typography>
                    <Typography variant="caption" sx={{ color: '#64748B', fontSize: '10px' }}>Available Units</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Paper 
                    onClick={() => navigate('/module/attendance')}
                    sx={{ p: 1.5, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', cursor: 'pointer', textAlign: 'center', boxShadow: 'none', '&:hover': { borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.01)' } }}
                  >
                    <Icons.Clock size={16} style={{ color: '#10B981', marginBottom: 2 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{presentToday}</Typography>
                    <Typography variant="caption" sx={{ color: '#64748B', fontSize: '10px' }}>Staff Clocked-In</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Paper 
                    onClick={() => navigate('/module/leads')}
                    sx={{ p: 1.5, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', cursor: 'pointer', textAlign: 'center', boxShadow: 'none', '&:hover': { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.01)' } }}
                  >
                    <Icons.PhoneCall size={16} style={{ color: '#F59E0B', marginBottom: 2 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{leads.length}</Typography>
                    <Typography variant="caption" sx={{ color: '#64748B', fontSize: '10px' }}>Total Lead Pool</Typography>
                  </Paper>
                </Grid>
              </Grid>

              <Divider sx={{ my: 2, borderStyle: 'dashed' }} />

              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={1}>
                  <Icons.MapPin size={16} style={{ color: '#EF4444' }} />
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B' }}>
                    Punch-in Live Geo Tracking
                  </Typography>
                </Box>
                <Chip label="Live Monitoring" size="small" color="success" sx={{ fontSize: '9px', fontWeight: 700 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Mobile-Only Smart Lead Swiper (Tinder-style) */}
        <Grid item xs={12} sx={{ display: { xs: 'block', md: 'none' } }}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', backgroundColor: 'rgba(37,99,235,0.01)' }}>
            <CardContent sx={{ p: 3 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Icons.Zap size={16} style={{ color: '#F59E0B' }} />
                  Smart Lead Swiper (Mobile Desk)
                </Typography>
                <Chip label={`Untracked: ${swiperLeads.length}`} size="small" color="primary" sx={{ fontWeight: 700, fontSize: '10px' }} />
              </Box>
              
              {swiperLeads.length === 0 || !swiperLeads[swiperIndex % swiperLeads.length] ? (
                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" sx={{ py: 4, textAlign: 'center', color: '#94A3B8' }}>
                  <Icons.Sparkles size={36} style={{ marginBottom: 8, color: '#F59E0B' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Lead Pool Fully Swept! 🎉</Typography>
                  <Typography variant="caption">All new properties leads are actioned.</Typography>
                </Box>
              ) : (() => {
                const currentLead = swiperLeads[swiperIndex % swiperLeads.length];
                return (
                  <Box>
                    <Paper sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', mb: 2, backgroundColor: '#FFFFFF' }}>
                      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E293B' }}>
                          {currentLead.name || 'Anonymous Client'}
                        </Typography>
                        <Chip label={currentLead.id} size="small" variant="outlined" sx={{ fontSize: '9px', height: 18 }} />
                      </Box>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 0.5 }}>
                        Source: <strong>{currentLead.source || 'Direct Enquiry'}</strong>
                      </Typography>
                      {currentLead.budget && (
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 0.5 }}>
                          Budget range: <strong>₹{Number(currentLead.budget).toLocaleString('en-IN')}</strong>
                        </Typography>
                      )}
                      {currentLead.requirements && (
                        <Typography variant="body2" sx={{ color: '#334155', mt: 1, p: 1, backgroundColor: '#F8FAFC', borderRadius: '6px', fontStyle: 'italic', fontSize: '12px' }}>
                          "{currentLead.requirements}"
                        </Typography>
                      )}

                      {/* Contact Channels */}
                      <Box display="flex" gap={2} sx={{ mt: 2 }}>
                        {currentLead.phone && (
                          <Button 
                            size="small" 
                            variant="text" 
                            startIcon={<Icons.Phone size={14} />} 
                            href={`tel:${currentLead.phone}`}
                            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '11px', p: 0 }}
                          >
                            Call Rep
                          </Button>
                        )}
                        {currentLead.phone && (
                          <Button 
                            size="small" 
                            variant="text" 
                            color="success"
                            startIcon={<Icons.MessageCircle size={14} />} 
                            href={`https://wa.me/91${currentLead.phone}?text=Hi%20${encodeURIComponent(currentLead.name || '')},%20this%20is%20Gagan%20Realtech%20following%20up.`}
                            target="_blank"
                            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '11px', p: 0 }}
                          >
                            WhatsApp Client
                          </Button>
                        )}
                      </Box>
                    </Paper>

                    <Box display="flex" gap={2} justifyContent="center">
                      <Button 
                        variant="outlined" 
                        color="error" 
                        size="small" 
                        startIcon={<Icons.X size={14} />}
                        onClick={() => setSwiperIndex(prev => prev + 1)}
                        sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 700, px: 2 }}
                      >
                        Pass / Skip
                      </Button>
                      <Button 
                        variant="contained" 
                        color="primary" 
                        size="small" 
                        startIcon={<Icons.ArrowRight size={14} />}
                        onClick={() => navigate(`/module/leads/${currentLead.id}`)}
                        sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 700, px: 2, backgroundColor: '#2563EB' }}
                      >
                        Action Lead
                      </Button>
                    </Box>
                  </Box>
                );
              })()}
            </CardContent>
          </Card>
        </Grid>

        {/* Computer-Only Self-Service Intake QR & Link (Differentiating Mobile vs computer features) */}
        <Grid item xs={12} md={6} sx={{ display: { xs: 'none', md: 'block' } }}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%', minHeight: '320px', background: 'linear-gradient(135deg, rgba(37,99,235,0.02) 0%, rgba(13,148,136,0.02) 100%)' }}>
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, fontFamily: 'Poppins' }}>
                <Icons.QrCode size={18} style={{ color: '#2563EB' }} />
                Customer Intake QR (Self-Service)
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 2 }}>
                Share this QR code or link with prospective buyers. When opened, it displays a premium requirements registration form that automatically injects a brand new lead into the CRM.
              </Typography>

              <Box display="flex" alignItems="center" gap={3} sx={{ mt: 1 }}>
                <Paper variant="outlined" sx={{ p: 1, borderRadius: '12px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(window.location.origin + '/intake')}`} 
                    alt="Intake QR"
                    style={{ width: 120, height: 120, borderRadius: '6px' }}
                  />
                </Paper>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#475569', display: 'block', mb: 0.5 }}>
                    Copy Link URL:
                  </Typography>
                  <TextField
                    value={window.location.origin + '/intake'}
                    size="small"
                    readOnly
                    fullWidth
                    sx={{ backgroundColor: '#FFFFFF', mb: 1 }}
                    InputProps={{
                      endAdornment: (
                        <Button 
                          size="small" 
                          variant="text" 
                          onClick={() => {
                            navigator.clipboard.writeText(window.location.origin + '/intake');
                            alert('Link copied to clipboard!');
                          }}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          Copy
                        </Button>
                      )
                    }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    color="primary"
                    startIcon={<Icons.Share2 size={14} />}
                    href={`https://wa.me/?text=${encodeURIComponent(`Dear client, please fill in your property requirements here: ${window.location.origin}/intake`)}`}
                    target="_blank"
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' } }}
                  >
                    Share Form Link
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Employee Quick-Add QR & Link */}
        <Grid item xs={12} md={6} sx={{ display: { xs: 'none', md: 'block' } }}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%', minHeight: '320px', background: 'linear-gradient(135deg, rgba(245,158,11,0.02) 0%, rgba(16,185,129,0.02) 100%)' }}>
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, fontFamily: 'Poppins' }}>
                <Icons.PlusCircle size={18} style={{ color: '#F59E0B' }} />
                Employee Quick-Add QR (Universal Intake)
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 2 }}>
                Scan this QR to quickly register leads, customers, properties, projects, site visits, or tasks on the fly from any mobile device without active log-in.
              </Typography>

              <Box display="flex" alignItems="center" gap={3} sx={{ mt: 1 }}>
                <Paper variant="outlined" sx={{ p: 1, borderRadius: '12px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(window.location.origin + '/quick-add')}`} 
                    alt="Quick-Add QR"
                    style={{ width: 120, height: 120, borderRadius: '6px' }}
                  />
                </Paper>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#475569', display: 'block', mb: 0.5 }}>
                    Copy Link URL:
                  </Typography>
                  <TextField
                    value={window.location.origin + '/quick-add'}
                    size="small"
                    readOnly
                    fullWidth
                    sx={{ backgroundColor: '#FFFFFF', mb: 1 }}
                    InputProps={{
                      endAdornment: (
                        <Button 
                          size="small" 
                          variant="text" 
                          onClick={() => {
                            navigator.clipboard.writeText(window.location.origin + '/quick-add');
                            alert('Link copied to clipboard!');
                          }}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          Copy
                        </Button>
                      )
                    }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    color="secondary"
                    startIcon={<Icons.Share2 size={14} />}
                    href={`https://wa.me/?text=${encodeURIComponent(`Quick-add portal for Gagan Realtech staff: ${window.location.origin}/quick-add`)}`}
                    target="_blank"
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', backgroundColor: '#F59E0B', '&:hover': { backgroundColor: '#D97706' } }}
                  >
                    Share Portal Link
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

      </Grid>

      {/* PREMIUM AI COPILOT BRIEFING & REAL ESTATE INSIGHTS */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Card 1: AI Copilot Briefings */}
        <Grid item xs={12} md={6}>
          <Card sx={{ border: '1px solid #BFDBFE', borderRadius: '16px', backgroundColor: '#EFF6FF', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '15px', color: '#1E3A8A', fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icons.Sparkles size={18} color="#2563EB" />
                  AI Shift Briefing
                </Typography>
                <Box sx={{ display: 'flex', backgroundColor: '#DBEAFE', borderRadius: '8px', p: 0.5 }}>
                  <Button 
                    size="small" 
                    variant={aiBriefingType === 'morning' ? 'contained' : 'text'}
                    onClick={() => setAiBriefingType('morning')}
                    sx={{ 
                      fontSize: '10px', 
                      fontWeight: 700, 
                      borderRadius: '6px', 
                      px: 1.5, 
                      py: 0.5,
                      textTransform: 'none',
                      backgroundColor: aiBriefingType === 'morning' ? '#2563EB' : 'transparent',
                      color: aiBriefingType === 'morning' ? '#FFFFFF' : '#1E3A8A',
                      boxShadow: 'none',
                      '&:hover': { backgroundColor: aiBriefingType === 'morning' ? '#1D4ED8' : 'transparent', boxShadow: 'none' }
                    }}
                  >
                    Morning Goals
                  </Button>
                  <Button 
                    size="small" 
                    variant={aiBriefingType === 'evening' ? 'contained' : 'text'}
                    onClick={() => setAiBriefingType('evening')}
                    sx={{ 
                      fontSize: '10px', 
                      fontWeight: 700, 
                      borderRadius: '6px', 
                      px: 1.5, 
                      py: 0.5,
                      textTransform: 'none',
                      backgroundColor: aiBriefingType === 'evening' ? '#2563EB' : 'transparent',
                      color: aiBriefingType === 'evening' ? '#FFFFFF' : '#1E3A8A',
                      boxShadow: 'none',
                      '&:hover': { backgroundColor: aiBriefingType === 'evening' ? '#1D4ED8' : 'transparent', boxShadow: 'none' }
                    }}
                  >
                    Evening Summary
                  </Button>
                </Box>
              </Box>

              {aiBriefingLoading ? (
                <Box display="flex" justifyContent="center" alignItems="center" flex={1} py={4}>
                  <CircularProgress size={24} sx={{ color: '#2563EB' }} />
                </Box>
              ) : aiBriefing ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {aiBriefingType === 'morning' ? (
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Expected Follow-ups</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#1E3A8A' }}>{aiBriefing.todayFollowups || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Scheduled Site Visits</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#1E3A8A' }}>{aiBriefing.todayVisits || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Overdue Tasks</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#EF4444' }}>{aiBriefing.overdueTasks || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>RMs on Leave</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#F59E0B' }}>{aiBriefing.employeesOnLeave || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={12}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 700, display: 'block', mb: 0.5 }}>Priority Clients To Call Today:</Typography>
                          <Box display="flex" gap={1} flexWrap="wrap">
                            {(aiBriefing.priorityCustomers || []).map((name, idx) => (
                              <Chip key={idx} label={name} size="small" sx={{ backgroundColor: '#DBEAFE', color: '#1E3A8A', fontWeight: 700 }} />
                            ))}
                          </Box>
                        </Paper>
                      </Grid>
                    </Grid>
                  ) : (
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Calls Executed</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#1E3A8A' }}>{aiBriefing.callsCompleted || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Site Visits Handled</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#1E3A8A' }}>{aiBriefing.visitsCompleted || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Deals Closed Today</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#22C55E' }}>{aiBriefing.dealsClosed || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={6}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>Pending Reminders</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: '#64748B' }}>{aiBriefing.pendingTasks || 0}</Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={12}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px', border: '1px solid #BFDBFE', backgroundColor: '#FFFFFF' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 700, display: 'block', mb: 0.5 }}>Recommended Agenda For Tomorrow:</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#1E293B', fontSize: '13px' }}>{aiBriefing.scheduleTomorrow || 'No additional schedule generated.'}</Typography>
                        </Paper>
                      </Grid>
                    </Grid>
                  )}
                </Box>
              ) : (
                <Typography variant="body2" sx={{ color: '#64748B', py: 4, textAlign: 'center' }}>Insufficient CRM data available to generate briefing.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Card 2: AI Real Estate Insights & Alerts */}
        <Grid item xs={12} md={6}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '15px', color: '#0F172A', fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icons.TrendingUp size={18} color="#10B981" />
                AI Realtech Insights
              </Typography>

              {aiInsightsLoading ? (
                <Box display="flex" justifyContent="center" alignItems="center" flex={1} py={4}>
                  <CircularProgress size={24} sx={{ color: '#10B981' }} />
                </Box>
              ) : aiInsights.length > 0 ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {aiInsights.map((insight, idx) => (
                    <Box key={idx} display="flex" gap={1.5} alignItems="flex-start">
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10B981', mt: 1, flexShrink: 0 }} />
                      <Typography variant="body2" sx={{ fontWeight: 500, color: '#334155', lineHeight: 1.5, fontSize: '13px' }}>
                        {insight}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" sx={{ color: '#64748B', py: 4, textAlign: 'center' }}>Insufficient CRM data available to compile insights.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={8}>
          <Card sx={{ height: '380px', display: 'flex', flexDirection: 'column', p: 1 }}>
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icons.CheckSquare size={20} color="#2563EB" />
                  Task Assigned Panel
                </Typography>
                <Chip 
                  label={`${myTasks.filter(t => t.status !== 'Completed').length} Pending`} 
                  color="primary" 
                  size="small" 
                  sx={{ fontWeight: 700, backgroundColor: 'rgba(37,99,235,0.1)', color: '#2563EB' }} 
                />
              </Box>
              
              <Box sx={{ flex: 1, overflowY: 'auto', pr: 1 }}>
                {myTasks.length === 0 ? (
                  <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" sx={{ py: 6, color: '#94A3B8' }}>
                    <Icons.Inbox size={48} strokeWidth={1} sx={{ mb: 1, color: '#94A3B8' }} />
                    <Typography variant="body2">No tasks assigned.</Typography>
                  </Box>
                ) : (
                  <List disablePadding>
                    {myTasks.map(task => (
                      <ListItem 
                        key={task.id} 
                        sx={{ 
                          mb: 1.5, 
                          p: 1.5, 
                          border: '1px solid #E2E8F0', 
                          borderRadius: '12px', 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          backgroundColor: '#F8FAFC',
                          '&:hover': { backgroundColor: '#F1F5F9' }
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1.5} sx={{ flex: 1, minWidth: 0 }}>
                          <IconButton 
                            size="small" 
                            onClick={() => handleToggleTask(task.id)}
                            sx={{ color: task.status === 'Completed' ? '#22C55E' : '#64748B', p: 0.5 }}
                          >
                            {task.status === 'Completed' ? <Icons.CheckCircle2 size={20} /> : <Icons.Circle size={20} />}
                          </IconButton>
                          <Box sx={{ minWidth: 0 }}>
                            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                              <Chip 
                                label={task.id} 
                                size="small" 
                                onClick={() => navigate(`/module/tasks/${task.id}`)}
                                sx={{ cursor: 'pointer', borderRadius: '4px', fontWeight: 700, fontSize: '10px', backgroundColor: '#E2E8F0' }} 
                              />
                              <Typography variant="body2" sx={{ fontWeight: 700, textDecoration: task.status === 'Completed' ? 'line-through' : 'none', color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {task.title}
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: '#64748B', mt: 0.5, display: 'block' }}>
                              Due: {task.dueDate} {task.assignedToName ? `| Assigned: ${task.assignedToName}` : ''}
                            </Typography>
                          </Box>
                        </Box>
                        <Box display="flex" gap={1} sx={{ ml: 1, flexShrink: 0 }}>
                          <Chip 
                            label={task.priority} 
                            size="small" 
                            sx={{ 
                              fontWeight: 700, 
                              fontSize: '9px',
                              backgroundColor: task.priority === 'High' ? 'rgba(239,68,68,0.1)' : task.priority === 'Medium' ? 'rgba(245,158,11,0.1)' : 'rgba(37,99,235,0.1)',
                              color: task.priority === 'High' ? '#EF4444' : task.priority === 'Medium' ? '#F59E0B' : '#2563EB'
                            }} 
                          />
                          <Chip 
                            label={task.status} 
                            size="small" 
                            sx={{ 
                              fontWeight: 700, 
                              fontSize: '9px',
                              backgroundColor: task.status === 'Completed' ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
                              color: task.status === 'Completed' ? '#22C55E' : '#64748B'
                            }} 
                          />
                        </Box>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card 
            onClick={() => navigate('/module/properties')}
            sx={{ height: '380px', display: 'flex', flexDirection: 'column', p: 1, cursor: 'pointer', '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.08)' } }}
          >
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 2, fontFamily: 'Poppins' }}>
                Property Pipeline Status
              </Typography>
              <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {propertyPieData.length === 0 ? (
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>No property listings</Typography>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={propertyPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {propertyPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center', mt: 1 }}>
                {propertyPieData.map((entry, index) => (
                  <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: COLORS[index % COLORS.length] }} />
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{entry.name} ({entry.value})</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Operational Lists Grid */}
      <Grid container spacing={3}>
        
        {/* Today's Agenda Checklist */}
        <Grid item xs={12} md={4}>
          <Card 
            onClick={() => navigate('/module/follow_ups')}
            sx={{ height: '400px', display: 'flex', flexDirection: 'column', cursor: 'pointer', '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.08)' } }}
          >
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', fontFamily: 'Poppins' }}>
                  🔔 Daily Agenda Reminders
                </Typography>
                <Chip label={`${todaysAgenda.length} Scheduled`} color="warning" size="small" sx={{ fontWeight: 700 }} />
              </Box>
              <Divider />
              <Box sx={{ flex: 1, overflowY: 'auto', mt: 1, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: '#F1F5F9' } }}>
                {todaysAgenda.length === 0 ? (
                  <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" color="#94A3B8">
                    <Icons.Bell size={32} style={{ marginBottom: 8 }} />
                    <Typography variant="body2">No site visits or callbacks today</Typography>
                  </Box>
                ) : (
                  <List disablePadding>
                    {todaysAgenda.map((item, idx) => (
                      <ListItem 
                        key={idx} 
                        disablePadding 
                        sx={{ py: 1.5, borderBottom: '1px solid #F1F5F9', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.01)' } }}
                        onClick={() => navigate(item.link)}
                      >
                        <Box sx={{ p: 1, mr: 2, borderRadius: '8px', backgroundColor: 'rgba(15,23,42,0.03)', color: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {item.icon}
                        </Box>
                        <ListItemText 
                          primary={item.title}
                          secondary={`${item.time} • ${item.label}`}
                          primaryTypographyProps={{ fontWeight: 600, fontSize: '13px' }}
                          secondaryTypographyProps={{ fontSize: '11px' }}
                        />
                        <Chip label={item.status} size="small" sx={{ fontSize: '8px', height: 18, fontWeight: 700 }} />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Site Visits */}
        <Grid item xs={12} md={4}>
          <Card 
            onClick={() => navigate('/module/site_visits')}
            sx={{ height: '400px', display: 'flex', flexDirection: 'column', cursor: 'pointer', '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.08)' } }}
          >
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', fontFamily: 'Poppins' }}>
                  Site Visits Booked
                </Typography>
                <Chip label={`${siteVisits.length} Total`} color="primary" size="small" sx={{ fontWeight: 700 }} />
              </Box>
              <Divider />
              <Box sx={{ flex: 1, overflowY: 'auto', mt: 1, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: '#F1F5F9' } }}>
                {siteVisits.length === 0 ? (
                  <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" color="#94A3B8">
                    <Icons.Eye size={32} style={{ marginBottom: 8 }} />
                    <Typography variant="body2">No site visits scheduled</Typography>
                  </Box>
                ) : (
                  <List disablePadding>
                    {siteVisits.slice(0, 5).map(sv => {
                      const client = customers.find(c => c.id === sv.customerId) || leads.find(l => l.id === sv.customerId) || { name: sv.customerId };
                      const prop = properties.find(p => p.id === sv.propertyId);
                      const propDesc = prop ? `${prop.locality || ''} ${prop.sector_block ? `Sector ${prop.sector_block}` : ''} (${prop.id})`.trim() : sv.propertyId;
                      return (
                        <ListItem key={sv.id} disablePadding sx={{ py: 1.5, borderBottom: '1px solid #F1F5F9' }}>
                          <ListItemText 
                            primary={client.name}
                            secondary={`Property: ${propDesc} • Visit Date: ${sv.date}`}
                            primaryTypographyProps={{ fontWeight: 600, fontSize: '14px' }}
                            secondaryTypographyProps={{ fontSize: '12px' }}
                          />
                          <Chip label={sv.result} size="small" color={sv.result === 'Interested' ? 'success' : 'secondary'} sx={{ borderRadius: '4px', fontSize: '10px', height: 20 }} />
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Activity Logs */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 2, fontFamily: 'Poppins' }}>
                Recent System Activity
              </Typography>
              <Divider />
              <Box sx={{ flex: 1, overflowY: 'auto', mt: 1, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: '#F1F5F9' } }}>
                {activityLogs.length === 0 ? (
                  <Typography variant="body2" sx={{ color: '#94A3B8', p: 2 }}>No recent system activities.</Typography>
                ) : (
                  <List disablePadding>
                    {activityLogs.slice(0, 5).map((log, index) => (
                      <ListItem key={index} disablePadding sx={{ py: 1, borderBottom: '1px solid #F1F5F9', alignItems: 'flex-start' }}>
                        <Box sx={{ mt: 0.5, mr: 1.5, color: '#3B82F6' }}>
                          <Icons.Activity size={16} />
                        </Box>
                        <ListItemText 
                          primary={log.action}
                          secondary={`By: ${log.employeeName} • ${log.dateTime}`}
                          primaryTypographyProps={{ fontSize: '13px', fontWeight: 600 }}
                          secondaryTypographyProps={{ fontSize: '11px' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>


      {/* Upgraded ERP Pipelines & Leaderboard */}
      <Grid container spacing={3} sx={{ mb: 4, mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icons.PhoneCall size={20} style={{ color: '#2563EB' }} />
                CRM Activity & Outreach Overview
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Paper 
                    onClick={() => navigate('/module/dealer_calls')}
                    sx={{ p: 2, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', boxShadow: 'none', cursor: 'pointer', '&:hover': { backgroundColor: '#F1F5F9' } }}
                  >
                    <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontWeight: 600 }}>DEALER CALLS LOGGED</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#2563EB', mt: 0.5 }}>{dealerCalls.length}</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6}>
                  <Paper 
                    onClick={() => navigate('/module/dealer_meetings')}
                    sx={{ p: 2, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', boxShadow: 'none', cursor: 'pointer', '&:hover': { backgroundColor: '#F1F5F9' } }}
                  >
                    <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontWeight: 600 }}>DEALER MEETINGS</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#F59E0B', mt: 0.5 }}>{dealerMeetings.length}</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6}>
                  <Paper 
                    onClick={() => navigate('/module/site_visits')}
                    sx={{ p: 2, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', boxShadow: 'none', cursor: 'pointer', '&:hover': { backgroundColor: '#F1F5F9' } }}
                  >
                    <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontWeight: 600 }}>SITE VISITS ARRANGED</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#16A34A', mt: 0.5 }}>{siteVisits.length}</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6}>
                  <Paper 
                    onClick={() => navigate('/module/property_pitch_history')}
                    sx={{ p: 2, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', boxShadow: 'none', cursor: 'pointer', '&:hover': { backgroundColor: '#F1F5F9' } }}
                  >
                    <Typography variant="caption" sx={{ color: '#64748B', display: 'block', fontWeight: 600 }}>PROPERTY PITCHES</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#8B5CF6', mt: 0.5 }}>{propertyPitches.length}</Typography>
                  </Paper>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icons.TrendingUp size={20} style={{ color: '#F59E0B' }} />
                Dealer Outreach Leaderboard (This Month)
              </Typography>
              {leaderboard.length === 0 ? (
                <Typography variant="body2" sx={{ color: '#94A3B8', py: 4, textAlign: 'center' }}>No outreach logs recorded by RMs yet.</Typography>
              ) : (
                <List disablePadding>
                  {leaderboard.map((rm, idx) => (
                    <ListItem key={idx} disablePadding sx={{ py: 1, borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box display="flex" alignItems="center" gap={1.5}>
                        <Chip 
                          label={`#${idx + 1}`} 
                          size="small" 
                          sx={{ 
                            fontWeight: 800, 
                            backgroundColor: idx === 0 ? '#FEF3C7' : idx === 1 ? '#E2E8F0' : idx === 2 ? '#FFEDD5' : '#F1F5F9', 
                            color: idx === 0 ? '#D97706' : idx === 1 ? '#475569' : idx === 2 ? '#C2410C' : '#64748B' 
                          }} 
                        />
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{rm.name}</Typography>
                      </Box>
                      <Chip label={`${rm.score} Outreach Points`} color="primary" size="small" variant="outlined" sx={{ fontWeight: 700 }} />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      </Grid>
    </Box>
  );
};

export default Dashboard;
