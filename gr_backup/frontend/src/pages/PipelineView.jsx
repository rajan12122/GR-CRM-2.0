import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  CircularProgress,
  Alert
} from '@mui/material';
import { useApp } from '../context/AppContext';
import KanbanBoard from '../components/KanbanBoard';

const PipelineView = () => {
  const { pipelineType } = useParams(); // 'properties' or 'customers'
  const navigate = useNavigate();
  const { 
    metadata, 
    moduleData, 
    fetchModuleData, 
    updateRecord, 
    loadingData 
  } = useApp();

  useEffect(() => {
    if (metadata) {
      const moduleToFetch = (pipelineType === 'buyer_query' || pipelineType === 'customers') ? 'follow_ups' : (pipelineType === 'seller_query' ? 'queries' : (pipelineType === 'property_pitches' ? 'property_pitch_history' : pipelineType));
      fetchModuleData(moduleToFetch);
    }
  }, [pipelineType, metadata]);

  if (!metadata) return null;

  // Determine configuration based on pipelineType
  let targetModule = '';
  let stageField = '';
  let stages = [];
  let title = '';
  let subtitle = '';

  if (pipelineType === 'properties') {
    targetModule = 'properties';
    stageField = 'status';
    stages = metadata.chips.propertyStatus || [];
    title = 'Property Pipeline';
    subtitle = 'Track inventory status updates (Available, Booked, Agreement, Sold) in real time.';
  } else if (pipelineType === 'property_pitches') {
    targetModule = 'property_pitch_history';
    stageField = 'status';
    stages = metadata.chips.pitchStatus || [];
    title = 'Property Interest Pipeline';
    subtitle = 'Track prospective client interest stages for pitched property listings.';
  } else if (pipelineType === 'customers') {
    targetModule = 'follow_ups';
    stageField = 'pipelineAction';
    stages = [
      { value: 'None', label: 'Fresh Lead / Scheduled', color: '#3B82F6' },
      ...(metadata?.chips?.customerStages || [])
    ];
    title = 'Client Deal Nurturing Pipeline';
    subtitle = 'Track customer pathways from fresh leads to negotiation and booking closeouts.';
  } else if (pipelineType === 'buyer_query') {
    targetModule = 'follow_ups';
    stageField = 'pipelineAction';
    stages = [
      { value: 'None', label: 'New Query / Scheduled', color: '#3B82F6' },
      ...(metadata?.chips?.customerStages || [])
    ];
    title = 'Buyer Query Pipeline';
    subtitle = 'Track prospective buyer query progression from Verified to Closed.';
  } else if (pipelineType === 'seller_query') {
    targetModule = 'queries';
    stageField = 'stage';
    stages = metadata.chips.sellerQueryStages || [];
    title = 'Seller Query Pipeline';
    subtitle = 'Track seller property listings from inspection to sale readiness.';
  } else {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Invalid pipeline parameter '{pipelineType}'.</Alert>
      </Box>
    );
  }

  let records = [];
  if (pipelineType === 'customers') {
    records = (moduleData.follow_ups || [])
      .filter(f => {
        const isClient = (String(f.customerId).startsWith('LEAD-') || String(f.customerId).startsWith('CUST-')) && !f.queryId;
        if (!isClient) return false;
        
        // Exclude seller followups from the client deal nurturing pipeline
        const lead = (moduleData.leads || []).find(l => String(l.id) === String(f.customerId));
        if (lead && lead.leadType === 'Seller') return false;
        
        const cust = (moduleData.customers || []).find(c => String(c.id) === String(f.customerId));
        if (cust) {
          const assocLead = (moduleData.leads || []).find(l => String(l.id) === String(cust.leadId));
          if (assocLead && assocLead.leadType === 'Seller') return false;
          if (cust.stage === 'Active Seller' || cust.stage === 'Converted Seller') return false;
        }
        return true;
      })
      .map(f => ({
        ...f,
        pipelineAction: f.pipelineAction || 'None'
      }));
  } else if (pipelineType === 'buyer_query') {
    records = (moduleData.follow_ups || [])
      .filter(f => !!f.queryId || String(f.remarks).toLowerCase().includes('query'))
      .map(f => ({
        ...f,
        pipelineAction: f.pipelineAction || 'None'
      }));
  } else if (pipelineType === 'seller_query') {
    records = (moduleData.queries || []).filter(rec => rec.queryType === 'Sell Property');
  } else {
    records = (moduleData[targetModule] || []);
  }

  const handleCardMove = async (cardId, targetStageValue) => {
    const allRecords = moduleData[targetModule] || [];
    const record = allRecords.find(r => r.id === cardId);
    if (!record) return;

    const dbValue = targetStageValue === 'None' ? 'None' : targetStageValue;
    const payload = { ...record, [stageField]: dbValue };
    await updateRecord(targetModule, cardId, payload);
  };

  const handleInspectClick = (id) => {
    navigate(`/module/${targetModule}/${id}`);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Title Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '26px', color: '#0F172A', fontFamily: 'Poppins' }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B' }}>
          {subtitle} Drag cards left/right to modify stages instantly.
        </Typography>
      </Box>

      {/* Kanban Board mounting */}
      {loadingData && records.length === 0 ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <KanbanBoard 
          records={records}
          stages={stages}
          stageField={stageField}
          onCardMove={handleCardMove}
          onInspectClick={handleInspectClick}
        />
      )}
    </Box>
  );
};

export default PipelineView;
