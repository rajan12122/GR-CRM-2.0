import React, { useState, useEffect } from 'react';
import { 
  Box, Grid, Typography, Card, CardContent, Button, Tabs, Tab, TextField, 
  IconButton, Tooltip, Chip, Dialog, DialogTitle, DialogContent, DialogActions, 
  Paper, Checkbox, List, ListItem, ListItemText, ListItemSecondaryAction, Select, MenuItem,
  FormControl, InputLabel, Menu, CircularProgress
} from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { useApp, API_BASE_URL } from '../context/AppContext';

const MyWorkspace = () => {
  const { user, token, fetchModuleData, moduleData } = useApp();
  const [activeTab, setActiveTab] = useState(0);

  // --- TODOS STATE ---
  const [todos, setTodos] = useState([]);
  const [todoInput, setTodoInput] = useState('');
  const [todoDate, setTodoDate] = useState(new Date().toISOString().split('T')[0]);
  const [todoTime, setTodoTime] = useState('12:00');
  const [todoPriority, setTodoPriority] = useState('Medium');
  const [todoPersonal, setTodoPersonal] = useState(true);

  // --- STICKY NOTES STATE ---
  const [notes, setNotes] = useState([]);
  const [noteContent, setNoteContent] = useState('');
  const [noteColor, setNoteColor] = useState('Yellow');
  const [notePinned, setNotePinned] = useState(false);
  const [noteShared, setNoteShared] = useState(false);
  const [noteReminderDate, setNoteReminderDate] = useState('');
  const [noteReminderTime, setNoteReminderTime] = useState('12:00');
  const [noteLinkedModule, setNoteLinkedModule] = useState('');
  const [noteLinkedId, setNoteLinkedId] = useState('');

  // --- VAULT STATE ---
  const [vaultDocs, setVaultDocs] = useState([]);
  const [vaultDocName, setVaultDocName] = useState('');
  const [vaultFileUrl, setVaultFileUrl] = useState('');
  const [vaultExpiryDate, setVaultExpiryDate] = useState('');
  const [uploadingVaultFile, setUploadingVaultFile] = useState(false);

  // --- SHORTCUTS STATE ---
  const [shortcuts, setShortcuts] = useState([]);
  const [shortcutLabel, setShortcutLabel] = useState('');
  const [shortcutModule, setShortcutModule] = useState('leads');
  const [shortcutRecordId, setShortcutRecordId] = useState('');

  // --- PERFORMANCE FILTER ---
  const [selectedStaffId, setSelectedStaffId] = useState(user?.id || '');
  const [performanceData, setPerformanceData] = useState({
    completedFollowups: 0,
    overdueTasks: 0,
    visitsDone: 0,
    leadsHandled: 0,
    conversionProgress: 0
  });

  // --- AUDIO VAULT RECORDING STATE ---
  const [audioUrl, setAudioUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);

  // --- CALENDAR VIEW GRID STATE ---
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState('all');

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchWorkspaceData();
  }, [token, selectedStaffId]);

  useEffect(() => {
    calculatePerformance();
  }, [todos, selectedStaffId, moduleData]);

  const fetchWorkspaceData = async () => {
    try {
      // Preload employees list for Staff dropdown selector
      fetchModuleData('employees').catch(() => {});

      const params = {};
      if (selectedStaffId) {
        params.employeeId = selectedStaffId;
      }

      const todoRes = await axios.get(`${API_BASE_URL}/workspace/todos`, { headers, params });
      setTodos(todoRes.data);

      const notesRes = await axios.get(`${API_BASE_URL}/workspace/notes`, { headers, params });
      setNotes(notesRes.data);

      const vaultRes = await axios.get(`${API_BASE_URL}/workspace/documents`, { headers, params });
      setVaultDocs(vaultRes.data);

      const shortRes = await axios.get(`${API_BASE_URL}/workspace/shortcuts`, { headers, params });
      setShortcuts(shortRes.data);
    } catch (err) {
      console.error('Error fetching workspace assets:', err);
    }
  };

  // --- TO-DO HANDLERS ---
  const handleAddTodo = async () => {
    if (!todoInput.trim()) return;
    try {
      const res = await axios.post(`${API_BASE_URL}/workspace/todos`, {
        title: todoInput,
        dueDate: todoDate,
        dueTime: todoTime,
        priority: todoPriority,
        personal: todoPersonal,
        notes: ''
      }, { headers });
      setTodos([...todos, res.data]);
      setTodoInput('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleTodo = async (todo) => {
    const newStatus = todo.status === 'Completed' ? 'Pending' : 'Completed';
    try {
      const res = await axios.put(`${API_BASE_URL}/workspace/todos/${todo.id}`, {
        ...todo,
        status: newStatus
      }, { headers });
      setTodos(todos.map(t => t.id === todo.id ? res.data : t));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTodo = async (todoId) => {
    try {
      await axios.delete(`${API_BASE_URL}/workspace/todos/${todoId}`, { headers });
      setTodos(todos.filter(t => t.id !== todoId));
    } catch (err) {
      console.error(err);
    }
  };

  // --- STICKY NOTES HANDLERS ---
  const handleAddNote = async () => {
    try {
      const res = await axios.post(`${API_BASE_URL}/workspace/notes`, {
        content: noteContent,
        color: noteColor,
        pinned: notePinned,
        shared: noteShared,
        linkedModule: noteLinkedModule || null,
        linkedId: noteLinkedId || null,
        reminderDate: noteReminderDate || null,
        reminderTime: noteReminderTime || null
      }, { headers });
      setNotes([...notes, res.data]);
      setNoteContent('');
      setNotePinned(false);
      setNoteShared(false);
      setNoteReminderDate('');
      setNoteLinkedModule('');
      setNoteLinkedId('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await axios.delete(`${API_BASE_URL}/workspace/notes/${noteId}`, { headers });
      setNotes(notes.filter(n => n.id !== noteId));
    } catch (err) {
      console.error(err);
    }
  };

  // --- SHORTCUTS HANDLERS ---
  const handleAddShortcut = async () => {
    if (!shortcutLabel.trim()) return;
    try {
      const res = await axios.post(`${API_BASE_URL}/workspace/shortcuts`, {
        moduleName: shortcutModule,
        recordId: shortcutRecordId,
        label: shortcutLabel
      }, { headers });
      setShortcuts([...shortcuts, res.data]);
      setShortcutLabel('');
      setShortcutRecordId('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteShortcut = async (shortId) => {
    try {
      await axios.delete(`${API_BASE_URL}/workspace/shortcuts/${shortId}`, { headers });
      setShortcuts(shortcuts.filter(s => s.id !== shortId));
    } catch (err) {
      console.error(err);
    }
  };

  // --- PERSONAL VAULT HANDLERS ---
  const handleAddVaultDoc = async () => {
    if (!vaultDocName.trim()) return;
    try {
      const res = await axios.post(`${API_BASE_URL}/workspace/documents`, {
        name: vaultDocName,
        fileUrl: vaultFileUrl || 'https://example.com/vault-file.pdf',
        expiryDate: vaultExpiryDate || null
      }, { headers });
      setVaultDocs([...vaultDocs, res.data]);
      setVaultDocName('');
      setVaultFileUrl('');
      setVaultExpiryDate('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteVaultDoc = async (docId) => {
    try {
      await axios.delete(`${API_BASE_URL}/workspace/documents/${docId}`, { headers });
      setVaultDocs(vaultDocs.filter(d => d.id !== docId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleVaultFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingVaultFile(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;
        const res = await axios.post(`${API_BASE_URL}/upload`, {
          fileName: file.name,
          base64Data
        }, { headers });
        if (res.data && res.data.fileUrl) {
          setVaultFileUrl(res.data.fileUrl);
          if (!vaultDocName) {
            setVaultDocName(file.name.split('.').slice(0, -1).join('.'));
          }
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Vault upload failed:', err);
      alert('Upload failed. Please check backend connections.');
    } finally {
      setUploadingVaultFile(false);
    }
  };

  // --- AUDIO RECORDER HANDLERS ---
  const startRecording = async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks = [];

        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
        };

        recorder.start();
        setMediaRecorder(recorder);
        setRecording(true);
      } catch (err) {
        console.error('Error starting recording:', err);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
    }
  };

  // --- PERFORMANCE CALCULATOR ---
  const calculatePerformance = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const userTodos = todos.filter(t => String(t.assignedTo) === String(selectedStaffId));
    const finishedTodos = userTodos.filter(t => t.status === 'Completed');
    const overdue = userTodos.filter(t => t.status === 'Pending' && t.dueDate < todayStr).length;

    // Follow ups count
    const followUps = moduleData.follow_ups || [];
    const userFollowUps = followUps.filter(f => String(f.employeeId) === String(selectedStaffId));
    const completedF = userFollowUps.filter(f => f.status === 'Completed' && f.date === todayStr).length;

    // Site visits done
    const visits = moduleData.site_visits || [];
    const completedV = visits.filter(v => String(v.employeeId) === String(selectedStaffId) && v.result && v.result !== '' && v.result !== 'Pending').length;

    // Leads handled
    const leads = moduleData.leads || [];
    const handledL = leads.filter(l => String(l.assignedEmployeeId) === String(selectedStaffId)).length;
    const convertedL = leads.filter(l => String(l.assignedEmployeeId) === String(selectedStaffId) && l.status === 'Converted').length;
    const conversionPercent = handledL > 0 ? Math.round((convertedL / handledL) * 100) : 0;

    setPerformanceData({
      completedFollowups: completedF + finishedTodos.length,
      overdueTasks: overdue,
      visitsDone: completedV,
      leadsHandled: handledL,
      conversionProgress: conversionPercent
    });
  };

  // --- CALENDAR GRID GENERATION ---
  const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month, year) => new Date(year, month, 1).getDay();

  const calendarDays = [];
  const daysInMonth = getDaysInMonth(calendarMonth, calendarYear);
  const firstDay = getFirstDayOfMonth(calendarMonth, calendarYear);

  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  // Filter planner/calendar events
  const getCalendarEvents = (day) => {
    if (!day) return [];
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const list = [];

    // Follow ups
    if (filterType === 'all' || filterType === 'followup') {
      const followUps = moduleData.follow_ups || [];
      followUps.forEach(f => {
        if (f.date === dateStr && String(f.employeeId) === String(selectedStaffId)) {
          list.push({ type: 'followup', label: `Call: ${f.customerId}`, id: f.id });
        }
      });
    }

    // Site visits
    if (filterType === 'all' || filterType === 'visit') {
      const visits = moduleData.site_visits || [];
      visits.forEach(v => {
        if (v.date === dateStr && String(v.employeeId) === String(selectedStaffId)) {
          list.push({ type: 'visit', label: `Site Visit: ${v.propertyId}`, id: v.id });
        }
      });
    }

    // Todos
    if (filterType === 'all' || filterType === 'todo') {
      todos.forEach(t => {
        if (t.dueDate === dateStr && String(t.assignedTo) === String(selectedStaffId)) {
          list.push({ type: 'todo', label: t.title, id: t.id, status: t.status });
        }
      });
    }

    return list;
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'Urgent': return '#EF4444';
      case 'High': return '#F59E0B';
      case 'Medium': return '#3B82F6';
      default: return '#10B981';
    }
  };

  return (
    <Box sx={{ p: 3, flexGrow: 1, overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, fontFamily: 'Poppins', color: '#0F172A' }}>My Workspace</Typography>
        <Chip label="Personal Control Panel" color="primary" sx={{ fontWeight: 700 }} />
      </Box>

      {/* Tabs Menu Navigation */}
      <Tabs 
        value={activeTab} 
        onChange={(e, val) => setActiveTab(val)}
        sx={{ 
          mb: 3, 
          borderBottom: '1px solid #E2E8F0',
          '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minWidth: 100 }
        }}
      >
        <Tab icon={<Icons.Calendar size={18} />} iconPosition="start" label="Planner & Calendar" />
        <Tab icon={<Icons.CheckSquare size={18} />} iconPosition="start" label="Sticky Notes & Tasks" />
        <Tab icon={<Icons.FolderKey size={18} />} iconPosition="start" label="Vault & Shortcuts" />
        <Tab icon={<Icons.Mic size={18} />} iconPosition="start" label="Voice Notes & Drafts" />
      </Tabs>

      {/* TAB 1: PLANNER & CALENDAR */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* Performance Summary Cards */}
          <Grid item xs={12}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none', mb: 2 }}>
              <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>Workspace Performance Metric Overview</Typography>
                  {user?.role === 'Admin' && (
                    <FormControl size="small" sx={{ width: 220 }}>
                      <InputLabel>View Team Member</InputLabel>
                      <Select 
                        value={selectedStaffId} 
                        onChange={(e) => setSelectedStaffId(e.target.value)}
                        label="View Team Member"
                      >
                        {(moduleData.employees || []).map(emp => (
                          <MenuItem key={emp.id} value={emp.id}>
                            {emp.name} ({emp.role || 'Sales'})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={2.4}>
                    <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: '#F8FAFC', border: '1px solid #F1F5F9', boxShadow: 'none' }}>
                      <Icons.PhoneCall size={20} color="#3B82F6" />
                      <Typography variant="h5" sx={{ fontWeight: 800, mt: 1 }}>{performanceData.completedFollowups}</Typography>
                      <Typography variant="caption" sx={{ color: '#64748B' }}>Calls Done Today</Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={6} sm={2.4}>
                    <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: '#F8FAFC', border: '1px solid #F1F5F9', boxShadow: 'none' }}>
                      <Icons.AlertCircle size={20} color="#EF4444" />
                      <Typography variant="h5" sx={{ fontWeight: 800, mt: 1, color: performanceData.overdueTasks > 0 ? '#EF4444' : 'inherit' }}>{performanceData.overdueTasks}</Typography>
                      <Typography variant="caption" sx={{ color: '#64748B' }}>Overdue Tasks</Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={6} sm={2.4}>
                    <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: '#F8FAFC', border: '1px solid #F1F5F9', boxShadow: 'none' }}>
                      <Icons.Eye size={20} color="#F59E0B" />
                      <Typography variant="h5" sx={{ fontWeight: 800, mt: 1 }}>{performanceData.visitsDone}</Typography>
                      <Typography variant="caption" sx={{ color: '#64748B' }}>Visits Completed</Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={6} sm={2.4}>
                    <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: '#F8FAFC', border: '1px solid #F1F5F9', boxShadow: 'none' }}>
                      <Icons.Users size={20} color="#10B981" />
                      <Typography variant="h5" sx={{ fontWeight: 800, mt: 1 }}>{performanceData.leadsHandled}</Typography>
                      <Typography variant="caption" sx={{ color: '#64748B' }}>Leads Assigned</Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} sm={2.4}>
                    <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: '#F8FAFC', border: '1px solid #F1F5F9', boxShadow: 'none' }}>
                      <Icons.TrendingUp size={20} color="#8B5CF6" />
                      <Typography variant="h5" sx={{ fontWeight: 800, mt: 1 }}>{performanceData.conversionProgress}%</Typography>
                      <Typography variant="caption" sx={{ color: '#64748B' }}>Lead Conversion</Typography>
                    </Paper>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Daily Schedule Timeline (Left side) */}
          <Grid item xs={12} md={4}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none', height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icons.Clock size={18} /> Today's Timeline Planner
                </Typography>
                <List sx={{ maxHeight: 400, overflowY: 'auto' }}>
                  {todos.filter(t => t.status === 'Pending').map((todo, idx) => (
                    <ListItem key={idx} sx={{ borderLeft: `4px solid ${getPriorityColor(todo.priority)}`, pl: 2, mb: 1.5, backgroundColor: '#F8FAFC' }}>
                      <ListItemText 
                        primary={todo.title} 
                        secondary={`${todo.dueDate} ${todo.dueTime || ''} | Priority: ${todo.priority}`} 
                        primaryTypographyProps={{ fontSize: '13px', fontWeight: 700 }}
                        secondaryTypographyProps={{ fontSize: '11px' }}
                      />
                      <ListItemSecondaryAction>
                        <Tooltip title="Complete">
                          <IconButton size="small" color="success" onClick={() => handleToggleTodo(todo)}>
                            <Icons.CheckCircle size={16} />
                          </IconButton>
                        </Tooltip>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                  {todos.filter(t => t.status === 'Pending').length === 0 && (
                    <Typography variant="body2" sx={{ color: '#94A3B8', textAlign: 'center', p: 3 }}>No scheduled events for today.</Typography>
                  )}
                </List>
              </CardContent>
            </Card>
          </Grid>

          {/* Calendar month grid (Right side) */}
          <Grid item xs={12} md={8}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>
                    Calendar View - {new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long' })} {calendarYear}
                  </Typography>
                  <Box display="flex" gap={1}>
                    <Select size="small" value={filterType} onChange={(e) => setFilterType(e.target.value)} sx={{ height: 32 }}>
                      <MenuItem value="all">All Events</MenuItem>
                      <MenuItem value="followup">Follow-ups</MenuItem>
                      <MenuItem value="visit">Site Visits</MenuItem>
                      <MenuItem value="todo">To-Dos</MenuItem>
                    </Select>
                    <IconButton size="small" onClick={() => {
                      if (calendarMonth === 0) {
                        setCalendarMonth(11);
                        setCalendarYear(calendarYear - 1);
                      } else setCalendarMonth(calendarMonth - 1);
                    }}>
                      <Icons.ChevronLeft size={18} />
                    </IconButton>
                    <IconButton size="small" onClick={() => {
                      if (calendarMonth === 11) {
                        setCalendarMonth(0);
                        setCalendarYear(calendarYear + 1);
                      } else setCalendarMonth(calendarMonth + 1);
                    }}>
                      <Icons.ChevronRight size={18} />
                    </IconButton>
                  </Box>
                </Box>

                {/* Calendar grid */}
                <Grid container spacing={0.5} columns={7}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <Grid item xs={1} key={day} sx={{ textAlign: 'center', fontWeight: 700, fontSize: '11px', color: '#64748B', py: 1 }}>
                      {day}
                    </Grid>
                  ))}
                  {calendarDays.map((day, idx) => (
                    <Grid item xs={1} key={idx} sx={{ height: 80, border: '1px solid #F1F5F9', p: 0.5, position: 'relative', overflow: 'hidden' }}>
                      {day && (
                        <>
                          <Typography variant="caption" sx={{ fontWeight: 700, position: 'absolute', top: 2, left: 4 }}>{day}</Typography>
                          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.2, maxHeight: 56, overflowY: 'auto' }}>
                            {getCalendarEvents(day).map((ev, eIdx) => (
                              <Chip 
                                key={eIdx} 
                                label={ev.label} 
                                size="small"
                                sx={{ 
                                  height: 16, 
                                  fontSize: '8px', 
                                  backgroundColor: ev.type === 'visit' ? '#F59E0B20' : ev.type === 'followup' ? '#3B82F620' : '#10B98120',
                                  color: ev.type === 'visit' ? '#D97706' : ev.type === 'followup' ? '#2563EB' : '#059669',
                                  textDecoration: ev.status === 'Completed' ? 'line-through' : 'none'
                                }} 
                              />
                            ))}
                          </Box>
                        </>
                      )}
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* TAB 2: STICKY NOTES & TASKS */}
      {activeTab === 1 && (
        <Grid container spacing={3}>
          {/* Personal Task Manager Form */}
          <Grid item xs={12} md={4}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none', mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Create Personal Checklist</Typography>
                <TextField 
                  label="What needs to be done?" 
                  fullWidth 
                  size="small" 
                  value={todoInput} 
                  onChange={(e) => setTodoInput(e.target.value)} 
                  sx={{ mb: 2 }}
                />
                <Grid container spacing={1} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <TextField label="Due Date" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={todoDate} onChange={(e) => setTodoDate(e.target.value)} />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Due Time" type="time" size="small" fullWidth InputLabelProps={{ shrink: true }} value={todoTime} onChange={(e) => setTodoTime(e.target.value)} />
                  </Grid>
                </Grid>
                <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Priority</InputLabel>
                  <Select value={todoPriority} onChange={(e) => setTodoPriority(e.target.value)} label="Priority">
                    <MenuItem value="Low">Low</MenuItem>
                    <MenuItem value="Medium">Medium</MenuItem>
                    <MenuItem value="High">High</MenuItem>
                    <MenuItem value="Urgent">Urgent</MenuItem>
                  </Select>
                </FormControl>
                <Button variant="contained" fullWidth onClick={handleAddTodo} sx={{ backgroundColor: '#2563EB', textTransform: 'none', fontWeight: 700 }}>
                  Add Task
                </Button>

                <List sx={{ mt: 3, maxHeight: 300, overflowY: 'auto' }}>
                  {todos.map(todo => (
                    <ListItem key={todo.id} sx={{ px: 0, borderBottom: '1px solid #F1F5F9' }}>
                      <Checkbox checked={todo.status === 'Completed'} onChange={() => handleToggleTodo(todo)} />
                      <ListItemText 
                        primary={todo.title} 
                        secondary={todo.dueDate} 
                        primaryTypographyProps={{ style: { textDecoration: todo.status === 'Completed' ? 'line-through' : 'none', fontWeight: 600, fontSize: '13px' } }}
                      />
                      <IconButton size="small" onClick={() => handleDeleteTodo(todo.id)}>
                        <Icons.Trash size={14} color="#EF4444" />
                      </IconButton>
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>

          {/* Sticky Notes Board grid */}
          <Grid item xs={12} md={8}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none', mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>My Sticky Note Board</Typography>
                <Box display="flex" gap={1.5} sx={{ mb: 3 }}>
                  <TextField 
                    placeholder="Quick thoughts, notes, templates..." 
                    fullWidth 
                    size="small" 
                    value={noteContent} 
                    onChange={(e) => setNoteContent(e.target.value)} 
                  />
                  <Select size="small" value={noteColor} onChange={(e) => setNoteColor(e.target.value)}>
                    <MenuItem value="Yellow">Yellow 🟨</MenuItem>
                    <MenuItem value="Blue">Blue 🟦</MenuItem>
                    <MenuItem value="Green">Green 🟩</MenuItem>
                    <MenuItem value="Red">Red 🟥</MenuItem>
                    <MenuItem value="Purple">Purple 🟪</MenuItem>
                  </Select>
                  <Button variant="contained" onClick={handleAddNote} sx={{ backgroundColor: '#0F172A', textTransform: 'none', fontWeight: 700 }}>
                    Post Note
                  </Button>
                </Box>

                <Grid container spacing={2}>
                  {notes.map(note => {
                    const getNoteBg = (c) => {
                      switch (c) {
                        case 'Blue': return '#1D4ED8';
                        case 'Green': return '#047857';
                        case 'Red': return '#B91C1C';
                        case 'Purple': return '#6D28D9';
                        default: return '#D97706'; // Amber / dark yellow
                      }
                    };
                    const getNoteBorder = (c) => {
                      switch (c) {
                        case 'Blue': return '#1E3A8A';
                        case 'Green': return '#064E3B';
                        case 'Red': return '#7F1D1D';
                        case 'Purple': return '#4C1D95';
                        default: return '#B45309';
                      }
                    };

                    return (
                      <Grid item xs={12} sm={4} key={note.id}>
                        <Card 
                          sx={{ 
                            backgroundColor: getNoteBg(note.color), 
                            border: `1px solid ${getNoteBorder(note.color)}`,
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                            borderRadius: '12px',
                            minHeight: 120,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'transform 0.2s',
                            '&:hover': {
                              transform: 'translateY(-2px)'
                            }
                          }}
                        >
                          <CardContent sx={{ p: 2, pb: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#FFFFFF', whiteSpace: 'pre-wrap' }}>
                              {note.content}
                            </Typography>
                          </CardContent>
                          <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                            <IconButton size="small" onClick={() => handleDeleteNote(note.id)} sx={{ color: 'rgba(255, 255, 255, 0.75)', '&:hover': { color: '#FFFFFF', backgroundColor: 'rgba(255, 255, 255, 0.1)' } }}>
                              <Icons.Trash2 size={14} color="currentColor" />
                            </IconButton>
                          </Box>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* TAB 3: VAULT & SHORTCUTS */}
      {activeTab === 2 && (
        <Grid container spacing={3}>
          {/* Shortcuts Management panel */}
          <Grid item xs={12} md={4}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>Quick Access Shortcuts</Typography>
                <TextField label="Shortcut Name" fullWidth size="small" value={shortcutLabel} onChange={(e) => setShortcutLabel(e.target.value)} sx={{ mb: 2 }} />
                <Grid container spacing={1} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <Select size="small" fullWidth value={shortcutModule} onChange={(e) => setShortcutModule(e.target.value)}>
                      <MenuItem value="leads">Leads</MenuItem>
                      <MenuItem value="customers">Customers</MenuItem>
                      <MenuItem value="properties">Properties</MenuItem>
                      <MenuItem value="projects">Projects</MenuItem>
                    </Select>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Record ID" size="small" fullWidth value={shortcutRecordId} onChange={(e) => setShortcutRecordId(e.target.value)} />
                  </Grid>
                </Grid>
                <Button variant="contained" fullWidth onClick={handleAddShortcut} sx={{ backgroundColor: '#2563EB', textTransform: 'none', fontWeight: 700 }}>
                  Pin Shortcut
                </Button>

                <List sx={{ mt: 3 }}>
                  {shortcuts.map(sh => (
                    <ListItem key={sh.id} sx={{ mb: 1, backgroundColor: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
                      <ListItemText 
                        primary={sh.label} 
                        secondary={`${sh.moduleName} - ${sh.recordId}`}
                        primaryTypographyProps={{ fontWeight: 700, fontSize: '13px' }}
                      />
                      <IconButton size="small" onClick={() => window.location.href = `/module/${sh.moduleName}/${sh.recordId}`}>
                        <Icons.ArrowRightCircle size={16} color="#3B82F6" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDeleteShortcut(sh.id)}>
                        <Icons.Trash size={14} color="#EF4444" />
                      </IconButton>
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>

          {/* Personal Document Vault */}
          <Grid item xs={12} md={8}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>🔒 Personal Document Vault</Typography>
                <Box display="flex" flexDirection="column" gap={1.5} sx={{ mb: 3 }}>
                  <Box display="flex" gap={1.5}>
                    <TextField placeholder="Document Label (e.g. Aadhar Copy, Template)" fullWidth size="small" value={vaultDocName} onChange={(e) => setVaultDocName(e.target.value)} />
                    <TextField label="Expiry Date" type="date" InputLabelProps={{ shrink: true }} size="small" value={vaultExpiryDate} onChange={(e) => setVaultExpiryDate(e.target.value)} />
                  </Box>
                  <Box display="flex" gap={1.5} alignItems="center">
                    <TextField placeholder="File URL Link (or upload a file below)" fullWidth size="small" value={vaultFileUrl} onChange={(e) => setVaultFileUrl(e.target.value)} />
                    <input
                      accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                      style={{ display: 'none' }}
                      id="vault-file-upload"
                      type="file"
                      onChange={handleVaultFileUpload}
                    />
                    <label htmlFor="vault-file-upload">
                      <Button
                        variant="outlined"
                        component="span"
                        disabled={uploadingVaultFile}
                        startIcon={uploadingVaultFile ? <CircularProgress size={16} /> : <Icons.Upload size={16} />}
                        sx={{ textTransform: 'none', minWidth: 140, height: 40, borderColor: '#64748B', color: '#64748B' }}
                      >
                        {uploadingVaultFile ? 'Uploading...' : 'Upload File'}
                      </Button>
                    </label>
                    <Button variant="contained" onClick={handleAddVaultDoc} sx={{ backgroundColor: '#1E293B', textTransform: 'none', fontWeight: 700, height: 40, px: 3 }}>
                      Store File
                    </Button>
                  </Box>
                </Box>

                <Grid container spacing={2}>
                  {vaultDocs.map(doc => (
                    <Grid item xs={12} sm={6} key={doc.id}>
                      <Paper sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{doc.name}</Typography>
                          {doc.expiryDate && (
                            <Typography variant="caption" sx={{ color: '#EF4444', fontWeight: 600 }}>Expires: {doc.expiryDate}</Typography>
                          )}
                        </Box>
                        <Box display="flex" gap={0.5}>
                          <IconButton size="small" href={doc.fileUrl} target="_blank">
                            <Icons.Download size={16} color="#3B82F6" />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDeleteVaultDoc(doc.id)}>
                            <Icons.Trash size={16} color="#EF4444" />
                          </IconButton>
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                  {vaultDocs.length === 0 && (
                    <Typography variant="body2" sx={{ color: '#94A3B8', p: 3, width: '100%', textAlign: 'center' }}>Your vault is empty. Keep templates and credentials stored securely.</Typography>
                  )}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* TAB 4: VOICE NOTES & DRAFTS */}
      {activeTab === 3 && (
        <Grid container spacing={3}>
          {/* Quick Voice Notes dictation recorder */}
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none', minHeight: 250 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>🎤 Quick Voice Recorder Memo</Typography>
                <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                  Record oral site briefings, agent comments, or customer outcomes directly from your device microphone.
                </Typography>

                <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
                  {recording ? (
                    <Button 
                      variant="contained" 
                      color="error" 
                      onClick={stopRecording} 
                      startIcon={<Icons.Square size={16} />}
                      sx={{ animation: 'pulse 1.5s infinite' }}
                    >
                      Stop Recording
                    </Button>
                  ) : (
                    <Button 
                      variant="contained" 
                      color="primary" 
                      onClick={startRecording}
                      startIcon={<Icons.Mic size={16} />}
                    >
                      Start Voice Note
                    </Button>
                  )}

                  {audioUrl && (
                    <Box sx={{ width: '100%', mt: 2, textAlign: 'center' }}>
                      <audio src={audioUrl} controls style={{ width: '100%', maxWidth: 320 }} />
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#10B981', fontWeight: 600 }}>
                        Voice note ready. You can play it back or record a new one.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* CRM Form Drafts listing */}
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: 'none', minHeight: 250 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, fontFamily: 'Poppins' }}>📝 CRM Local Form Drafts</Typography>
                <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                  Offline form caches are saved here automatically. If your internet dropped, click to recover and complete submission.
                </Typography>

                <Paper sx={{ p: 2, border: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', boxShadow: 'none' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Leads Intake form draft</Typography>
                      <Typography variant="caption" sx={{ color: '#64748B' }}>Saved locally on date: Today</Typography>
                    </Box>
                    <Button variant="outlined" size="small" onClick={() => window.location.href = '/quick-add'} sx={{ textTransform: 'none' }}>
                      Recover Draft
                    </Button>
                  </Box>
                </Paper>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default MyWorkspace;
