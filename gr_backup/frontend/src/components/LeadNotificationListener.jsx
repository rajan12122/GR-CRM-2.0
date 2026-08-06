import React, { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogActions, Button, Typography, Box, Alert, Snackbar } from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { useApp, API_BASE_URL } from '../context/AppContext';

const LeadNotificationListener = () => {
  const { user, token } = useApp();
  const [activeLead, setActiveLead] = useState(null);
  const [ringDialogOpen, setRingDialogOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  const showToast = (msg) => {
    setToastMessage(msg);
    setToastOpen(true);
  };

  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Initialize ringtone audio
  useEffect(() => {
    // Telephone ring sound URL from public CDN
    audioRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/911/911-84.wav');
    audioRef.current.loop = true;

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const startRinging = (lead) => {
    setActiveLead(lead);
    setRingDialogOpen(true);
    
    // Play telephone ring
    if (audioRef.current) {
      audioRef.current.play().catch(err => console.log("Audio play failed:", err));
    }
  };

  const stopRinging = () => {
    setRingDialogOpen(false);
    setActiveLead(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  const handleAccept = async () => {
    if (!activeLead) return;
    try {
      await axios.post(`${API_BASE_URL}/leads/${activeLead.id}/accept`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      stopRinging();
      window.location.href = '/module/follow_ups'; // Redirect to followup page to show the accepted lead
    } catch (e) {
      console.error(e);
      stopRinging();
    }
  };

  const handleDrop = async (leadId) => {
    const id = leadId || activeLead?.id;
    if (!id) return;
    try {
      await axios.post(`${API_BASE_URL}/leads/${id}/drop`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      stopRinging();
    } catch (e) {
      console.error(e);
      stopRinging();
    }
  };

  // 1. Server-Sent Events listener for Instant Delivery
  useEffect(() => {
    if (!user || !token) return;

    const connectSSE = () => {
      const sseUrl = `${API_BASE_URL}/notifications/stream?userId=${user.id}`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.addEventListener('new-lead', (e) => {
        try {
          const data = JSON.parse(e.data);
          startRinging({ id: data.leadId, name: data.leadName });
        } catch (err) {
          console.error(err);
        }
      });

      es.addEventListener('new-property-matched', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`🎯 MATCH FOUND: ${data.message}`);
        } catch (err) { console.error(err); }
      });

      es.addEventListener('deal-closed-notif', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`🎉 DEAL CLOSED: ${data.message}`);
        } catch (err) { console.error(err); }
      });

      es.addEventListener('visit-assigned', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`🚗 VISIT ASSIGNED: ${data.message}`);
        } catch (err) { console.error(err); }
      });

      es.addEventListener('meeting-assigned', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`🤝 MEETING ASSIGNED: ${data.message}`);
        } catch (err) { console.error(err); }
      });

      es.addEventListener('query-approved', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`✅ QUERY APPROVED: ${data.message}`);
        } catch (err) { console.error(err); }
      });

      es.addEventListener('pending-docs-alert', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(`📄 DOCS UPLOADED: ${data.message}`);
        } catch (err) { console.error(err); }
      });

      es.onerror = () => {
        console.log("SSE disconnected, attempting reconnect...");
        es.close();
        setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [user, token]);

  // 2. Periodic Polling fallback (every 10s) in case SSE is blocked
  useEffect(() => {
    if (!user || !token || ringDialogOpen) return;

    const checkPendingLeads = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/leads/pending`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data && res.data.length > 0) {
          const lead = res.data[0];
          startRinging({ id: lead.id, name: lead.name || lead.person_name || 'New Lead' });
        }
      } catch (err) {
        console.error(err);
      }
    };

    const interval = setInterval(checkPendingLeads, 10000);
    return () => clearInterval(interval);
  }, [user, token, ringDialogOpen]);

  return (
    <>
      <Dialog 
        open={ringDialogOpen} 
        maxWidth="xs" 
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #334155',
            textAlign: 'center',
            p: 3
          }
        }}
      >
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <Box sx={{
            animation: 'pulse 1.5s infinite',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            p: 3,
            borderRadius: '50%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <Icons.PhoneCall size={48} color="#EF4444" />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, fontFamily: 'Poppins' }}>
            Incoming Lead Assignment!
          </Typography>
          <Typography variant="body1" sx={{ color: '#94A3B8', fontWeight: 600 }}>
            {activeLead?.name || 'New Lead Intake'} ({activeLead?.id})
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', gap: 2, mt: 1 }}>
          <Button 
            onClick={() => handleDrop()} 
            variant="outlined" 
            color="error"
            sx={{ textTransform: 'none', fontWeight: 700, px: 3, borderRadius: '8px' }}
          >
            Drop Lead
          </Button>
          <Button 
            onClick={handleAccept} 
            variant="contained" 
            color="success"
            sx={{ textTransform: 'none', fontWeight: 700, px: 3, borderRadius: '8px', backgroundColor: '#22C55E', '&:hover': { backgroundColor: '#16A34A' } }}
          >
            Accept Lead
          </Button>
        </DialogActions>
        <style>{`
          @keyframes pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.15); opacity: 0.8; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </Dialog>
      <Snackbar open={toastOpen} autoHideDuration={6000} onClose={() => setToastOpen(false)} message={toastMessage} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} />
    </>
  );
};

export default LeadNotificationListener;
