import React, { useState } from 'react';
import { 
  Box, 
  Container, 
  Typography, 
  Grid, 
  Card, 
  CardContent, 
  TextField, 
  InputAdornment, 
  Chip, 
  Paper,
  Tabs,
  Tab,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Avatar
} from '@mui/material';
import * as Icons from 'lucide-react';

const modulesData = [
  {
    name: "Employees",
    icon: "Users",
    role: "staff profiles, roles, and login access.",
    relations: "Connected to every module. Whichever employee is assigned handles that Lead, Customer, Deal, Task, Attendance, Leave, Salary, and Location entry.",
    color: "#EF4444"
  },
  {
    name: "Customers",
    icon: "UserCheck",
    role: "master record of confirmed clients and their buying/selling stage.",
    relations: "Related to Leads (a Lead becomes a Customer), Follow-ups, Queries, Site Visits, Deals, and Sales. Changing the assigned employee here updates the same client's Lead, Follow-up, Query, and Site Visit too.",
    color: "#3B82F6"
  },
  {
    name: "Leads",
    icon: "UserPlus",
    role: "new enquiries before they become confirmed customers.",
    relations: "Related to Customers (converts into one), Follow-ups (auto-created on acceptance), Queries (auto-created if phone number already exists), and Properties (a Seller lead auto-creates a Property).",
    color: "#10B981"
  },
  {
    name: "Properties",
    icon: "Home",
    role: "inventory of listings with owner and status details.",
    relations: "Related to Leads, Customers, Queries, and Follow-ups. Any change in property details (price, size, locality) updates all these linked records automatically. Ownership changes when a Deal or Pitch is closed.",
    color: "#F59E0B"
  },
  {
    name: "Projects",
    icon: "Building2",
    role: "real-estate projects/developments the properties belong to.",
    relations: "Related to Properties only — groups properties under one project/development.",
    color: "#8B5CF6"
  },
  {
    name: "Site Visits",
    icon: "Map",
    role: "scheduled and completed property visits with clients.",
    relations: "Related to Follow-ups (auto-created when stage = \"Site Visit\"), Customers/Leads (who is visiting), Employees (who is conducting it), and Properties (which property is being shown).",
    color: "#EC4899"
  },
  {
    name: "Follow-ups",
    icon: "PhoneCall",
    role: "call/task pipeline tracking a client's next action and stage.",
    relations: "Related to almost everything — Site Visits, Deals, Queries, Leads, and Customers. This is the central module; changing its stage can trigger a Site Visit, close a Deal, or transfer property ownership.",
    color: "#6366F1"
  },
  {
    name: "Attendance",
    icon: "Clock",
    role: "daily punch-in/out and presence status of employees.",
    relations: "Related to Employees (whose attendance is recorded) and Salaries (feeds directly into salary calculation).",
    color: "#14B8A6"
  },
  {
    name: "Leaves",
    icon: "CalendarX",
    role: "leave requests and approvals for employees.",
    relations: "Related to Employees, Attendance (counted there), and Salaries (first 4 leaves/month paid, rest deducted).",
    color: "#F43F5E"
  },
  {
    name: "Sales",
    icon: "CircleDollarSign",
    role: "recorded bookings and sales transactions.",
    relations: "Related to Customers (buyer), Properties (item sold), and Employees (salesperson).",
    color: "#10B981"
  },
  {
    name: "Tasks",
    icon: "CheckSquare",
    role: "general to-do items assigned to staff.",
    relations: "Related to Employees only — general to-dos assigned to staff.",
    color: "#6B7280"
  },
  {
    name: "Daily Prices",
    icon: "TrendingUp",
    role: "day-wise property/market price updates.",
    relations: "Related to Properties — tracks daily price changes for listings.",
    color: "#059669"
  },
  {
    name: "Dealers",
    icon: "Network",
    role: "external property dealers/agents and their details.",
    relations: "Related to Dealer Calls (updates dealer remarks) and Dealer Meetings (visit assigned to an Employee).",
    color: "#D97706"
  },
  {
    name: "Location Tracker",
    icon: "Navigation",
    role: "live GPS tracking of field employees.",
    relations: "Related to Employees — GPS path and distance are saved on the employee's profile.",
    color: "#2563EB"
  },
  {
    name: "Notices",
    icon: "Megaphone",
    role: "internal announcements and notes for staff.",
    relations: "Related to Employees — announcements shown to staff.",
    color: "#7C3AED"
  },
  {
    name: "Salaries",
    icon: "Wallet",
    role: "monthly payroll calculation and payslip records.",
    relations: "Related to Employees, Attendance, and Leaves — pulls present/absent/leave data to calculate final pay.",
    color: "#059669"
  },
  {
    name: "Queries",
    icon: "HelpCircle",
    role: "specific buy/sell requirements raised by a customer or lead.",
    relations: "Related to Customers/Leads (who raised it), Properties (a Sell query can create a listing), and Follow-ups (auto-schedules a call).",
    color: "#3B82F6"
  },
  {
    name: "Deals",
    icon: "Handshake",
    role: "finalized, closed transactions.",
    relations: "Related to Properties (ownership transfer), Customers (buyer), Leads (converted if needed), and Employees (deal owner).",
    color: "#16A34A"
  },
  {
    name: "Property Pitch History",
    icon: "Send",
    role: "log of which properties were pitched to which clients.",
    relations: "Related to Follow-ups (auto-completes a call task), Queries and Customers (updates their stage), and Properties (transfers ownership if deal closes).",
    color: "#8B5CF6"
  },
  {
    name: "Dealer Calls",
    icon: "PhoneForwarded",
    role: "call logs with external dealers.",
    relations: "Related to Dealers — each call updates the dealer's main record.",
    color: "#F59E0B"
  },
  {
    name: "Dealer Meetings",
    icon: "Users2",
    role: "scheduled meetings with external dealers.",
    relations: "Related to Dealers and Employees — assigning a meeting notifies the employee.",
    color: "#EC4899"
  }
];

const DynamicIcon = ({ name, size = 24, color = 'currentColor' }) => {
  const IconComponent = Icons[name];
  if (!IconComponent) return <Icons.HelpCircle size={size} color={color} />;
  return <IconComponent size={size} color={color} />;
};

const Architecture = () => {
  const [tabIndex, setTabIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredModules = modulesData.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Container maxWidth="lg" sx={{ py: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Title Header */}
      <Box sx={{ 
        p: 4, 
        borderRadius: '16px', 
        background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
        color: '#FFFFFF',
        boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <Box sx={{ position: 'relative', zIndex: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, fontFamily: 'Poppins', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icons.Layers size={32} color="#3B82F6" />
            CRM Architecture & Data Flow Guide
          </Typography>
          <Typography variant="body1" sx={{ color: '#94A3B8', maxWidth: '800px', fontSize: '15px' }}>
            A complete directory of all 21 modules in Gagan Realtech CRM. Learn how data interconnects, schedules follow-ups, updates properties, and triggers automatic ownership transfers.
          </Typography>
        </Box>
        <Box sx={{ 
          position: 'absolute', 
          right: -20, 
          bottom: -40, 
          opacity: 0.05, 
          color: '#FFFFFF', 
          transform: 'rotate(-10deg)' 
        }}>
          <Icons.Network size={220} />
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
        <Tabs 
          value={tabIndex} 
          onChange={(e, val) => setTabIndex(val)} 
          variant="fullWidth"
          sx={{ 
            borderBottom: 1, 
            borderColor: 'divider',
            '& .MuiTab-root': { py: 2, fontWeight: 700, fontSize: '13px', textTransform: 'none' } 
          }}
        >
          <Tab icon={<Icons.Grid size={18} />} iconPosition="start" label="21 Modules Directory" />
          <Tab icon={<Icons.Activity size={18} />} iconPosition="start" label="System Automations & Journeys" />
        </Tabs>
      </Paper>

      {/* Tab Panel 1: Modules Grid */}
      {tabIndex === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Search Bar */}
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
            <TextField
              placeholder="Search modules or keywords..."
              variant="outlined"
              size="small"
              fullWidth
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Icons.Search size={18} color="#64748B" />
                  </InputAdornment>
                ),
                sx: { borderRadius: '10px', backgroundColor: '#FFFFFF' }
              }}
              sx={{ maxWidth: '400px' }}
            />
            <Chip label={`${filteredModules.length} Modules`} variant="outlined" sx={{ fontWeight: 700 }} />
          </Box>

          {/* Grid */}
          <Grid container spacing={2.5}>
            {filteredModules.map((m, idx) => (
              <Grid item xs={12} sm={6} md={4} key={idx}>
                <Card sx={{ 
                  height: '100%', 
                  border: '1px solid #E2E8F0', 
                  borderRadius: '14px', 
                  boxShadow: 'none', 
                  transition: 'all 0.2s ease-in-out', 
                  '&:hover': { 
                    transform: 'translateY(-4px)', 
                    borderColor: m.color,
                    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.03)'
                  } 
                }}>
                  <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box display="flex" alignItems="center" gap={1.5}>
                      <Avatar sx={{ bgcolor: `${m.color}15`, color: m.color, width: 44, height: 44, borderRadius: '10px' }}>
                        <DynamicIcon name={m.icon} color={m.color} />
                      </Avatar>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#1E293B' }}>
                          {m.name}
                        </Typography>
                        <Chip 
                          label={`Module ${idx + 1}`} 
                          size="small" 
                          sx={{ height: 16, fontSize: '9px', fontWeight: 800, bgcolor: '#F1F5F9', color: '#64748B' }} 
                        />
                      </Box>
                    </Box>
                    
                    <Divider />
                    
                    <Box>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: '#64748B', display: 'block', textTransform: 'uppercase', mb: 0.5 }}>
                        Role:
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.5, fontSize: '13px' }}>
                        {m.role}
                      </Typography>
                    </Box>

                    <Box sx={{ mt: 'auto', p: 1.5, bgcolor: '#F8FAFC', borderRadius: '8px', borderLeft: `3px solid ${m.color}` }}>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: m.color, display: 'block', textTransform: 'uppercase', mb: 0.5 }}>
                        Data Connections:
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#475569', fontSize: '12px', lineHeight: 1.4 }}>
                        {m.relations}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Tab Panel 2: Automations & Journeys */}
      {tabIndex === 1 && (
        <Grid container spacing={3}>
          {/* Left Side: Typical Data Journey */}
          <Grid item xs={12} md={7}>
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none', height: '100%' }}>
              <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icons.Workflow size={20} color="#2563EB" />
                  Visual Customer Data Journey
                </Typography>
                
                <Box sx={{ position: 'relative', pl: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {/* Timeline Bar */}
                  <Box sx={{ position: 'absolute', left: '11px', top: '10px', bottom: '10px', width: '2px', bgcolor: '#E2E8F0' }} />

                  {/* Step 1 */}
                  <Box sx={{ position: 'relative' }}>
                    <Avatar sx={{ position: 'absolute', left: '-35px', top: 0, bgcolor: '#3B82F6', width: 24, height: 24, fontSize: '11px', fontWeight: 800 }}>1</Avatar>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E293B' }}>New Enquiry (Lead)</Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', fontSize: '12.5px' }}>
                      Enquiry captured from public forms or manually created. Assigned in rotation to a salesperson.
                    </Typography>
                  </Box>

                  {/* Step 2 */}
                  <Box sx={{ position: 'relative' }}>
                    <Avatar sx={{ position: 'absolute', left: '-35px', top: 0, bgcolor: '#6366F1', width: 24, height: 24, fontSize: '11px', fontWeight: 800 }}>2</Avatar>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E293B' }}>Lead Accepted & Follow-up Scheduled</Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', fontSize: '12.5px' }}>
                      Salesperson accepts lead, which automatically schedules a **Follow-up** call and task.
                    </Typography>
                  </Box>

                  {/* Step 3 */}
                  <Box sx={{ position: 'relative' }}>
                    <Avatar sx={{ position: 'absolute', left: '-35px', top: 0, bgcolor: '#8B5CF6', width: 24, height: 24, fontSize: '11px', fontWeight: 800 }}>3</Avatar>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E293B' }}>Pitches & Stage Updates</Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', fontSize: '12.5px' }}>
                      Pitching property listings logs them into **Property Pitch History**, auto-advancing the follow-up or query stage.
                    </Typography>
                  </Box>

                  {/* Step 4 */}
                  <Box sx={{ position: 'relative' }}>
                    <Avatar sx={{ position: 'absolute', left: '-35px', top: 0, bgcolor: '#EC4899', width: 24, height: 24, fontSize: '11px', fontWeight: 800 }}>4</Avatar>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E293B' }}>Site Visit Arranged</Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', fontSize: '12.5px' }}>
                      Setting the follow-up stage to 'Site Visit' auto-creates a **Site Visit** logging the property showing.
                    </Typography>
                  </Box>

                  {/* Step 5 */}
                  <Box sx={{ position: 'relative' }}>
                    <Avatar sx={{ position: 'absolute', left: '-35px', top: 0, bgcolor: '#16A34A', width: 24, height: 24, fontSize: '11px', fontWeight: 800 }}>5</Avatar>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1E293B' }}>Deal Closure & Chaining</Typography>
                    <Typography variant="body2" sx={{ color: '#64748B', fontSize: '12.5px' }}>
                      Changing the stage to 'Closed' converts the Lead to a **Customer**, auto-creates a **Deal**, transfers property ownership, and moves documents to history.
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Right Side: Core Business Automations */}
          <Grid item xs={12} md={5}>
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none', height: '100%', bgcolor: '#FAF5FF' }}>
              <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#7C3AED', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icons.Cpu size={20} color="#7C3AED" />
                  Core Automations
                </Typography>
                
                <List sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <ListItem disablePadding sx={{ alignItems: 'flex-start' }}>
                    <ListItemIcon sx={{ minWidth: 28, color: '#7C3AED', mt: 0.3 }}>
                      <Icons.CheckCircle2 size={16} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Duplicate Phone Handler" 
                      secondary="Re-entering a registered number automatically creates a linked Query on the existing Customer profile instead of generating a duplicate."
                      primaryTypographyProps={{ fontWeight: 700, fontSize: '12.5px', color: '#1E293B' }}
                      secondaryTypographyProps={{ fontSize: '11.5px', color: '#475569' }}
                    />
                  </ListItem>
                  
                  <ListItem disablePadding sx={{ alignItems: 'flex-start' }}>
                    <ListItemIcon sx={{ minWidth: 28, color: '#7C3AED', mt: 0.3 }}>
                      <Icons.CheckCircle2 size={16} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Seller-Type Auto Conversion" 
                      secondary="Adding a lead as 'Seller' automatically creates a Customer account and lists the Property under Direct inventory immediately."
                      primaryTypographyProps={{ fontWeight: 700, fontSize: '12.5px', color: '#1E293B' }}
                      secondaryTypographyProps={{ fontSize: '11.5px', color: '#475569' }}
                    />
                  </ListItem>

                  <ListItem disablePadding sx={{ alignItems: 'flex-start' }}>
                    <ListItemIcon sx={{ minWidth: 28, color: '#7C3AED', mt: 0.3 }}>
                      <Icons.CheckCircle2 size={16} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Attendance & Salary Integration" 
                      secondary="Attendance logs (e.g. lateness after 9:30 AM) and approved Leaves are directly parsed inside payroll formulas."
                      primaryTypographyProps={{ fontWeight: 700, fontSize: '12.5px', color: '#1E293B' }}
                      secondaryTypographyProps={{ fontSize: '11.5px', color: '#475569' }}
                    />
                  </ListItem>

                  <ListItem disablePadding sx={{ alignItems: 'flex-start' }}>
                    <ListItemIcon sx={{ minWidth: 28, color: '#7C3AED', mt: 0.3 }}>
                      <Icons.CheckCircle2 size={16} />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Self-Healing Database Scheme" 
                      secondary="Dynamic columns are aligned with Google Sheets mappings and meta-configs automatically on system writes."
                      primaryTypographyProps={{ fontWeight: 700, fontSize: '12.5px', color: '#1E293B' }}
                      secondaryTypographyProps={{ fontSize: '11.5px', color: '#475569' }}
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Container>
  );
};

export default Architecture;
