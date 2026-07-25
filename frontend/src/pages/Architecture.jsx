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
    role: "Staff profiles, role authorizations, and login access control.",
    relations: "Connected to every module. Whichever employee is assigned handles that Lead, Customer, Deal, Task, Attendance, Leave, Salary, and Location entry.",
    color: "#EF4444"
  },
  {
    name: "Customers",
    icon: "UserCheck",
    role: "Master directory of confirmed clients and their buying/selling journey stages.",
    relations: "Related to Leads (converts from Lead), Follow-ups, Queries, Site Visits, Deals, and Sales. Reassigning an employee updates Lead, Follow-up, Query, and Site Visit records automatically.",
    color: "#3B82F6"
  },
  {
    name: "Leads",
    icon: "UserPlus",
    role: "Prospective client enquiries before conversion to permanent customers.",
    relations: "Converts into Customer. Automatically creates a Follow-up on acceptance, schedules a Query if the phone number already exists, and Seller-type leads auto-create Properties.",
    color: "#10B981"
  },
  {
    name: "Properties",
    icon: "Home",
    role: "Inventory listings directory with owner details, characteristics, and listing states.",
    relations: "Related to Leads, Customers, Queries, and Follow-ups. Core updates (price, locality, size) auto-sync to all linked records. Ownership transfers on closed Deal or Pitch.",
    color: "#F59E0B"
  },
  {
    name: "Projects",
    icon: "Building2",
    role: "Groups properties/plots under parent real-estate developments.",
    relations: "Feeds exclusively into Properties as parent metadata.",
    color: "#8B5CF6"
  },
  {
    name: "Site Visits",
    icon: "Map",
    role: "Logs scheduled and completed property showing visits with clients.",
    relations: "Auto-created when Follow-up stage transitions to 'Site Visit'. Links clients (Customer/Lead), employees, and property listings.",
    color: "#EC4899"
  },
  {
    name: "Follow-ups",
    icon: "PhoneCall",
    role: "Central task and call nurturing pipeline driving downstream operations.",
    relations: "The core CRM workflow driver. Changing stages automatically schedules Site Visits, triggers Deal creation, or transfers property ownership, updating linked Queries/Leads.",
    color: "#6366F1"
  },
  {
    name: "Attendance",
    icon: "Clock",
    role: "Logs daily check-in/out stamps and lateness thresholds (late after 9:30 AM).",
    relations: "Linked to Employees (owner) and feeds directly into Salaries for payroll calculation.",
    color: "#14B8A6"
  },
  {
    name: "Leaves",
    icon: "CalendarX",
    role: "Manages employee leave requests, approvals, and paid leaf limits.",
    relations: "Affects Attendance sheets and drives Salary deductions (first 4 leaves per month are paid).",
    color: "#F43F5E"
  },
  {
    name: "Sales",
    icon: "CircleDollarSign",
    role: "Records client property bookings and cash flow receipts.",
    relations: "Connects buyer (Customer), item sold (Property), and salesperson (Employee).",
    color: "#10B981"
  },
  {
    name: "Tasks",
    icon: "CheckSquare",
    role: "Assigned employee to-do checklist and daily operational items.",
    relations: "Assigned directly to Employees.",
    color: "#6B7280"
  },
  {
    name: "Daily Prices",
    icon: "TrendingUp",
    role: "Maintains records of day-wise market rate updates for projects and listings.",
    relations: "Tied directly to Properties to track asset valuation over time.",
    color: "#059669"
  },
  {
    name: "Dealers",
    icon: "Network",
    role: "Directory of external brokers, channel partners, and realtors.",
    relations: "Links to Dealer Calls (outcome tracking) and Dealer Meetings (assigned to Employees).",
    color: "#D97706"
  },
  {
    name: "Location Tracker",
    icon: "Navigation",
    role: "GPS logger tracking coordinates (>10m increments) and employee travel distance.",
    relations: "Encrypted logging tied to Employees. Aggregated mileage saves on employee profiles.",
    color: "#2563EB"
  },
  {
    name: "Notices",
    icon: "Megaphone",
    role: "Internal board for announcements, circulars, and system notices.",
    relations: "Assigned by admins, viewable by Employees.",
    color: "#7C3AED"
  },
  {
    name: "Salaries",
    icon: "Wallet",
    role: "Wallet payment payroll calculation module.",
    relations: "Pulls present/late/absent counts from Attendance and unpaid counts from Leaves for final employee payouts.",
    color: "#059669"
  },
  {
    name: "Queries",
    icon: "HelpCircle",
    role: "Specific buy/sell requirements raised by leads or customers.",
    relations: "Tied to client (Customer/Lead). Approved Sell queries create new Property listings. Every query schedules a Follow-up.",
    color: "#3B82F6"
  },
  {
    name: "Deals",
    icon: "Handshake",
    role: "Master registry of finalized booking closures and deeds.",
    relations: "Converts Lead to Customer, updates property ownership to buyer, and tracks RM closer details.",
    color: "#16A34A"
  },
  {
    name: "Property Pitch History",
    icon: "Send",
    role: "Tracks which properties were presented or pitched to which clients.",
    relations: "Auto-completes call tasks, updates follow-up/query stages, and triggers ownership transfer on closing.",
    color: "#8B5CF6"
  },
  {
    name: "Dealer Calls",
    icon: "PhoneForwarded",
    role: "Call logs and outcomes tracked with external dealers.",
    relations: "Automatically updates dealer remarks on the main Dealers file.",
    color: "#F59E0B"
  },
  {
    name: "Dealer Meetings",
    icon: "Users2",
    role: "Logs schedules and assignments for partner dealer meetings.",
    relations: "Assigning meetings triggers instant notifications to Employees.",
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
