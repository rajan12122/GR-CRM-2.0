import React, { useState, useEffect } from 'react';
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
  List,
  ListItem,
  Chip
} from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { useApp, API_BASE_URL } from '../context/AppContext';

const Settings = () => {
  const { 
    metadata, 
    saveMetadata, 
    testSheetsSync, 
    triggerFullSheetsSync,
    moduleData,
    fetchModuleData,
    updateRecord
  } = useApp();

  useEffect(() => {
    fetchModuleData('employees');
  }, []);

  const [activeTab, setActiveTab] = useState('fields'); // 'fields', 'chips', 'permissions', 'sheets'
  const [selectedModule, setSelectedModule] = useState('customers');
  const [selectedChipGroup, setSelectedChipGroup] = useState('customerStages');
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });
  const [syncLoading, setSyncLoading] = useState(false);
  const [permSelectedRole, setPermSelectedRole] = useState('Employee');
  const [permSelectedModule, setPermSelectedModule] = useState('customers');
  const [passwordSelectedEmp, setPasswordSelectedEmp] = useState('');
  const [newPasswordVal, setNewPasswordVal] = useState('');
  const [confirmPasswordVal, setConfirmPasswordVal] = useState('');
  const [selectedUserForPerms, setSelectedUserForPerms] = useState('');
  const [userPermSelectedModule, setUserPermSelectedModule] = useState('leads');

  // Google Sheets Sync Dashboard local states
  const [syncJobs, setSyncJobs] = useState([]);
  const [syncMetrics, setSyncMetrics] = useState({ PENDING: 0, PROCESSING: 0, SUCCESS: 0, FAILED: 0 });
  const [syncDashLoading, setSyncDashLoading] = useState(false);
  const [reconcileModule, setReconcileModule] = useState('leads');
  const [reconcilePreview, setReconcilePreview] = useState(null);
  const [selectedChanges, setSelectedChanges] = useState([]);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState('');

  const fetchSyncDashboard = async () => {
    try {
      setSyncDashLoading(true);
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      
      const [jobsRes, metricsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/sync/dashboard/jobs`, { headers }),
        axios.get(`${API_BASE_URL}/sync/dashboard/metrics`, { headers })
      ]);

      if (jobsRes.data.success) setSyncJobs(jobsRes.data.data);
      if (metricsRes.data.success) setSyncMetrics(metricsRes.data.metrics);
    } catch (err) {
      console.error('Failed to load sync dashboard:', err);
    } finally {
      setSyncDashLoading(false);
    }
  };

  const handleRetryJob = async (jobId) => {
    try {
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(`${API_BASE_URL}/sync/dashboard/retry/${jobId}`, {}, { headers });
      fetchSyncDashboard();
    } catch (err) {
      alert('Retry failed: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleReconcilePreview = async () => {
    try {
      setReconcileLoading(true);
      setReconcileMessage('');
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const res = await axios.post(`${API_BASE_URL}/sync/dashboard/reconcile-preview/${reconcileModule}`, {}, { headers });
      if (res.data.success) {
        setReconcilePreview(res.data.changes || []);
        setSelectedChanges((res.data.changes || []).map((_, i) => i)); // default select all
      } else {
        alert(res.data.message || 'Preview failed.');
      }
    } catch (err) {
      alert('Preview failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setReconcileLoading(false);
    }
  };

  const handleConfirmReconcile = async () => {
    if (selectedChanges.length === 0) {
      alert('Please select at least one change to reconcile.');
      return;
    }
    try {
      setReconcileLoading(true);
      const token = localStorage.getItem('gr_crm_token') || localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      
      const acceptedChanges = selectedChanges.map(idx => reconcilePreview[idx].sheetRecord);
      const res = await axios.post(`${API_BASE_URL}/sync/dashboard/reconcile-confirm/${reconcileModule}`, { acceptedChanges }, { headers });
      
      if (res.data.success) {
        setReconcileMessage(res.data.message);
        setReconcilePreview(null);
        setSelectedChanges([]);
        fetchSyncDashboard();
      } else {
        alert(res.data.message || 'Reconcile confirmation failed.');
      }
    } catch (err) {
      alert('Reconcile failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setReconcileLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'sheets') {
      fetchSyncDashboard();
      const interval = setInterval(fetchSyncDashboard, 15000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Lead Rotation local form states
  const [rotationActive, setRotationActive] = useState(false);
  const [rotationHours, setRotationHours] = useState('24');
  const [rotatedSources, setRotatedSources] = useState([]);

  // Message templates form states
  const [whatsappTemplate, setWhatsappTemplate] = useState('');
  const [emailSubjectTemplate, setEmailSubjectTemplate] = useState('');
  const [emailBodyTemplate, setEmailBodyTemplate] = useState('');
  const [smsTemplate, setSmsTemplate] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('gr_crm_token');
    axios.get(`${API_BASE_URL}/templates`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      setWhatsappTemplate(res.data.whatsapp || '');
      setEmailSubjectTemplate(res.data.email_subject || '');
      setEmailBodyTemplate(res.data.email_body || '');
      setSmsTemplate(res.data.sms || '');
    }).catch(err => console.error('Failed to load templates:', err));
  }, []);

  const handleSaveTemplates = async () => {
    const token = localStorage.getItem('gr_crm_token');
    try {
      await axios.post(`${API_BASE_URL}/templates`, {
        whatsapp: whatsappTemplate,
        email_subject: emailSubjectTemplate,
        email_body: emailBodyTemplate,
        sms: smsTemplate
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showStatus('success', 'Message templates saved successfully!');
    } catch (e) {
      console.error(e);
      showStatus('error', 'Failed to save message templates.');
    }
  };

  // Google Sheets local form state
  const [sheetsId, setSheetsId] = useState('');
  const [sheetsEmail, setSheetsEmail] = useState('');
  const [sheetsKey, setSheetsKey] = useState('');
  const [sheetsActive, setSheetsActive] = useState(false);

  useEffect(() => {
    if (metadata?.sheetsConfig) {
      setSheetsId(metadata.sheetsConfig.spreadsheetId || '');
      setSheetsEmail(metadata.sheetsConfig.clientEmail || '');
      setSheetsKey(metadata.sheetsConfig.privateKey || '');
      setSheetsActive(metadata.sheetsConfig.syncActive || false);
    }
    if (metadata?.automationConfig) {
      setRotationActive(metadata.automationConfig.leadRotationActive || false);
      setRotationHours(metadata.automationConfig.rotationHours || '24');
      setRotatedSources(metadata.automationConfig.rotatedSources || []);
    }
  }, [metadata]);

  const handleSaveRotationSettings = async () => {
    const updated = {
      ...metadata,
      automationConfig: {
        leadRotationActive: rotationActive,
        rotationHours: rotationHours,
        rotatedSources: rotatedSources
      }
    };
    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', 'Lead rotation engine settings updated successfully!');
    } else {
      showStatus('error', res.message);
    }
  };

  // Field Add Form state
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldShowTable, setNewFieldShowTable] = useState(true);
  const [newFieldChipGroup, setNewFieldChipGroup] = useState('');
  const [newFieldRefModule, setNewFieldRefModule] = useState('');
  const [editingField, setEditingField] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Chip Add Form state
  const [newChipVal, setNewChipVal] = useState('');
  const [newChipLabel, setNewChipLabel] = useState('');
  const [newChipColor, setNewChipColor] = useState('#2563EB');
  const [newCategoryName, setNewCategoryName] = useState('');

  if (!metadata) return null;

  const showStatus = (type, text) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg({ type: '', text: '' }), 5000);
  };

  // --- FIELDS SCHEMA SCHEMA MANAGEMENT ---

  const handleAddField = async (e) => {
    e.preventDefault();
    if (!newFieldName.trim() || !newFieldLabel.trim()) {
      showStatus('error', 'Field Name and Label are required.');
      return;
    }

    const updated = { ...metadata };
    const fields = updated.modules[selectedModule].fields;

    const newField = {
      name: newFieldName.trim(),
      label: newFieldLabel.trim(),
      type: newFieldType,
      required: newFieldRequired,
      showInTable: newFieldShowTable,
      editable: true
    };

    if (newFieldType === 'select' && newFieldChipGroup) {
      newField.chipGroup = newFieldChipGroup;
    }
    if (newFieldType === 'ref' && newFieldRefModule) {
      newField.refModule = newFieldRefModule;
    }

    if (editingField) {
      const idx = fields.findIndex(f => f.name === editingField.name);
      if (idx !== -1) {
        fields[idx] = newField;
      }
    } else {
      // Check duplicate
      if (fields.some(f => f.name === newFieldName)) {
        showStatus('error', `Field name '${newFieldName}' already exists in this module.`);
        return;
      }
      fields.push(newField);
    }

    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', editingField ? `Field schema '${newFieldLabel}' updated successfully.` : `Added field '${newFieldLabel}' successfully.`);
      setEditingField(null);
      setNewFieldName('');
      setNewFieldLabel('');
      setNewFieldType('text');
      setNewFieldRequired(false);
      setNewFieldShowTable(true);
      setNewFieldChipGroup('');
      setNewFieldRefModule('');
    } else {
      showStatus('error', res.message);
    }
  };

  const handleStartEditField = (field) => {
    setEditingField(field);
    setNewFieldName(field.name);
    setNewFieldLabel(field.label);
    setNewFieldType(field.type);
    setNewFieldRequired(field.required || false);
    setNewFieldShowTable(field.showInTable !== false);
    setNewFieldChipGroup(field.chipGroup || '');
    setNewFieldRefModule(field.refModule || '');
  };

  const handleCancelEditField = () => {
    setEditingField(null);
    setNewFieldName('');
    setNewFieldLabel('');
    setNewFieldType('text');
    setNewFieldRequired(false);
    setNewFieldShowTable(true);
    setNewFieldChipGroup('');
    setNewFieldRefModule('');
  };

  const handleMoveFieldUp = async (fieldName) => {
    const updated = { ...metadata };
    const fields = updated.modules[selectedModule].fields;
    const idx = fields.findIndex(f => f.name === fieldName);
    if (idx > 0) {
      const temp = fields[idx];
      fields[idx] = fields[idx - 1];
      fields[idx - 1] = temp;

      const res = await saveMetadata(updated);
      if (res.success) {
        showStatus('success', `Moved field '${fieldName}' up.`);
      } else {
        showStatus('error', res.message);
      }
    }
  };

  const handleMoveFieldDown = async (fieldName) => {
    const updated = { ...metadata };
    const fields = updated.modules[selectedModule].fields;
    const idx = fields.findIndex(f => f.name === fieldName);
    if (idx !== -1 && idx < fields.length - 1) {
      const temp = fields[idx];
      fields[idx] = fields[idx + 1];
      fields[idx + 1] = temp;

      const res = await saveMetadata(updated);
      if (res.success) {
        showStatus('success', `Moved field '${fieldName}' down.`);
      } else {
        showStatus('error', res.message);
      }
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const updated = { ...metadata };
    const fields = [...updated.modules[selectedModule].fields];
    
    // Swap item positions
    const [draggedItem] = fields.splice(draggedIndex, 1);
    fields.splice(targetIndex, 0, draggedItem);
    
    updated.modules[selectedModule].fields = fields;

    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', 'Field alignment updated successfully.');
    } else {
      showStatus('error', res.message);
    }
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const indexToAlphabet = (index) => {
    let temp = index;
    let label = '';
    while (temp >= 0) {
      label = String.fromCharCode((temp % 26) + 65) + label;
      temp = Math.floor(temp / 26) - 1;
    }
    return label;
  };

  const alphabetToIndex = (str) => {
    const clean = str.toUpperCase().trim().replace(/[^A-Z]/g, '');
    if (!clean) return -1;
    let index = 0;
    for (let i = 0; i < clean.length; i++) {
      index = index * 26 + (clean.charCodeAt(i) - 64);
    }
    return index - 1;
  };

  const handleAlphabetPositionChange = async (fieldName, alphabetStr) => {
    const cleanStr = alphabetStr.toUpperCase().trim().replace(/[^A-Z]/g, '');
    if (!cleanStr) return;

    const targetIdx = alphabetToIndex(cleanStr);
    if (targetIdx < 0) return;

    const updated = { ...metadata };
    const fields = [...updated.modules[selectedModule].fields];
    const idx = fields.findIndex(f => f.name === fieldName);
    if (idx === -1) return;

    let finalTargetIdx = targetIdx;
    if (finalTargetIdx >= fields.length) {
      finalTargetIdx = fields.length - 1;
    }

    if (idx === finalTargetIdx) return;

    // Reposition item
    const [item] = fields.splice(idx, 1);
    fields.splice(finalTargetIdx, 0, item);

    updated.modules[selectedModule].fields = fields;

    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', `Position for '${fieldName}' updated to '${cleanStr}'.`);
    } else {
      showStatus('error', res.message);
    }
  };

  const handleDeleteField = async (fieldName) => {
    if (fieldName === 'id') {
      showStatus('error', 'Cannot delete primary identifier field "id".');
      return;
    }
    if (window.confirm(`Delete field '${fieldName}' from module schema?`)) {
      const updated = { ...metadata };
      updated.modules[selectedModule].fields = updated.modules[selectedModule].fields.filter(f => f.name !== fieldName);
      const res = await saveMetadata(updated);
      if (res.success) {
        showStatus('success', `Field '${fieldName}' removed from schema.`);
      } else {
        showStatus('error', res.message);
      }
    }
  };

  // --- CHIPS OPTIONS MANAGEMENT ---

  const handleAddChip = async (e) => {
    e.preventDefault();
    if (!newChipVal.trim() || !newChipLabel.trim()) {
      showStatus('error', 'Option Value and Label are required.');
      return;
    }

    const updated = { ...metadata };
    if (!updated.chips[selectedChipGroup]) {
      updated.chips[selectedChipGroup] = [];
    }

    // Check duplicate
    if (updated.chips[selectedChipGroup].some(c => c.value === newChipVal)) {
      showStatus('error', 'Option value already exists.');
      return;
    }

    updated.chips[selectedChipGroup].push({
      value: newChipVal.trim(),
      label: newChipLabel.trim(),
      color: newChipColor
    });

    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', `Added dropdown option '${newChipLabel}' successfully.`);
      setNewChipVal('');
      setNewChipLabel('');
      setNewChipColor('#2563EB');
    } else {
      showStatus('error', res.message);
    }
  };

  const handleDeleteChip = async (val) => {
    if (window.confirm(`Delete dropdown option '${val}'?`)) {
      const updated = { ...metadata };
      updated.chips[selectedChipGroup] = updated.chips[selectedChipGroup].filter(c => c.value !== val);
      const res = await saveMetadata(updated);
      if (res.success) {
        showStatus('success', 'Dropdown option removed.');
      } else {
        showStatus('error', res.message);
      }
    }
  };

  const handleShiftChip = async (groupName, index, direction) => {
    const updated = { ...metadata };
    if (!updated.chips || !updated.chips[groupName]) return;
    const array = [...updated.chips[groupName]];
    
    if (direction === 'up' && index > 0) {
      const temp = array[index];
      array[index] = array[index - 1];
      array[index - 1] = temp;
    } else if (direction === 'down' && index < array.length - 1) {
      const temp = array[index];
      array[index] = array[index + 1];
      array[index + 1] = temp;
    }

    updated.chips[groupName] = array;
    const res = await saveMetadata(updated);
    if (!res.success) {
      showStatus('error', res.message);
    }
  };

  const handleFieldLabelChange = (val) => {
    setNewFieldLabel(val);
    const slug = val.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    setNewFieldName(slug);
  };

  const handleChipLabelChange = (val) => {
    setNewChipLabel(val);
    const slug = val.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    setNewChipVal(slug);
  };

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) {
      showStatus('error', 'Please enter a category name.');
      return;
    }

    // Validate key (lowercase, alphanumeric, no spaces, starts with letter)
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
      showStatus('error', 'Category key must be lowercase alphanumeric with no spaces (e.g. lead_sources).');
      return;
    }

    if (metadata.chips[name]) {
      showStatus('error', 'A category with this key already exists.');
      return;
    }

    const updated = { ...metadata };
    updated.chips[name] = []; // initialize as empty array

    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', `Dropdown Category '${name}' created successfully!`);
      setSelectedChipGroup(name);
      setNewCategoryName('');
    } else {
      showStatus('error', res.message);
    }
  };

  // --- PERMISSIONS MANAGEMENT ---

  const handlePermissionToggle = async (roleName, moduleKey, action) => {
    const updated = { ...metadata };
    if (!updated.rolesPermissions[roleName]) {
      updated.rolesPermissions[roleName] = {};
    }
    if (!updated.rolesPermissions[roleName][moduleKey]) {
      updated.rolesPermissions[roleName][moduleKey] = [];
    }

    const perms = updated.rolesPermissions[roleName][moduleKey];
    if (perms.includes(action)) {
      updated.rolesPermissions[roleName][moduleKey] = perms.filter(a => a !== action);
    } else {
      updated.rolesPermissions[roleName][moduleKey].push(action);
    }

    const res = await saveMetadata(updated);
    if (!res.success) {
      showStatus('error', res.message);
    }
  };

  const handleFieldPermissionToggle = async (roleName, moduleKey, fieldName) => {
    const updated = { ...metadata };
    if (!updated.fieldPermissions) {
      updated.fieldPermissions = {};
    }
    if (!updated.fieldPermissions[roleName]) {
      updated.fieldPermissions[roleName] = {};
    }
    if (!updated.fieldPermissions[roleName][moduleKey]) {
      // Default to all fields allowed if never customized before
      const allFields = updated.modules[moduleKey].fields.map(f => f.name);
      updated.fieldPermissions[roleName][moduleKey] = allFields;
    }

    const allowed = updated.fieldPermissions[roleName][moduleKey];
    if (allowed.includes(fieldName)) {
      updated.fieldPermissions[roleName][moduleKey] = allowed.filter(f => f !== fieldName);
    } else {
      updated.fieldPermissions[roleName][moduleKey].push(fieldName);
    }

    const res = await saveMetadata(updated);
    if (!res.success) {
      showStatus('error', res.message);
    }
  };

  const handleUserPermissionToggle = async (userId, moduleKey, action) => {
    const updated = { ...metadata };
    if (!updated.userPermissions) {
      updated.userPermissions = {};
    }
    if (!updated.userPermissions[userId]) {
      const emp = (moduleData.employees || []).find(e => String(e.id) === String(userId));
      const role = emp?.role || 'Employee';
      updated.userPermissions[userId] = JSON.parse(JSON.stringify(updated.rolesPermissions[role] || {}));
    }
    if (!updated.userPermissions[userId][moduleKey]) {
      updated.userPermissions[userId][moduleKey] = [];
    }

    const perms = updated.userPermissions[userId][moduleKey];
    if (perms.includes(action)) {
      updated.userPermissions[userId][moduleKey] = perms.filter(a => a !== action);
    } else {
      updated.userPermissions[userId][moduleKey].push(action);
    }

    const res = await saveMetadata(updated);
    if (!res.success) {
      showStatus('error', res.message);
    }
  };

  const handleUserColumnPermissionToggle = async (userId, moduleKey, columnName, action) => {
    const updated = { ...metadata };
    if (!updated.userColumnPermissions) {
      updated.userColumnPermissions = {};
    }
    if (!updated.userColumnPermissions[userId]) {
      updated.userColumnPermissions[userId] = {};
    }
    if (!updated.userColumnPermissions[userId][moduleKey]) {
      updated.userColumnPermissions[userId][moduleKey] = {};
    }
    if (!updated.userColumnPermissions[userId][moduleKey][columnName]) {
      updated.userColumnPermissions[userId][moduleKey][columnName] = ["view", "edit"];
    }

    const current = updated.userColumnPermissions[userId][moduleKey][columnName];
    if (current.includes(action)) {
      updated.userColumnPermissions[userId][moduleKey][columnName] = current.filter(a => a !== action);
    } else {
      updated.userColumnPermissions[userId][moduleKey][columnName].push(action);
    }

    const res = await saveMetadata(updated);
    if (!res.success) {
      showStatus('error', res.message);
    }
  };

  const handleResetUserPermissions = async (userId) => {
    if (!window.confirm("Are you sure you want to reset this user's custom permissions? They will revert to default role permissions.")) return;
    const updated = { ...metadata };
    let changed = false;
    if (updated.userPermissions && updated.userPermissions[userId]) {
      delete updated.userPermissions[userId];
      changed = true;
    }
    if (updated.userColumnPermissions && updated.userColumnPermissions[userId]) {
      delete updated.userColumnPermissions[userId];
      changed = true;
    }
    if (changed) {
      const res = await saveMetadata(updated);
      if (res.success) {
        showStatus('success', 'Reset user permissions to default role permissions.');
      } else {
        showStatus('error', res.message);
      }
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!passwordSelectedEmp || !newPasswordVal || !confirmPasswordVal) {
      showStatus('error', 'Please fill in all fields.');
      return;
    }

    if (newPasswordVal !== confirmPasswordVal) {
      showStatus('error', 'Passwords do not match.');
      return;
    }

    // Password strength validation regex
    const strengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
    if (!strengthRegex.test(newPasswordVal)) {
      showStatus('error', 'Password must be at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.');
      return;
    }

    try {
      const token = localStorage.getItem('gr_crm_token');
      const response = await axios.post(`${API_BASE_URL}/auth/admin/reset-password`, {
        employeeId: passwordSelectedEmp,
        password: newPasswordVal,
        confirmPassword: confirmPasswordVal
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        showStatus('success', response.data.message || 'Password updated successfully!');
        setNewPasswordVal('');
        setConfirmPasswordVal('');
      } else {
        showStatus('error', response.data.message || 'Failed to update password.');
      }
    } catch (err) {
      showStatus('error', err.response?.data?.message || 'Server error. Password update failed.');
    }
  };

  // --- GOOGLE SHEETS SETTINGS MANAGEMENT ---

  const handleSheetsConfigChange = (field, val) => {
    const updated = { ...metadata };
    updated.sheetsConfig[field] = val;
    saveMetadata(updated);
  };

  const handleSaveSheetsConfig = async (e) => {
    e.preventDefault();
    const updated = { ...metadata };
    updated.sheetsConfig = {
      spreadsheetId: sheetsId.trim(),
      clientEmail: sheetsEmail.trim(),
      privateKey: sheetsKey,
      syncActive: sheetsActive
    };
    const res = await saveMetadata(updated);
    if (res.success) {
      showStatus('success', 'Google Sheets configuration saved successfully!');
    } else {
      showStatus('error', res.message);
    }
  };

  const handleTestSheets = async () => {
    setSyncLoading(true);
    const res = await testSheetsSync();
    setSyncLoading(false);
    if (res.success) {
      showStatus('success', res.message);
    } else {
      showStatus('error', res.message);
    }
  };

  const handleSyncNow = async () => {
    setSyncLoading(true);
    const res = await triggerFullSheetsSync();
    setSyncLoading(false);
    if (res.success) {
      showStatus('success', res.message);
    } else {
      showStatus('error', res.message);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Title */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '26px', color: '#0F172A', fontFamily: 'Poppins' }}>
          Admin Settings & Metadata Editor
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B' }}>
          Fully customize tables, columns, dropdown chips, roles, permissions, and Google Sheets integration without writing code.
        </Typography>
      </Box>

      {/* Settings Menu Tabs */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
            <CardContent sx={{ p: 1.5 }}>
              <List disablePadding>
                <ListItem button onClick={() => setActiveTab('fields')} selected={activeTab === 'fields'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'fields' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'fields' ? '#2563EB' : '#4B5563' }}>
                  <Icons.Columns size={18} style={{ marginRight: 10 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Custom Columns & Fields</Typography>
                </ListItem>
                <ListItem button onClick={() => setActiveTab('chips')} selected={activeTab === 'chips'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'chips' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'chips' ? '#2563EB' : '#4B5563' }}>
                  <Icons.Tag size={18} style={{ marginRight: 10 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Chips & Dropdowns</Typography>
                </ListItem>
                <ListItem button onClick={() => setActiveTab('permissions')} selected={activeTab === 'permissions'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'permissions' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'permissions' ? '#2563EB' : '#4B5563' }}>
                  <Icons.ShieldCheck size={18} style={{ marginRight: 10 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Role Permissions Matrix</Typography>
                </ListItem>
                <ListItem button onClick={() => setActiveTab('passwords')} selected={activeTab === 'passwords'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'passwords' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'passwords' ? '#2563EB' : '#4B5563' }}>
                  <Icons.Lock size={18} style={{ marginRight: 10 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Reset Passwords</Typography>
                </ListItem>
                 <ListItem button onClick={() => setActiveTab('sheets')} selected={activeTab === 'sheets'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'sheets' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'sheets' ? '#2563EB' : '#4B5563' }}>
                  <Icons.FileSpreadsheet size={18} style={{ marginRight: 10 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Google Sheets Config</Typography>
                </ListItem>
                 <ListItem button onClick={() => setActiveTab('rotation')} selected={activeTab === 'rotation'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'rotation' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'rotation' ? '#2563EB' : '#4B5563' }}>
                   <Icons.RefreshCw size={18} style={{ marginRight: 10 }} />
                   <Typography variant="body2" sx={{ fontWeight: 600 }}>Lead Rotation Engine</Typography>
                 </ListItem>
                 <ListItem button onClick={() => setActiveTab('templates')} selected={activeTab === 'templates'} sx={{ borderRadius: '8px', mb: 0.5, py: 1.5, backgroundColor: activeTab === 'templates' ? 'rgba(37,99,235,0.08) !important' : 'transparent', color: activeTab === 'templates' ? '#2563EB' : '#4B5563' }}>
                   <Icons.MessageSquare size={18} style={{ marginRight: 10 }} />
                   <Typography variant="body2" sx={{ fontWeight: 600 }}>Notification Templates</Typography>
                 </ListItem>
               </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Settings Tab Contents */}
        <Grid item xs={12} md={9}>
          {statusMsg.text && (
            <Alert severity={statusMsg.type} onClose={() => setStatusMsg({ type: '', text: '' })} sx={{ mb: 3, borderRadius: '8px' }}>
              {statusMsg.text}
            </Alert>
          )}

          {/* TAB 1: FIELDS SCHEMA EDITOR */}
          {activeTab === 'fields' && (
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
              <CardContent sx={{ p: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={3.5}>
                  <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', fontFamily: 'Poppins' }}>
                    Configure Fields for Modules
                  </Typography>
                  <FormControl size="small" sx={{ width: 200 }}>
                    <InputLabel>Select Module</InputLabel>
                    <Select
                      label="Select Module"
                      value={selectedModule}
                      onChange={(e) => setSelectedModule(e.target.value)}
                    >
                      {Object.keys(metadata.modules).map(key => (
                        <MenuItem key={key} value={key}>{metadata.modules[key].label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* List Current Fields */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Active Fields in '{metadata.modules[selectedModule].label}' Schema</Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 4, borderRadius: '8px', boxShadow: 'none' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 40 }}></TableCell>
                        <TableCell sx={{ width: 70 }}>Order</TableCell>
                        <TableCell>Field Name (key)</TableCell>
                        <TableCell>Display Label</TableCell>
                        <TableCell>Data Type</TableCell>
                        <TableCell>Required</TableCell>
                        <TableCell>Show in Grid</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {metadata.modules[selectedModule].fields.map((f, index) => (
                        <TableRow 
                          key={f.name}
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          sx={{ 
                            cursor: 'grab',
                            backgroundColor: draggedIndex === index ? 'rgba(37, 99, 235, 0.08) !important' : 'transparent',
                            opacity: draggedIndex === index ? 0.5 : 1,
                            '&:hover': { backgroundColor: '#F8FAFC' },
                            transition: 'opacity 0.15s, background-color 0.15s'
                          }}
                        >
                          <TableCell sx={{ width: 40, color: '#94A3B8', borderBottom: 'none', py: 1.5 }}>
                            <Icons.GripVertical size={16} style={{ cursor: 'grab' }} />
                          </TableCell>
                          <TableCell sx={{ width: 70, borderBottom: 'none' }}>
                            <TextField
                              size="small"
                              value={indexToAlphabet(index)}
                              onChange={(e) => handleAlphabetPositionChange(f.name, e.target.value)}
                              inputProps={{ 
                                style: { textAlign: 'center', padding: '4px 6px', textTransform: 'uppercase' } 
                              }}
                              sx={{ width: 55 }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{f.name}</TableCell>
                          <TableCell>{f.label}</TableCell>
                          <TableCell><Chip label={f.type} size="small" sx={{ height: 18, fontSize: '10px', textTransform: 'uppercase' }} /></TableCell>
                          <TableCell>
                            <Checkbox 
                              size="small"
                              checked={f.required || false}
                              disabled={f.name === 'id'}
                              onChange={async (e) => {
                                const updatedFields = [...metadata.modules[selectedModule].fields];
                                const fIdx = updatedFields.findIndex(field => field.name === f.name);
                                if (fIdx !== -1) {
                                  updatedFields[fIdx] = { ...f, required: e.target.checked };
                                  const updated = {
                                    ...metadata,
                                    modules: {
                                      ...metadata.modules,
                                      [selectedModule]: {
                                        ...metadata.modules[selectedModule],
                                        fields: updatedFields
                                      }
                                    }
                                  };
                                  await saveMetadata(updated);
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Checkbox 
                              size="small"
                              checked={f.showInTable !== false}
                              disabled={f.name === 'id'}
                              onChange={async (e) => {
                                const updatedFields = [...metadata.modules[selectedModule].fields];
                                const fIdx = updatedFields.findIndex(field => field.name === f.name);
                                if (fIdx !== -1) {
                                  updatedFields[fIdx] = { ...f, showInTable: e.target.checked };
                                  const updated = {
                                    ...metadata,
                                    modules: {
                                      ...metadata.modules,
                                      [selectedModule]: {
                                        ...metadata.modules[selectedModule],
                                        fields: updatedFields
                                      }
                                    }
                                  };
                                  await saveMetadata(updated);
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <IconButton 
                              size="small" 
                              onClick={() => handleMoveFieldUp(f.name)} 
                              disabled={index === 0}
                              sx={{ mr: 0.5 }}
                            >
                              <Icons.ChevronUp size={14} />
                            </IconButton>
                            <IconButton 
                              size="small" 
                              onClick={() => handleMoveFieldDown(f.name)} 
                              disabled={index === metadata.modules[selectedModule].fields.length - 1}
                              sx={{ mr: 1 }}
                            >
                              <Icons.ChevronDown size={14} />
                            </IconButton>
                            {f.name !== 'id' && (
                              <IconButton size="small" color="primary" onClick={() => handleStartEditField(f)} sx={{ mr: 1 }}>
                                <Icons.Pencil size={14} />
                              </IconButton>
                            )}
                            <IconButton size="small" color="error" onClick={() => handleDeleteField(f.name)}>
                              <Icons.Trash2 size={14} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Divider sx={{ mb: 3 }} />

                {/* Add new field form */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                  {editingField ? `Edit Field Schema: ${editingField.name}` : 'Register Custom Field'}
                </Typography>
                <Box component="form" onSubmit={handleAddField}>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <TextField 
                        label="Display Title (e.g. Near Landmark)" 
                        fullWidth
                        size="small"
                        value={newFieldLabel}
                        onChange={(e) => handleFieldLabelChange(e.target.value)}
                        required
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField 
                        label="Field API Name (lowercase, no spaces, e.g. landmark)" 
                        fullWidth
                        size="small"
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                        required
                        disabled={!!editingField}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Type</InputLabel>
                        <Select
                          label="Type"
                          value={newFieldType}
                          onChange={(e) => setNewFieldType(e.target.value)}
                        >
                          <MenuItem value="text">Text (short string)</MenuItem>
                          <MenuItem value="number">Number (float/int)</MenuItem>
                          <MenuItem value="date">Calendar Date</MenuItem>
                          <MenuItem value="select">Dropdown Chip (Select)</MenuItem>
                          <MenuItem value="textarea">Paragraph Box (textarea)</MenuItem>
                          <MenuItem value="ref">Relationship Lookup (Ref)</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>

                    {newFieldType === 'select' && (
                      <Grid item xs={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Chips Dropdown Group</InputLabel>
                          <Select
                            label="Chips Dropdown Group"
                            value={newFieldChipGroup}
                            onChange={(e) => setNewFieldChipGroup(e.target.value)}
                          >
                            {Object.keys(metadata.chips).map(group => (
                              <MenuItem key={group} value={group}>{group}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}

                    {newFieldType === 'ref' && (
                      <Grid item xs={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Reference Table Module</InputLabel>
                          <Select
                            label="Reference Table Module"
                            value={newFieldRefModule}
                            onChange={(e) => setNewFieldRefModule(e.target.value)}
                          >
                            {Object.keys(metadata.modules).map(mod => (
                              <MenuItem key={mod} value={mod}>{metadata.modules[mod].label}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}

                    <Grid item xs={6} display="flex" gap={2} alignItems="center">
                      <FormControlLabel
                        control={<Checkbox checked={newFieldRequired} onChange={(e)=>setNewFieldRequired(e.target.checked)} />}
                        label="Required validation"
                      />
                      <FormControlLabel
                        control={<Checkbox checked={newFieldShowTable} onChange={(e)=>setNewFieldShowTable(e.target.checked)} />}
                        label="Show in Table Grid"
                      />
                    </Grid>
                     <Grid item xs={12} display="flex" justifyContent="flex-end" gap={2}>
                       {editingField && (
                         <Button variant="outlined" onClick={handleCancelEditField} startIcon={<Icons.X size={16} />}>
                           Cancel
                         </Button>
                       )}
                       <Button type="submit" variant="contained" startIcon={editingField ? <Icons.Save size={16} /> : <Icons.Plus size={16} />}>
                         {editingField ? 'Update Field Schema' : 'Add Field Schema'}
                       </Button>
                     </Grid>
                  </Grid>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* TAB 2: CHIPS EDITOR */}
          {activeTab === 'chips' && (
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
              <CardContent sx={{ p: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={3.5}>
                  <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', fontFamily: 'Poppins' }}>
                    Configure Chip Dropdowns
                  </Typography>
                  <FormControl size="small" sx={{ width: 220 }}>
                    <InputLabel>Select Chip Category</InputLabel>
                    <Select
                      label="Select Chip Category"
                      value={selectedChipGroup}
                      onChange={(e) => setSelectedChipGroup(e.target.value)}
                    >
                      {Object.keys(metadata.chips).map(group => (
                        <MenuItem key={group} value={group}>{group}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* List Current Chip Choices */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Available Chip values & Ordering</Typography>
                <Box sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', overflow: 'hidden', mb: 4 }}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Label / Preview</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Value Code</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="center">Reorder</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {!metadata.chips[selectedChipGroup] || metadata.chips[selectedChipGroup].length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} align="center" sx={{ py: 3, color: '#94A3B8' }}>
                            No options listed for this category.
                          </TableCell>
                        </TableRow>
                      ) : (
                        metadata.chips[selectedChipGroup].map((chip, index) => (
                          <TableRow key={chip.value} hover>
                            <TableCell>
                              <Chip 
                                label={chip.label}
                                sx={{ 
                                  backgroundColor: `${chip.color}15`, 
                                  color: chip.color, 
                                  border: `1px solid ${chip.color}30`, 
                                  fontWeight: 700 
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', color: '#475569' }}>
                              {chip.value}
                            </TableCell>
                            <TableCell align="center">
                              <Box display="flex" justifyContent="center" gap={0.5}>
                                <IconButton 
                                  size="small" 
                                  disabled={index === 0} 
                                  onClick={() => handleShiftChip(selectedChipGroup, index, 'up')}
                                  sx={{ color: '#2563EB' }}
                                >
                                  <Icons.ArrowUp size={16} />
                                </IconButton>
                                <IconButton 
                                  size="small" 
                                  disabled={index === metadata.chips[selectedChipGroup].length - 1} 
                                  onClick={() => handleShiftChip(selectedChipGroup, index, 'down')}
                                  sx={{ color: '#2563EB' }}
                                >
                                  <Icons.ArrowDown size={16} />
                                </IconButton>
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              <IconButton 
                                size="small" 
                                color="error" 
                                onClick={() => handleDeleteChip(chip.value)}
                              >
                                <Icons.Trash2 size={16} />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* Form to add choice */}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Add Dropdown Choice</Typography>
                <Box component="form" onSubmit={handleAddChip}>
                  <Grid container spacing={2}>
                    <Grid item xs={4}>
                      <TextField 
                        label="Display Title (e.g. Dealer)" 
                        fullWidth
                        size="small"
                        value={newChipLabel}
                        onChange={(e)=>handleChipLabelChange(e.target.value)}
                        required
                      />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField 
                        label="API value (lowercase, no spaces, e.g. dealer)" 
                        fullWidth
                        size="small"
                        value={newChipVal}
                        onChange={(e)=>setNewChipVal(e.target.value)}
                        required
                      />
                    </Grid>
                    <Grid item xs={3}>
                      <TextField 
                        type="color"
                        label="Chip Hex Color" 
                        fullWidth
                        size="small"
                        value={newChipColor}
                        onChange={(e)=>setNewChipColor(e.target.value)}
                      />
                    </Grid>
                    <Grid item xs={1} display="flex" alignItems="flex-end">
                      <Button type="submit" variant="contained" fullWidth sx={{ height: 40, p: 0 }}>
                        <Icons.Plus size={18} />
                      </Button>
                    </Grid>
                  </Grid>
                </Box>

                <Divider sx={{ my: 4 }} />

                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>Register New Dropdown Category</Typography>
                <Box component="form" onSubmit={handleCreateCategory} sx={{ maxWidth: 500 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={8}>
                      <TextField 
                        label="Category Key Name (e.g. lead_sources)" 
                        fullWidth
                        size="small"
                        value={newCategoryName}
                        onChange={(e)=>setNewCategoryName(e.target.value)}
                        placeholder="lowercase_with_underscores"
                        required
                      />
                    </Grid>
                    <Grid item xs={4} display="flex" alignItems="flex-end">
                      <Button type="submit" variant="contained" fullWidth sx={{ height: 40 }} startIcon={<Icons.Plus size={16} />}>
                        Create Category
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* TAB 3: ROLE PERMISSIONS MATRIX */}
          {activeTab === 'permissions' && (
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 1, fontFamily: 'Poppins' }}>
                  Role Permission matrix
                </Typography>
                <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                  Configure module access permissions (View, Create, Edit, Delete, Export) per security role.
                </Typography>

                <Divider sx={{ mb: 3 }} />

                <TableContainer component={Paper} sx={{ border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Module Target</TableCell>
                        {Object.keys(metadata.rolesPermissions).map(role => (
                          <TableCell key={role} align="center" sx={{ fontWeight: 600 }}>{role}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.keys(metadata.modules).map(moduleKey => (
                        <TableRow key={moduleKey}>
                          <TableCell sx={{ fontWeight: 600 }}>{metadata.modules[moduleKey].label}</TableCell>
                          
                          {Object.keys(metadata.rolesPermissions).map(role => {
                            const hasView = (metadata.rolesPermissions[role][moduleKey] || []).includes('view');
                            const hasCreate = (metadata.rolesPermissions[role][moduleKey] || []).includes('create');
                            const hasEdit = (metadata.rolesPermissions[role][moduleKey] || []).includes('edit');
                            const hasDelete = (metadata.rolesPermissions[role][moduleKey] || []).includes('delete');
                            const hasExport = (metadata.rolesPermissions[role][moduleKey] || []).includes('export');

                            return (
                              <TableCell key={role} align="center">
                                <Box display="flex" flexDirection="column" gap={0.5} alignItems="center">
                                  <FormControlLabel
                                    control={
                                      <Checkbox 
                                        size="small" 
                                        checked={hasView} 
                                        onChange={() => handlePermissionToggle(role, moduleKey, 'view')} 
                                      />
                                    }
                                    label={<span style={{ fontSize: '10px', fontWeight: 600 }}>View</span>}
                                    sx={{ m: 0 }}
                                  />
                                  <FormControlLabel
                                    control={
                                      <Checkbox 
                                        size="small" 
                                        checked={hasCreate} 
                                        onChange={() => handlePermissionToggle(role, moduleKey, 'create')} 
                                      />
                                    }
                                    label={<span style={{ fontSize: '10px', fontWeight: 600 }}>Create</span>}
                                    sx={{ m: 0 }}
                                  />
                                  <FormControlLabel
                                    control={
                                      <Checkbox 
                                        size="small" 
                                        checked={hasEdit} 
                                        onChange={() => handlePermissionToggle(role, moduleKey, 'edit')} 
                                      />
                                    }
                                    label={<span style={{ fontSize: '10px', fontWeight: 600 }}>Edit</span>}
                                    sx={{ m: 0 }}
                                  />
                                  <FormControlLabel
                                    control={
                                      <Checkbox 
                                        size="small" 
                                        checked={hasDelete} 
                                        onChange={() => handlePermissionToggle(role, moduleKey, 'delete')} 
                                      />
                                    }
                                    label={<span style={{ fontSize: '10px', fontWeight: 600 }}>Delete</span>}
                                    sx={{ m: 0 }}
                                  />
                                </Box>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Individual Employee Permissions Override section */}
                <Box sx={{ mt: 5 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '16px', mb: 1, fontFamily: 'Poppins' }}>
                    Individual Employee Permissions (Overrides)
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                    Set custom access controls for a specific employee by name. Overrides their default role settings.
                  </Typography>

                  <Grid container spacing={3} sx={{ mb: 3 }}>
                    <Grid item xs={12} sm={6}>
                      <FormControl size="small" fullWidth>
                        <InputLabel>Select Employee</InputLabel>
                        <Select
                          label="Select Employee"
                          value={selectedUserForPerms}
                          onChange={(e) => setSelectedUserForPerms(e.target.value)}
                        >
                          <MenuItem value=""><em>None selected</em></MenuItem>
                          {(moduleData.employees || []).filter(e => e.role !== 'Admin').map(emp => (
                            <MenuItem key={emp.id} value={emp.id}>
                              {emp.name} ({emp.id} • {emp.role || 'Staff'})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {selectedUserForPerms && metadata?.userPermissions?.[selectedUserForPerms] && (
                      <Grid item xs={12} sm={6}>
                        <Button 
                          variant="outlined" 
                          color="error" 
                          size="small"
                          onClick={() => handleResetUserPermissions(selectedUserForPerms)}
                          sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                          Reset User Permissions Override
                        </Button>
                      </Grid>
                    )}
                  </Grid>

                  {selectedUserForPerms && (() => {
                    const empObj = (moduleData.employees || []).find(e => e.id === selectedUserForPerms);
                    const userRole = empObj?.role || 'Employee';
                    
                    // User perms or fallback display of role perms
                    const userHasOverride = Boolean(metadata?.userPermissions?.[selectedUserForPerms]);
                    const currentPerms = metadata?.userPermissions?.[selectedUserForPerms] || metadata?.rolesPermissions?.[userRole] || {};

                    return (
                      <Box>
                        {!userHasOverride && (
                          <Alert severity="info" sx={{ mb: 2, fontSize: '12px' }}>
                            Currently showing default role permissions for <strong>{userRole}</strong>. Interacting with checkboxes will automatically create a custom override for <strong>{empObj?.name}</strong>.
                          </Alert>
                        )}
                        <TableContainer component={Paper} sx={{ border: '1px solid #E2E8F0', boxShadow: 'none' }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 600 }}>Module Target</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 600 }}>View</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 600 }}>Create</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 600 }}>Edit</TableCell>
                                <TableCell align="center" sx={{ fontWeight: 600 }}>Delete</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {Object.keys(metadata.modules).map(moduleKey => {
                                const hasView = (currentPerms[moduleKey] || []).includes('view');
                                const hasCreate = (currentPerms[moduleKey] || []).includes('create');
                                const hasEdit = (currentPerms[moduleKey] || []).includes('edit');
                                const hasDelete = (currentPerms[moduleKey] || []).includes('delete');

                                return (
                                  <TableRow key={moduleKey}>
                                    <TableCell sx={{ fontWeight: 600 }}>{metadata.modules[moduleKey].label}</TableCell>
                                    <TableCell align="center">
                                      <Checkbox 
                                        size="small" 
                                        checked={hasView} 
                                        onChange={() => handleUserPermissionToggle(selectedUserForPerms, moduleKey, 'view')} 
                                      />
                                    </TableCell>
                                    <TableCell align="center">
                                      <Checkbox 
                                        size="small" 
                                        checked={hasCreate} 
                                        onChange={() => handleUserPermissionToggle(selectedUserForPerms, moduleKey, 'create')} 
                                      />
                                    </TableCell>
                                    <TableCell align="center">
                                      <Checkbox 
                                        size="small" 
                                        checked={hasEdit} 
                                        onChange={() => handleUserPermissionToggle(selectedUserForPerms, moduleKey, 'edit')} 
                                      />
                                    </TableCell>
                                    <TableCell align="center">
                                      <Checkbox 
                                        size="small" 
                                        checked={hasDelete} 
                                        onChange={() => handleUserPermissionToggle(selectedUserForPerms, moduleKey, 'delete')} 
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    );
                  })()}

                  {selectedUserForPerms && (
                    <Box sx={{ mt: 4, p: 3, border: '1px solid #E2E8F0', borderRadius: '12px', backgroundColor: '#F8FAFC' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#0F172A', fontFamily: 'Poppins' }}>
                        Custom Column (Field) Permissions for {(moduleData.employees || []).find(e => String(e.id) === String(selectedUserForPerms))?.name}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                        Check columns to allow this employee to view and edit them. Uncheck to hide them.
                      </Typography>

                      <FormControl size="small" sx={{ mb: 3, minWidth: 200 }}>
                        <InputLabel>Select Module</InputLabel>
                        <Select
                          label="Select Module"
                          value={userPermSelectedModule || 'leads'}
                          onChange={(e) => setUserPermSelectedModule(e.target.value)}
                        >
                          {Object.keys(metadata.modules).map(key => (
                            <MenuItem key={key} value={key}>{metadata.modules[key].label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <Grid container spacing={2}>
                        {metadata.modules[userPermSelectedModule || 'leads'].fields.map(field => {
                          const userOverriden = metadata.userColumnPermissions?.[selectedUserForPerms]?.[userPermSelectedModule || 'leads']?.[field.name];
                          const isChecked = userOverriden !== undefined ? userOverriden.includes('view') : true;

                          return (
                            <Grid item xs={12} sm={6} md={4} key={field.name}>
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={isChecked}
                                    onChange={() => handleUserColumnPermissionToggle(selectedUserForPerms, userPermSelectedModule || 'leads', field.name, 'view')}
                                    sx={{ '&.Mui-checked': { color: '#2563EB' } }}
                                  />
                                }
                                label={field.label}
                              />
                            </Grid>
                          );
                        })}
                      </Grid>
                    </Box>
                  )}
                </Box>

                <Box sx={{ mt: 5 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '16px', mb: 1, fontFamily: 'Poppins' }}>
                    Field-Level Column Permissions (FLAC)
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                    Control which database fields (columns) are visible/editable to security roles. Check to allow, uncheck to hide.
                  </Typography>

                  <Divider sx={{ mb: 3 }} />

                  <Grid container spacing={3} sx={{ mb: 3 }}>
                    <Grid item xs={12} sm={6}>
                      <FormControl size="small" fullWidth>
                        <InputLabel>Select Target Role</InputLabel>
                        <Select
                          label="Select Target Role"
                          value={permSelectedRole}
                          onChange={(e) => setPermSelectedRole(e.target.value)}
                        >
                          {Object.keys(metadata.rolesPermissions).filter(r => r !== 'Admin').map(role => (
                            <MenuItem key={role} value={role}>{role}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <FormControl size="small" fullWidth>
                        <InputLabel>Select Module</InputLabel>
                        <Select
                          label="Select Module"
                          value={permSelectedModule}
                          onChange={(e) => setPermSelectedModule(e.target.value)}
                        >
                          {Object.keys(metadata.modules).map(key => (
                            <MenuItem key={key} value={key}>{metadata.modules[key].label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>

                  <Box sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', p: 3, backgroundColor: '#F8FAFC' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                      Visible Columns in '{metadata.modules[permSelectedModule].label}' for '{permSelectedRole}'
                    </Typography>
                    <Grid container spacing={2}>
                      {metadata.modules[permSelectedModule].fields.map(field => {
                        const allowedList = metadata.fieldPermissions?.[permSelectedRole]?.[permSelectedModule];
                        const isChecked = allowedList ? allowedList.includes(field.name) : true;

                        return (
                          <Grid item xs={12} sm={6} md={4} key={field.name}>
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={isChecked}
                                  onChange={() => handleFieldPermissionToggle(permSelectedRole, permSelectedModule, field.name)}
                                  sx={{ '&.Mui-checked': { color: '#2563EB' } }}
                                />
                              }
                              label={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#1E293B' }}>{field.label}</Typography>
                                  <Typography variant="caption" sx={{ color: '#64748B' }}>API: {field.name}</Typography>
                                </Box>
                              }
                            />
                          </Grid>
                        );
                      })}
                    </Grid>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* TAB 4: GOOGLE SHEETS SYNC CONTROL */}
          {activeTab === 'sheets' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Row 1: Connection Config (Securely Decoupled) */}
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
                          sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' } }}
                        >
                          Save Connection Settings
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                </CardContent>
              </Card>

              {/* Row 2: Queue Metrics & Dashboard */}
              <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                <CardContent sx={{ p: 3 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                    <Box>
                      <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 0.5, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icons.RefreshCcw size={20} className="text-indigo-600 animate-spin-slow" /> Sync Queue Status
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#64748B' }}>
                        Live background sync worker logs, retries, and errors.
                      </Typography>
                    </Box>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={fetchSyncDashboard}
                      disabled={syncDashLoading}
                      startIcon={<Icons.RefreshCw size={14} />}
                      sx={{ borderColor: '#CBD5E1', color: '#0F172A', textTransform: 'none' }}
                    >
                      Refresh Queue
                    </Button>
                  </Box>

                  {/* Metrics Row */}
                  <Grid container spacing={2} sx={{ mb: 4 }}>
                    {[
                      { label: 'Pending', count: syncMetrics.PENDING, color: '#3B82F6', bg: '#EFF6FF' },
                      { label: 'Processing', count: syncMetrics.PROCESSING, color: '#F59E0B', bg: '#FEF3C7' },
                      { label: 'Successful', count: syncMetrics.SUCCESS, color: '#10B981', bg: '#ECFDF5' },
                      { label: 'Failed', count: syncMetrics.FAILED, color: '#EF4444', bg: '#FEF2F2' }
                    ].map(metric => (
                      <Grid item xs={6} md={3} key={metric.label}>
                        <Box sx={{ backgroundColor: metric.bg, border: `1px solid ${metric.color}22`, borderRadius: '12px', p: 2, textAlign: 'center' }}>
                          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, display: 'block', mb: 0.5 }}>{metric.label} Jobs</Typography>
                          <Typography variant="h4" sx={{ color: metric.color, fontWeight: 800 }}>{metric.count || 0}</Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>

                  {/* Sync Jobs Table */}
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Recent Queue Activities (Last 100)</Typography>
                  <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid #E2E8F0', borderRadius: '12px', maxHeight: '300px' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Job ID</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Module</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Record ID</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Operation</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Attempts</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Status</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Errors / Remarks</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700 }}>Last Synced</TableCell>
                          <TableCell sx={{ backgroundColor: '#F8FAFC', fontWeight: 700, textAlign: 'center' }}>Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {syncJobs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} align="center" sx={{ py: 3, color: '#64748B' }}>
                              Queue is clean. No active sync jobs found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          syncJobs.map(job => (
                            <TableRow key={job.id} hover>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: '12px' }}>{job.id}</TableCell>
                              <TableCell sx={{ textTransform: 'capitalize', fontWeight: 600 }}>{job.moduleName}</TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: '12px' }}>{job.crmRecordId}</TableCell>
                              <TableCell>
                                <Chip 
                                  label={job.operationType} 
                                  size="small" 
                                  sx={{ 
                                    fontWeight: 700, 
                                    fontSize: '10px',
                                    height: '20px',
                                    backgroundColor: job.operationType === 'DELETE' ? '#FEE2E2' : job.operationType === 'CREATE' ? '#D1FAE5' : '#FEF3C7',
                                    color: job.operationType === 'DELETE' ? '#991B1B' : job.operationType === 'CREATE' ? '#065F46' : '#92400E'
                                  }} 
                                />
                              </TableCell>
                              <TableCell>{job.attemptCount} / {job.maxAttempts}</TableCell>
                              <TableCell>
                                <Chip 
                                  label={job.status} 
                                  size="small" 
                                  sx={{ 
                                    fontWeight: 700, 
                                    fontSize: '10px',
                                    height: '20px',
                                    backgroundColor: job.status === 'SUCCESS' ? '#D1FAE5' : job.status === 'PROCESSING' ? '#FEF3C7' : job.status === 'PENDING' ? '#DBEAFE' : '#FEE2E2',
                                    color: job.status === 'SUCCESS' ? '#065F46' : job.status === 'PROCESSING' ? '#92400E' : job.status === 'PENDING' ? '#1E40AF' : '#991B1B'
                                  }} 
                                />
                              </TableCell>
                              <TableCell sx={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#EF4444', fontSize: '11px' }} title={job.lastError || ''}>
                                {job.lastError || '--'}
                              </TableCell>
                              <TableCell sx={{ fontSize: '11px', color: '#64748B' }}>
                                {job.syncedAt ? new Date(job.syncedAt).toLocaleString('en-IN') : '--'}
                              </TableCell>
                              <TableCell align="center">
                                {job.status === 'FAILED' && (
                                  <IconButton 
                                    size="small" 
                                    onClick={() => handleRetryJob(job.id)} 
                                    color="primary"
                                    title="Manual Retry Job"
                                  >
                                    <Icons.RotateCcw size={14} />
                                  </IconButton>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>

              {/* Row 3: Manual Sheet Import Reconciliation Workflow */}
              <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', boxShadow: 'none' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 1, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Icons.FileSpreadsheet size={20} className="text-emerald-600" /> Manual Sheets Reconciliation Import
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                    To protect CRM data, updates made manually inside Google Sheets are not automatically synced. Choose a module below to preview cell diffs, resolve validation conflicts, and import changes safely.
                  </Typography>

                  <Divider sx={{ mb: 3 }} />

                  <Box display="flex" alignItems="center" gap={2} mb={3}>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                      <InputLabel>Target Sync Module</InputLabel>
                      <Select
                        value={reconcileModule}
                        onChange={(e) => {
                          setReconcileModule(e.target.value);
                          setReconcilePreview(null);
                        }}
                        label="Target Sync Module"
                      >
                        <MenuItem value="leads">Leads</MenuItem>
                        <MenuItem value="customers">Customers</MenuItem>
                        <MenuItem value="properties">Properties</MenuItem>
                        <MenuItem value="deals">Deals</MenuItem>
                      </Select>
                    </FormControl>

                    <Button
                      variant="contained"
                      onClick={handleReconcilePreview}
                      disabled={reconcileLoading}
                      startIcon={<Icons.Eye size={16} />}
                      sx={{ backgroundColor: '#10B981', '&:hover': { backgroundColor: '#059669' } }}
                    >
                      {reconcileLoading ? 'Analyzing Sheet Rows...' : 'Analyze Sheets Diff'}
                    </Button>
                  </Box>

                  {reconcileMessage && (
                    <Alert severity="success" sx={{ mb: 3, borderRadius: '12px' }}>
                      {reconcileMessage}
                    </Alert>
                  )}

                  {/* Reconciliation Preview Area */}
                  {reconcilePreview !== null && (
                    <Box sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', p: 2, backgroundColor: '#F8FAFC' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Diff Preview Summary ({reconcilePreview.length} conflicting/unlinked rows detected)
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 2 }}>
                        Choose which rows from Google Sheets should overwrite your CRM database records. Unchecked rows will be ignored.
                      </Typography>

                      {reconcilePreview.length === 0 ? (
                        <Alert severity="info" sx={{ borderRadius: '8px' }}>
                          No conflicts or missing rows detected. Google Sheets row values match the CRM database identically.
                        </Alert>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
                          <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid #E2E8F0', borderRadius: '8px', maxAttributes: '350px' }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell padding="checkbox">
                                    <Checkbox
                                      indeterminate={selectedChanges.length > 0 && selectedChanges.length < reconcilePreview.length}
                                      checked={selectedChanges.length === reconcilePreview.length}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedChanges(reconcilePreview.map((_, i) => i));
                                        } else {
                                          setSelectedChanges([]);
                                        }
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>Record ID</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>Name / Title</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>Import Type</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>Change Log Details / Values</TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>Validation Status</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {reconcilePreview.map((change, idx) => (
                                  <TableRow key={idx} hover>
                                    <TableCell padding="checkbox">
                                      <Checkbox
                                        checked={selectedChanges.includes(idx)}
                                        disabled={!!change.validationError}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedChanges([...selectedChanges, idx]);
                                          } else {
                                            setSelectedChanges(selectedChanges.filter(i => i !== idx));
                                          }
                                        }}
                                      />
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '12px' }}>{change.crmRecordId}</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>{change.name}</TableCell>
                                    <TableCell>
                                      <Chip
                                        label={change.type}
                                        size="small"
                                        sx={{
                                          fontWeight: 700,
                                          fontSize: '9px',
                                          height: '18px',
                                          backgroundColor: change.type === 'CONFLICT' ? '#FEF3C7' : '#DBEAFE',
                                          color: change.type === 'CONFLICT' ? '#92400E' : '#1E40AF'
                                        }}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      {change.type === 'CONFLICT' ? (
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                          {change.conflicts.map((c, cidx) => (
                                            <Typography key={cidx} variant="caption" sx={{ display: 'block', fontSize: '11px' }}>
                                              <strong>{c.field}</strong>: <span style={{ color: '#EF4444' }}>CRM="{c.crmValue || 'null'}"</span> ➜ <span style={{ color: '#10B981' }}>Sheet="{c.sheetValue || 'null'}"</span>
                                            </Typography>
                                          ))}
                                        </Box>
                                      ) : (
                                        <Typography variant="caption" sx={{ color: '#64748B', fontSize: '11px' }}>
                                          New unlinked record found in sheet. Will import as new CRM record.
                                        </Typography>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {change.validationError ? (
                                        <Typography variant="caption" sx={{ color: '#EF4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Icons.AlertTriangle size={12} /> {change.validationError}
                                        </Typography>
                                      ) : (
                                        <Typography variant="caption" sx={{ color: '#10B981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                          <Icons.CheckCircle size={12} /> Ready
                                        </Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>

                          <Box display="flex" gap={2} mt={1}>
                            <Button
                              variant="contained"
                              onClick={handleConfirmReconcile}
                              disabled={selectedChanges.length === 0 || reconcileLoading}
                              startIcon={<Icons.Check size={16} />}
                              sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' } }}
                            >
                              Apply Selected Changes into CRM
                            </Button>
                            <Button
                              variant="outlined"
                              onClick={() => setReconcilePreview(null)}
                              sx={{ borderColor: '#CBD5E1', color: '#0F172A' }}
                            >
                              Cancel Import
                            </Button>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}

          {/* TAB 5: RESET PASSWORDS CONTROL */}
          {activeTab === 'passwords' && (
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 1, fontFamily: 'Poppins' }}>
                  Employee Password Management
                </Typography>
                <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                  Quickly set or reset the secure login password for any employee account.
                </Typography>

                <Divider sx={{ mb: 3 }} />

                <Box component="form" onSubmit={handleUpdatePassword} sx={{ maxWidth: 500 }}>
                  <Grid container spacing={3}>
                    <Grid item xs={12}>
                      <FormControl size="medium" fullWidth>
                        <InputLabel>Select Employee</InputLabel>
                        <Select
                          label="Select Employee"
                          value={passwordSelectedEmp}
                          onChange={(e) => setPasswordSelectedEmp(e.target.value)}
                        >
                          {(moduleData.employees || []).map(emp => (
                            <MenuItem key={emp.id} value={emp.id}>
                              {emp.name} ({emp.email} - {emp.role})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="New Login Password"
                        type="password"
                        fullWidth
                        size="medium"
                        value={newPasswordVal}
                        onChange={(e) => setNewPasswordVal(e.target.value)}
                        placeholder="Enter secure new password"
                        required
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="Confirm New Password"
                        type="password"
                        fullWidth
                        size="medium"
                        value={confirmPasswordVal}
                        onChange={(e) => setConfirmPasswordVal(e.target.value)}
                        placeholder="Confirm secure new password"
                        required
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Box sx={{ p: 2, bgcolor: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#475569', display: 'block', mb: 1 }}>
                          Password Complexity Requirements:
                        </Typography>
                        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: '#64748B' }}>
                          <li style={{ color: newPasswordVal.length >= 8 ? '#16A34A' : '#64748B', fontWeight: newPasswordVal.length >= 8 ? 700 : 400 }}>Minimum 8 characters</li>
                          <li style={{ color: /[A-Z]/.test(newPasswordVal) ? '#16A34A' : '#64748B', fontWeight: /[A-Z]/.test(newPasswordVal) ? 700 : 400 }}>At least one uppercase letter (A-Z)</li>
                          <li style={{ color: /[a-z]/.test(newPasswordVal) ? '#16A34A' : '#64748B', fontWeight: /[a-z]/.test(newPasswordVal) ? 700 : 400 }}>At least one lowercase letter (a-z)</li>
                          <li style={{ color: /\d/.test(newPasswordVal) ? '#16A34A' : '#64748B', fontWeight: /\d/.test(newPasswordVal) ? 700 : 400 }}>At least one number (0-9)</li>
                          <li style={{ color: /[^A-Za-z0-9]/.test(newPasswordVal) ? '#16A34A' : '#64748B', fontWeight: /[^A-Za-z0-9]/.test(newPasswordVal) ? 700 : 400 }}>At least one special character (e.g. @, #, $, !)</li>
                        </ul>
                      </Box>
                    </Grid>
                    <Grid item xs={12}>
                      <Button 
                        type="submit" 
                        variant="contained" 
                        sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' } }}
                      >
                        Update Login Password
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* TAB 6: AUTO LEAD ROTATION ENGINE */}
          {activeTab === 'rotation' && (
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: '20px', fontFamily: 'Poppins', mb: 1 }}>
                  Auto Lead Rotation Engine
                </Typography>
                <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                  Reassign leads automatically when assigned representatives do not record any follow-up actions within the specified timeframe.
                </Typography>
                
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={rotationActive}
                          onChange={(e) => setRotationActive(e.target.checked)}
                          color="primary"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Enable Automated Lead Rotation
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#64748B' }}>
                            Leads will cycle to other active sales representatives if they remain untouched.
                          </Typography>
                        </Box>
                      }
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Inactivity Reassignment Limit (Hours)"
                      type="number"
                      value={rotationHours}
                      onChange={(e) => setRotationHours(e.target.value)}
                      fullWidth
                      disabled={!rotationActive}
                      placeholder="e.g. 24"
                      InputProps={{ inputProps: { min: 0.1, step: 0.1 } }}
                      helperText="Leads untouched for this length of time will rotate round-robin to the next sales agent."
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                      Rotate Leads from these Sources:
                    </Typography>
                    <Grid container spacing={1}>
                      {(metadata.chips.leadSources || []).map(source => {
                        const isChecked = rotatedSources.includes(source.value);
                        return (
                          <Grid item xs={6} sm={4} key={source.value}>
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRotatedSources(prev => [...prev, source.value]);
                                    } else {
                                      setRotatedSources(prev => prev.filter(s => s !== source.value));
                                    }
                                  }}
                                  disabled={!rotationActive}
                                  color="primary"
                                />
                              }
                              label={source.label}
                            />
                          </Grid>
                        );
                      })}
                    </Grid>
                    <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 1 }}>
                      If no sources are checked, all lead sources will cycle by default.
                    </Typography>
                  </Grid>
                </Grid>

                <Divider sx={{ my: 3 }} />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSaveRotationSettings}
                    sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, borderRadius: '8px', px: 4, py: 1, textTransform: 'none', fontWeight: 700 }}
                  >
                    Save Rotation Settings
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* TAB 7: MESSAGE TEMPLATES CONFIG */}
          {activeTab === 'templates' && (
            <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: '20px', fontFamily: 'Poppins', mb: 1 }}>
                  Configure Message Templates
                </Typography>
                <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
                  Set up default message templates for client follow-ups. You can use placeholder tags like: <strong>[Client Name]</strong>, <strong>[Property Name]</strong>, <strong>[Price]</strong>, <strong>[Locality]</strong>, <strong>[Sector]</strong>.
                </Typography>
                
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <TextField
                      label="WhatsApp Notification Template"
                      multiline
                      rows={3}
                      value={whatsappTemplate}
                      onChange={(e) => setWhatsappTemplate(e.target.value)}
                      fullWidth
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Email Subject Template"
                      value={emailSubjectTemplate}
                      onChange={(e) => setEmailSubjectTemplate(e.target.value)}
                      fullWidth
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <TextField
                      label="Email Body Template"
                      multiline
                      rows={5}
                      value={emailBodyTemplate}
                      onChange={(e) => setEmailBodyTemplate(e.target.value)}
                      fullWidth
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <TextField
                      label="SMS Notification Template"
                      multiline
                      rows={2}
                      value={smsTemplate}
                      onChange={(e) => setSmsTemplate(e.target.value)}
                      fullWidth
                    />
                  </Grid>
                </Grid>

                <Divider sx={{ my: 3 }} />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSaveTemplates}
                    sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, borderRadius: '8px', px: 4, py: 1, textTransform: 'none', fontWeight: 700 }}
                  >
                    Save Templates
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

        </Grid>
      </Grid>
    </Box>
  );
};

export default Settings;
