import React, { useState, useMemo } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  Paper, 
  TextField, 
  InputAdornment, 
  IconButton, 
  Button, 
  Menu, 
  MenuItem, 
  Checkbox, 
  FormControlLabel,
  TablePagination,
  Box,
  Typography,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormGroup,
  Select,
  FormControl,
  InputLabel
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp } from '../context/AppContext';
import EntityTooltip from './EntityTooltip';

const getSingularLabel = (label) => {
  if (!label) return '';
  if (label.toLowerCase() === 'queries') return 'Query';
  if (label.toLowerCase() === 'leaves') return 'Leave';
  if (label.toLowerCase() === 'attendance') return 'Attendance';
  if (label.endsWith('ies')) return label.slice(0, -3) + 'y';
  if (label.endsWith('s')) return label.slice(0, -1);
  return label;
};

const EntityChip = ({ moduleName, id, field, rowRecord, onClick }) => {
  const { moduleData } = useApp();
  
  let resolvedModule = moduleName;
  if (moduleName === 'customers' && String(id).startsWith('LEAD-')) {
    resolvedModule = 'leads';
  } else if (moduleName === 'customers' && String(id).startsWith('CUST-')) {
    resolvedModule = 'customers';
  }
  
  let resolvedName = '';
  let finalClickModule = resolvedModule;
  let finalClickId = id;
  
  // Custom logic for Deals: resolve to Dealer Firm Name or Contact Person Name
  if (field && field.name === 'sellerCustomerId' && rowRecord && rowRecord.propertyId) {
    const prop = (moduleData.properties || []).find(p => String(p.id) === String(rowRecord.propertyId));
    if (prop) {
      if (prop.dealer_owner_booked === 'Dealer') {
        const dealer = (moduleData.dealers || []).find(d => String(d.id) === String(prop.dealerId));
        if (dealer) {
          resolvedName = dealer.firm_name || dealer.name || dealer.id;
          finalClickModule = 'dealers';
          finalClickId = prop.dealerId;
        } else {
          resolvedName = 'Dealer N/A';
        }
      } else {
        resolvedName = prop.contact_person_name || 'Direct Owner';
      }
    }
  }
  
  if (!resolvedName) {
    const list = moduleData[resolvedModule] || [];
    const record = list.find(r => String(r.id) === String(id));
    if (record) {
      if (resolvedModule === 'properties') {
        resolvedName = `${record.locality || ''} ${record.sector_block ? `(Sec ${record.sector_block})` : ''} ${record.propertyType || ''} (${record.id})`;
      } else {
        resolvedName = record.propertyName || record.name || record.title || record.firm_name || record.person_name || record.id || 'Unnamed';
      }
    } else {
      resolvedName = id;
    }
  }
  
  return (
    <Tooltip title={`${getSingularLabel(finalClickModule).toUpperCase()}: ${resolvedName}`} arrow placement="top">
      <Chip 
        label={resolvedName} 
        size="small"
        onClick={(e) => { e.stopPropagation(); onClick(finalClickModule, finalClickId); }}
        sx={{ 
          cursor: 'pointer', 
          borderRadius: '6px', 
          fontWeight: 700, 
          fontSize: '11px',
          color: '#2563EB',
          backgroundColor: 'rgba(37,99,235,0.08)',
          border: '1px solid rgba(37,99,235,0.2)',
          '&:hover': {
            backgroundColor: 'rgba(37,99,235,0.15)',
            textDecoration: 'underline'
          }
        }}
      />
    </Tooltip>
  );
};

const DynamicTable = ({ 
  moduleKey, 
  records, // Pre-filtered and pre-sorted records!
  fields, 
  visibleColumns,
  setVisibleColumns,
  selectedRows,
  setSelectedRows,
  sortField,
  sortDirection,
  handleSortRequest,
  colMenuOpen,
  setColMenuOpen,
  onEditClick, 
  onDeleteClick, 
  onInspectClick,
  onLogCallClick
}) => {
  const { user, metadata, moduleData, updateRecord } = useApp();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const permittedFields = useMemo(() => {
    return fields.filter(f => {
      if (moduleKey === 'leads' && (f.name === 'assignmentStatus' || f.name === 'assignmentTime' || f.name === 'droppedBy')) {
        return false;
      }
      if (!user || user.role === 'Admin') return true;
      if (metadata?.userColumnPermissions?.[user.id]?.[moduleKey]) {
        const userOverriden = metadata.userColumnPermissions[user.id][moduleKey][f.name];
        if (userOverriden !== undefined) {
          return userOverriden.includes('view');
        }
      }
      if (metadata?.fieldPermissions?.[user.role]?.[moduleKey]) {
        return metadata.fieldPermissions[user.role][moduleKey].includes(f.name);
      }
      return true;
    });
  }, [fields, user, metadata, moduleKey]);

  // Paginated records based on pre-sorted pre-filtered records
  const paginatedRecords = useMemo(() => {
    const start = page * rowsPerPage;
    return records.slice(start, start + rowsPerPage);
  }, [records, page, rowsPerPage]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Selection handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedRows(paginatedRecords.map(r => r.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id) => {
    if (selectedRows.includes(id)) {
      setSelectedRows(prev => prev.filter(r => r !== id));
    } else {
      setSelectedRows(prev => [...prev, id]);
    }
  };

  // Render chip for status or ref value
  const renderCellContent = (rec, field) => {
    const val = rec[field.name];

    if (moduleKey === 'dealers' && field.name === 'assignedEmployeeId') {
      const employees = moduleData.employees || [];
      return (
        <FormControl size="small" fullWidth sx={{ minWidth: '150px' }} onClick={(e) => e.stopPropagation()}>
          <Select
            value={val || ''}
            onChange={async (e) => {
              const selectedVal = e.target.value;
              const payload = {
                ...rec,
                assignedEmployeeId: selectedVal || ''
              };
              const res = await updateRecord('dealers', rec.id, payload);
              if (!res.success) {
                alert(res.message || "Failed to assign employee");
              }
            }}
            displayEmpty
            sx={{ 
              fontSize: '12px', 
              fontWeight: 700,
              backgroundColor: 'white',
              borderRadius: '8px'
            }}
          >
            <MenuItem value=""><em>Unassigned</em></MenuItem>
            {employees.map(emp => (
              <MenuItem key={emp.id} value={emp.id} sx={{ fontSize: '12px' }}>
                {emp.name} ({emp.id})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (val === undefined || val === null) return '';

    if (field.name === 'id') {
      return (
        <Typography 
          variant="body2" 
          onClick={(e) => { e.stopPropagation(); onInspectClick(moduleKey, val); }}
          sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, display: 'inline' }}
        >
          {val}
        </Typography>
      );
    }
    if (field.name === 'name' || field.name === 'person_name' || field.name === 'firm_name') {
      return (
        <Typography 
          variant="body2" 
          onClick={(e) => { e.stopPropagation(); onInspectClick(moduleKey, rec.id); }}
          sx={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, display: 'inline' }}
        >
          {val}
        </Typography>
      );
    }

    if (field.name === 'pipelineAction') {
      const allChips = [
        ...(metadata?.chips?.customerStages || []),
        ...(metadata?.chips?.buyerQueryStages || [])
      ];
      const chipConfig = allChips.find(c => c.value === val);
      return (
        <Chip 
          label={chipConfig?.label || val} 
          size="small"
          sx={{ 
            backgroundColor: chipConfig?.color ? `${chipConfig.color}15` : '#F1F5F9',
            color: chipConfig?.color || '#475569',
            border: `1px solid ${chipConfig?.color ? `${chipConfig.color}30` : '#E2E8F0'}`,
            fontWeight: 600,
            fontSize: '11px',
            borderRadius: '6px'
          }}
        />
      );
    }

    // If it's a chip dropdown option, look up color in metadata
    if (field.type === 'select' && field.chipGroup && metadata?.chips[field.chipGroup]) {
      const chipConfig = metadata.chips[field.chipGroup].find(c => c.value === val);
      return (
        <Chip 
          label={chipConfig?.label || val} 
          size="small"
          sx={{ 
            backgroundColor: chipConfig?.color ? `${chipConfig.color}15` : '#F1F5F9',
            color: chipConfig?.color || '#475569',
            border: `1px solid ${chipConfig?.color ? `${chipConfig.color}30` : '#E2E8F0'}`,
            fontWeight: 600,
            fontSize: '11px',
            borderRadius: '6px'
          }}
        />
      );
    }

    if (field.type === 'ref' || field.name === 'referrer_id') {
      if (!val) return '---';
      let resolvedModule = field.refModule;
      if (field.name === 'referrer_id') {
        if (String(val).startsWith('EMP-')) resolvedModule = 'employees';
        else if (String(val).startsWith('CUST-')) resolvedModule = 'customers';
        else if (String(val).startsWith('LEAD-')) resolvedModule = 'leads';
        else resolvedModule = 'employees';
      }
      return (
        <EntityChip 
          moduleName={resolvedModule} 
          id={val} 
          field={field}
          rowRecord={rec}
          onClick={(actualModule, actualId) => onInspectClick(actualModule || resolvedModule, actualId || val)} 
        />
      );
    }

    if (field.type === 'multiref') {
      const items = String(val).split(',').filter(Boolean);
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {items.map(itemId => (
            <EntityChip 
              key={itemId}
              moduleName={field.refModule} 
              id={itemId} 
              field={field}
              rowRecord={rec}
              onClick={(actualModule, actualId) => onInspectClick(actualModule || field.refModule, actualId || itemId)} 
            />
          ))}
        </Box>
      );
    }

    if (field.type === 'multiselect_text') {
      const items = String(val || '').split(',').map(s => s.trim()).filter(Boolean);
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {items.map((item, idx) => (
            <Chip key={idx} label={item} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
          ))}
        </Box>
      );
    }

    const currencyFields = [
      'price', 'budget', 'salary', 'salePrice', 'netPay', 'baseSalary', 'dailyRate',
      'leaveDeduction', 'halfDayDeduction', 'overtimePayment', 'allowancesTotal',
      'deductionsTotal', 'expensesReimbursement', 'advanceRecovery', 'advanceBalance',
      'advanceTaken'
    ];
    if (currencyFields.includes(field.name)) {
      if (val === undefined || val === null || val === '') return '';
      const str = String(val).trim();
      if (/[a-zA-Z]/.test(str)) {
        return str;
      }
      const num = Number(str.replace(/,/g, ''));
      if (isNaN(num)) return str;
      return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }

    if (field.type === 'date' || field.name.toLowerCase().includes('date')) {
      if (!val) return '';
      const dateStr = String(val);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2];
        return `${d}/${m}/${y}`;
      }
      const spaceParts = dateStr.split(' ');
      if (spaceParts.length >= 1) {
        const datePart = spaceParts[0];
        const slashParts = datePart.split('/');
        if (slashParts.length === 3) {
          const d = slashParts[0].padStart(2, '0');
          const m = slashParts[1].padStart(2, '0');
          const y = slashParts[2];
          const timePart = spaceParts.slice(1).join(' ');
          return timePart ? `${d}/${m}/${y} ${timePart}` : `${d}/${m}/${y}`;
        }
      }
    }

    return String(val);
  };

  return (
    <Box sx={{ width: '100%' }}>
      
      {/* Grid Table Container */}
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid #E2E8F0', borderRadius: 0, overflowX: 'auto', maxWidth: '100%' }}>
        <Table stickyHeader size="medium">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox 
                  indeterminate={selectedRows.length > 0 && selectedRows.length < paginatedRecords.length}
                  checked={paginatedRecords.length > 0 && selectedRows.length === paginatedRecords.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
              
              {permittedFields.map(f => {
                if (!visibleColumns[f.name]) return null;
                return (
                  <TableCell 
                    key={f.name}
                    onClick={() => handleSortRequest(f.name)}
                    sx={{ cursor: 'pointer', select: 'none', whiteSpace: 'nowrap' }}
                  >
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {f.label}
                      {sortField === f.name ? (
                        sortDirection === 'asc' ? <Icons.ArrowUp size={14} /> : <Icons.ArrowDown size={14} />
                      ) : (
                        <Icons.ArrowUpDown size={12} color="#94A3B8" />
                      )}
                    </Box>
                  </TableCell>
                );
              })}
              
              <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={permittedFields.length + 2} align="center" sx={{ py: 6, color: '#64748B' }}>
                  <Icons.FolderOpen size={36} style={{ marginBottom: 8, opacity: 0.5 }} />
                  <Typography variant="body2">No matching records found in database.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedRecords.map((rec) => (
                <TableRow 
                   key={rec.id}
                   hover
                   selected={selectedRows.includes(rec.id)}
                >
                  <TableCell padding="checkbox">
                    <Checkbox 
                      checked={selectedRows.includes(rec.id)}
                      onChange={() => handleSelectRow(rec.id)}
                    />
                  </TableCell>

                  {permittedFields.map(f => {
                    if (!visibleColumns[f.name]) return null;
                    return (
                      <TableCell key={f.name} sx={{ whiteSpace: 'nowrap' }}>
                        {renderCellContent(rec, f)}
                      </TableCell>
                    );
                  })}

                  <TableCell align="right">
                    <Box display="flex" justifyContent="flex-end" gap={0.5}>
                      {(moduleKey === 'leads' || moduleKey === 'customers') && (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {rec.phone && (
                            <Tooltip title="One-Click WhatsApp Outreach">
                              <IconButton 
                                size="small" 
                                href={`https://wa.me/91${rec.phone}?text=${encodeURIComponent(`Hi ${rec.name || ''}, this is Gagan Realtech following up.`)}`}
                                target="_blank"
                                sx={{ color: '#22C55E' }}
                              >
                                <Icons.MessageCircle size={16} />
                              </IconButton>
                            </Tooltip>
                          )}
                          {rec.email && (
                            <Tooltip title="One-Click Email Outreach">
                              <IconButton 
                                size="small" 
                                href={`mailto:${rec.email}?subject=${encodeURIComponent("Gagan Realtech Follow-up")}&body=${encodeURIComponent(`Hi ${rec.name || ''},\n\nThis is Gagan Realtech following up on your requirements.\n\nBest regards,\nGagan Realtech Team`)}`}
                                sx={{ color: '#3B82F6' }}
                              >
                                <Icons.Mail size={16} />
                              </IconButton>
                            </Tooltip>
                          )}
                          {rec.phone && (
                            <Tooltip title="One-Click SMS Outreach">
                              <IconButton 
                                size="small" 
                                href={`sms:91${rec.phone}?body=${encodeURIComponent(`Hi ${rec.name || ''}, this is Gagan Realtech following up.`)}`}
                                sx={{ color: '#F59E0B' }}
                              >
                                <Icons.Smartphone size={16} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      )}
                      {moduleKey === 'dealers' && onLogCallClick && (
                        <Tooltip title="Log Outreach Call">
                          <IconButton size="small" onClick={() => onLogCallClick(rec)} sx={{ color: '#10B981' }}>
                            <Icons.PhoneCall size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onInspectClick && (
                        <Tooltip title="Inspect 360 View">
                          <IconButton size="small" onClick={() => onInspectClick(moduleKey, rec.id)} sx={{ color: '#2563EB' }}>
                            <Icons.SearchCode size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onEditClick && (
                        <Tooltip title="Edit Record">
                          <IconButton size="small" onClick={() => onEditClick(rec)} sx={{ color: '#F59E0B' }}>
                            <Icons.Edit2 size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onDeleteClick && (
                        <Tooltip title="Delete Record">
                          <IconButton size="small" onClick={() => onDeleteClick(rec.id)} sx={{ color: '#EF4444' }}>
                            <Icons.Trash2 size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination Footer */}
      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={records.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        sx={{ borderTop: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
      />

      {/* Dynamic Columns Configuration Dialog */}
      <Dialog open={colMenuOpen} onClose={() => setColMenuOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, fontFamily: 'Poppins' }}>Configure Display Columns</DialogTitle>
        <DialogContent>
          <FormGroup sx={{ mt: 1 }}>
            {permittedFields.map(f => (
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

    </Box>
  );
};

export default DynamicTable;
