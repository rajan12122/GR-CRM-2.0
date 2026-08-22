import React from 'react';
import { Tooltip } from '@mui/material';
import { useApp } from '../context/AppContext';

const getSingularLabel = (label) => {
  if (!label) return '';
  if (label.toLowerCase() === 'queries') return 'Query';
  if (label.toLowerCase() === 'leaves') return 'Leave';
  if (label.toLowerCase() === 'attendance') return 'Attendance';
  if (label.endsWith('ies')) return label.slice(0, -3) + 'y';
  if (label.endsWith('s')) return label.slice(0, -1);
  return label;
};

const EntityTooltip = ({ moduleName, id, children }) => {
  const { moduleData } = useApp();
  if (!id) return children;
  
  let resolvedModule = moduleName;
  if (moduleName === 'customers' || !moduleName) {
    if (String(id).startsWith('LEAD-')) resolvedModule = 'leads';
    else if (String(id).startsWith('CUST-')) resolvedModule = 'customers';
    else if (String(id).startsWith('QRY-') || String(id).startsWith('QUERY-')) resolvedModule = 'queries';
  }

  const list = moduleData[resolvedModule] || [];
  const record = list.find(r => String(r.id) === String(id));
  const resolvedName = record 
    ? (record.name || record.title || record.firm_name || record.person_name || record.id || 'Unnamed') 
    : `ID: ${id}`;
  
  return (
    <Tooltip title={`${getSingularLabel(resolvedModule).toUpperCase()}: ${resolvedName}`} arrow placement="top">
      <span style={{ cursor: 'help' }}>{children}</span>
    </Tooltip>
  );
};

export default EntityTooltip;
