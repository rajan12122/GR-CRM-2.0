import React, { useState } from 'react';
import { 
  Box, 
  Paper, 
  Typography, 
  Card, 
  CardContent, 
  IconButton,
  Chip,
  Tooltip
} from '@mui/material';
import EntityTooltip from './EntityTooltip';
import * as Icons from 'lucide-react';
import { useApp } from '../context/AppContext';

const KanbanBoard = ({ 
  records, 
  stages, 
  stageField, 
  onCardMove, 
  onInspectClick 
}) => {
  const { moduleData } = useApp();
  const [draggedItem, setDraggedItem] = useState(null);

  const handleDragStart = (item) => {
    setDraggedItem(item);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (targetStageValue) => {
    if (draggedItem && draggedItem[stageField] !== targetStageValue) {
      onCardMove(draggedItem.id, targetStageValue);
    }
    setDraggedItem(null);
  };

  // Group records by stage
  const recordsByStage = stages.reduce((acc, stage) => {
    acc[stage.value] = records.filter(r => r[stageField] === stage.value);
    return acc;
  }, {});

  return (
    <Box sx={{ 
      display: 'flex', 
      gap: 2.5, 
      overflowX: 'auto', 
      pb: 3, 
      pt: 1, 
      height: 'calc(80vh - 120px)',
      '&::-webkit-scrollbar': { height: '8px' },
      '&::-webkit-scrollbar-thumb': { backgroundColor: '#CBD5E1', borderRadius: '8px' }
    }}>
      {stages.map(stage => {
        const columnRecords = recordsByStage[stage.value] || [];
        return (
          <Box
            key={stage.value}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(stage.value)}
            sx={{
              flex: '0 0 300px',
              backgroundColor: '#F1F5F9', // Light slate column
              borderRadius: '16px',
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '100%',
              border: '1px solid #E2E8F0'
            }}
          >
            {/* Column Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: stage.color || '#64748B' }} />
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#0F172A' }}>
                  {stage.label}
                </Typography>
              </Box>
              <Chip 
                label={columnRecords.length} 
                size="small" 
                sx={{ 
                  backgroundColor: '#FFFFFF', 
                  border: '1px solid #E2E8F0', 
                  fontWeight: 700, 
                  fontSize: '11px',
                  height: 20
                }} 
              />
            </Box>

            {/* Cards Area */}
            <Box sx={{ 
              flex: 1, 
              overflowY: 'auto', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 1.5,
              '&::-webkit-scrollbar': { width: '4px' },
              '&::-webkit-scrollbar-thumb': { backgroundColor: '#CBD5E1', borderRadius: '4px' }
            }}>
              {columnRecords.length === 0 ? (
                <Box sx={{ 
                  border: '2px dashed #CBD5E1', 
                  borderRadius: '12px', 
                  py: 4, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: '#94A3B8'
                }}>
                  <Typography variant="caption" sx={{ fontWeight: 500 }}>
                    Drop cards here
                  </Typography>
                </Box>
              ) : (
                columnRecords.map(item => {
                  let cardTitle = item.name || item.title || item.id;
                  let cardSubtitle = item.id;
                  let detailsText = '';
                  let pitchedBadge = null;

                  if (String(item.id).startsWith('QRY-')) {
                    const cust = (moduleData.customers || []).find(c => String(c.id) === String(item.customerId)) || 
                                 (moduleData.leads || []).find(l => String(l.id) === String(item.customerId));
                    const custName = cust ? (cust.name || cust.person_name) : `Client: ${item.customerId}`;
                    cardTitle = `${custName} (${item.id})`;
                    cardSubtitle = `${item.queryType || 'Property Query'}`;
                    
                    const propertyTypeName = item.propertyType || item.r_c_i || 'Property';
                    const localityName = item.locality || '';
                    const sectorName = item.sector_block ? `Sec ${item.sector_block}` : '';
                    detailsText = `${propertyTypeName} in ${[localityName, sectorName].filter(Boolean).join(', ')}`;
                    
                    if (item.pitchedPropertyId) {
                      pitchedBadge = (
                        <Chip 
                          label={`Pitched: ${item.pitchedPropertyId}`} 
                          size="small" 
                          color="primary" 
                          variant="outlined" 
                          sx={{ height: 18, fontSize: '9px', fontWeight: 700, borderRadius: '4px', mt: 1 }} 
                        />
                      );
                    }
                  } else if (String(item.id).startsWith('PROP-')) {
                    cardTitle = `${item.locality} ${item.sector_block ? `Sec ${item.sector_block}` : ''}`;
                    cardSubtitle = `${item.propertyType || 'Listing'} - ${item.id}`;
                    detailsText = item.contact_person_name ? `Owner/Contact: ${item.contact_person_name}` : '';
                  } else if (String(item.id).startsWith('CUST-')) {
                    cardTitle = item.name || item.id;
                    cardSubtitle = item.id;
                    detailsText = item.requirements || '';
                  } else if (String(item.id).startsWith('PITCH-')) {
                    const cust = (moduleData.customers || []).find(c => String(c.id) === String(item.customerId)) || 
                                 (moduleData.leads || []).find(l => String(l.id) === String(item.customerId));
                    const custName = cust ? (cust.name || cust.person_name) : (item.customerName || `Client: ${item.customerId}`);
                    cardTitle = `${custName} (${item.id})`;
                    cardSubtitle = `Pitched Property Pipeline`;
                    
                    const prop = (moduleData.properties || []).find(p => String(p.id) === String(item.propertyId));
                    if (prop) {
                      detailsText = `Pitched Property: ${prop.locality} ${prop.sector_block ? `Sec ${prop.sector_block}` : ''} (${prop.id})`;
                    } else {
                      detailsText = `Pitched Property ID: ${item.propertyId}`;
                    }
                  } else if (String(item.id).startsWith('FOLLOW-')) {
                    const cust = (moduleData.customers || []).find(c => String(c.id) === String(item.customerId)) || 
                                 (moduleData.leads || []).find(l => String(l.id) === String(item.customerId));
                    const custName = cust ? (cust.name || cust.person_name) : `Client: ${item.customerId}`;
                    cardTitle = `${custName} (${item.id})`;
                    cardSubtitle = `Scheduled: ${item.date} ${item.time ? `• ${item.time}` : ''}`;
                    detailsText = item.remarks || '';
                    if (item.queryId) {
                      pitchedBadge = (
                        <Chip 
                          label={`Query: ${item.queryId}`} 
                          size="small" 
                          color="secondary" 
                          variant="outlined" 
                          sx={{ height: 18, fontSize: '9px', fontWeight: 700, borderRadius: '4px', mt: 1 }} 
                        />
                      );
                    }
                  }

                  return (
                    <Card
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(item)}
                      sx={{
                        cursor: 'grab',
                        '&:active': { cursor: 'grabbing' },
                        border: '1px solid #E2E8F0',
                        boxShadow: '0 2px 4px rgba(15,23,42,0.02)',
                        '&:hover': {
                          boxShadow: '0 8px 16px rgba(15,23,42,0.06)'
                        }
                      }}
                    >
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={0.5}>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>
                            {cardTitle}
                          </Typography>
                          <IconButton 
                            size="small" 
                            onClick={() => onInspectClick(item.id)}
                            sx={{ p: 0, color: '#2563EB' }}
                          >
                            <Icons.Eye size={16} />
                          </IconButton>
                        </Box>
                        
                        <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1 }}>
                          {cardSubtitle}
                        </Typography>

                        {detailsText && (
                          <Typography variant="body2" sx={{ color: '#475569', fontSize: '12px', mb: 1.5, fontWeight: 500 }}>
                            {detailsText}
                          </Typography>
                        )}

                        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={0.5}>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: '#0F172A' }}>
                            {item.quotedPrice ? `Offered: ₹${item.quotedPrice}` : item.demand ? `₹${item.demand}` : item.price ? `₹${(item.price/100000).toFixed(1)} Lacs` : item.budget ? `Budget: ₹${item.budget}` : ''}
                          </Typography>
                          {item.assignedEmployeeId && (
                            <EntityTooltip moduleName="employees" id={item.assignedEmployeeId}>
                              <Chip 
                                label={`RM: ${item.assignedEmployeeId}`} 
                                size="small" 
                                sx={{ height: 18, fontSize: '9px', fontWeight: 600, borderRadius: '4px', cursor: 'help' }} 
                              />
                            </EntityTooltip>
                          )}
                        </Box>
                        {pitchedBadge}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default KanbanBoard;
