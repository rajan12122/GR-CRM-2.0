import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Drawer, 
  IconButton, 
  Typography, 
  TextField, 
  Button, 
  Avatar, 
  Paper, 
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
  Tooltip,
  Chip
} from '@mui/material';
import * as Icons from 'lucide-react';
import { useApp, API_BASE_URL } from '../context/AppContext';

export default function AIAssistantDrawer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I am your Gagan Realtech AI Copilot. How can I help you manage your sales, properties, or leads today?' }
  ]);

  // Draggable positioning state
  const [position, setPosition] = useState({ bottom: 24, right: 24 });
  const dragRef = useRef({ isDragging: false, hasDragged: false, startX: 0, startY: 0, startBottom: 24, startRight: 24 });

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only drag on left click
    dragRef.current = {
      isDragging: true,
      hasDragged: false,
      startX: e.clientX,
      startY: e.clientY,
      startBottom: position.bottom,
      startRight: position.right
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;
    
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      dragRef.current.hasDragged = true;
    }
    
    const nextBottom = Math.max(10, Math.min(window.innerHeight - 70, dragRef.current.startBottom - deltaY));
    const nextRight = Math.max(10, Math.min(window.innerWidth - 70, dragRef.current.startRight - deltaX));
    
    setPosition({ bottom: nextBottom, right: nextRight });
  };

  const handleMouseUp = () => {
    dragRef.current.isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    dragRef.current = {
      isDragging: true,
      hasDragged: false,
      startX: touch.clientX,
      startY: touch.clientY,
      startBottom: position.bottom,
      startRight: position.right
    };
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  const handleTouchMove = (e) => {
    if (!dragRef.current.isDragging || e.touches.length === 0) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragRef.current.startX;
    const deltaY = touch.clientY - dragRef.current.startY;
    
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      dragRef.current.hasDragged = true;
    }
    
    const nextBottom = Math.max(10, Math.min(window.innerHeight - 70, dragRef.current.startBottom - deltaY));
    const nextRight = Math.max(10, Math.min(window.innerWidth - 70, dragRef.current.startRight - deltaX));
    
    setPosition({ bottom: nextBottom, right: nextRight });
  };

  const handleTouchEnd = () => {
    dragRef.current.isDragging = false;
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [position]);

  const renderMessageContent = (text, isUser) => {
    if (isUser) {
      return (
        <Typography variant="body2" sx={{ lineHeight: 1.6, whiteSpace: 'pre-wrap', fontWeight: 500, fontSize: '13px' }}>
          {text}
        </Typography>
      );
    }

    // Matches [Label](file:///module/...)
    const regex = /\[([^\]]+)\]\((file:\/\/\/[^\)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const startIndex = match.index;
      if (startIndex > lastIndex) {
        parts.push(text.substring(lastIndex, startIndex));
      }
      const label = match[1];
      const url = match[2];
      const targetPath = url.replace('file://', '');

      // Select dynamic icon based on action label
      let IconComponent = Icons.ExternalLink;
      const lblLower = label.toLowerCase();
      if (lblLower.includes('profile') || lblLower.includes('open')) IconComponent = Icons.Eye;
      else if (lblLower.includes('attendance')) IconComponent = Icons.Clock;
      else if (lblLower.includes('payroll') || lblLower.includes('salary')) IconComponent = Icons.CreditCard;
      else if (lblLower.includes('leave')) IconComponent = Icons.Calendar;
      else if (lblLower.includes('leads') || lblLower.includes('lead')) IconComponent = Icons.Users;
      else if (lblLower.includes('customers') || lblLower.includes('customer') || lblLower.includes('employees') || lblLower.includes('employee')) IconComponent = Icons.UserCheck;
      else if (lblLower.includes('pitch') || lblLower.includes('pitches')) IconComponent = Icons.Send;
      else if (lblLower.includes('meeting')) IconComponent = Icons.CalendarDays;
      else if (lblLower.includes('performance')) IconComponent = Icons.TrendingUp;
      else if (lblLower.includes('properties') || lblLower.includes('property')) IconComponent = Icons.Home;
      else if (lblLower.includes('payment') || lblLower.includes('payments')) IconComponent = Icons.DollarSign;
      else if (lblLower.includes('document') || lblLower.includes('documents')) IconComponent = Icons.FileText;
      else if (lblLower.includes('timeline')) IconComponent = Icons.Activity;
      else if (lblLower.includes('follow-up') || lblLower.includes('follow up')) IconComponent = Icons.PhoneCall;
      else if (lblLower.includes('booking')) IconComponent = Icons.CheckCircle;
      else if (lblLower.includes('whatsapp')) IconComponent = Icons.MessageCircle;
      else if (lblLower.includes('call history') || lblLower.includes('call')) IconComponent = Icons.Phone;
      else if (lblLower.includes('project')) IconComponent = Icons.Building2;
      else if (lblLower.includes('builder')) IconComponent = Icons.Briefcase;
      else if (lblLower.includes('site visit') || lblLower.includes('site visits')) IconComponent = Icons.MapPin;

      parts.push(
        <Button
          key={startIndex}
          variant="outlined"
          size="small"
          onClick={() => {
            navigate(targetPath);
            setOpen(false);
          }}
          sx={{
            textTransform: 'none',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: '20px',
            padding: '3px 10px',
            margin: '3px 3px',
            backgroundColor: '#EFF6FF',
            color: '#1E40AF',
            borderColor: '#DBEAFE',
            '&:hover': {
              backgroundColor: '#DBEAFE',
              borderColor: '#BFDBFE',
            },
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            transition: 'all 0.15s ease-in-out'
          }}
        >
          <IconComponent size={12} />
          {label}
        </Button>
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return (
      <Box sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontWeight: 500, fontSize: '13px' }}>
        {parts.map((part, index) => {
          if (typeof part === 'string') {
            const boldRegex = /\*\*([^*]+)\*\*/g;
            const subParts = [];
            let subLastIndex = 0;
            let subMatch;
            while ((subMatch = boldRegex.exec(part)) !== null) {
              if (subMatch.index > subLastIndex) {
                subParts.push(part.substring(subLastIndex, subMatch.index));
              }
              subParts.push(
                <strong key={subMatch.index} style={{ fontWeight: 800, color: '#1E3A8A' }}>
                  {subMatch[1]}
                </strong>
              );
              subLastIndex = boldRegex.lastIndex;
            }
            if (subLastIndex < part.length) {
              subParts.push(part.substring(subLastIndex));
            }
            return <span key={index}>{subParts}</span>;
          }
          return part;
        })}
      </Box>
    );
  };
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef(null);
  
  const recognitionRef = useRef(null);

  // Auto scroll chat
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  // Set up Speech-to-text Web Speech API
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-IN';

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event) => {
        const text = event.results[0][0].transcript;
        setInputValue(prev => prev + ' ' + text);
      };

      rec.onerror = (e) => {
        console.error("Speech Recognition Error:", e);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }
  }, []);

  const handleVoiceToggle = () => {
    if (!recognitionRef.current) {
      alert("Web Speech API is not supported on this browser version.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  const handleSend = async (textToSend = inputValue) => {
    const promptText = String(textToSend).trim();
    if (!promptText) return;

    setMessages(prev => [...prev, { role: 'user', content: promptText }]);
    setInputValue('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gr_crm_token')}`
        },
        body: JSON.stringify({ message: promptText })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || "Insufficient CRM data available." }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Error connecting to Gagan Realtech AI server." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCommand = (cmdText) => {
    handleSend(cmdText);
  };

  return (
    <>
      {/* Premium Floating Sphere Trigger Button */}
      {!open && (
        <Tooltip title="Gagan Copilot AI" placement="left">
          <IconButton
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onClick={(e) => {
              if (dragRef.current.hasDragged) {
                e.preventDefault();
                return;
              }
              setOpen(true);
            }}
            sx={{
              position: 'fixed',
              bottom: position.bottom,
              right: position.right,
              width: 56,
              height: 56,
              zIndex: 1300,
              backgroundColor: '#1E3A8A',
              color: '#FFFFFF',
              boxShadow: '0 8px 32px rgba(30, 58, 138, 0.4)',
              cursor: 'grab',
              userSelect: 'none',
              '&:active': {
                cursor: 'grabbing'
              },
              transition: 'box-shadow 0.3s, background-color 0.3s, transform 0.2s',
              animation: 'pulse 2s infinite',
              '@keyframes pulse': {
                '0%': { boxShadow: '0 0 0 0 rgba(30, 58, 138, 0.7)' },
                '70%': { boxShadow: '0 0 0 15px rgba(30, 58, 138, 0)' },
                '100%': { boxShadow: '0 0 0 0 rgba(30, 58, 138, 0)' }
              },
              '&:hover': {
                backgroundColor: '#1D4ED8',
                transform: 'scale(1.1)',
                boxShadow: '0 12px 40px rgba(29, 78, 216, 0.6)'
              }
            }}
          >
            <Icons.Cpu size={26} />
          </IconButton>
        </Tooltip>
      )}

      {/* Slide-out AI Panel Drawer */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        hideBackdrop={true}
        sx={{
          pointerEvents: 'none',
          '& .MuiDrawer-paper': {
            pointerEvents: 'auto'
          }
        }}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 400 },
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#F8FAFC',
            borderLeft: '1px solid #E2E8F0',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.1)'
          }
        }}
      >
        {/* Drawer Header */}
        <Box sx={{ p: 2.5, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Avatar sx={{ backgroundColor: '#1E3A8A', width: 36, height: 36 }}>
              <Icons.Sparkles size={18} color="#FFFFFF" />
            </Avatar>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0F172A', fontSize: '15px' }}>
                Gagan Realtech AI
              </Typography>
              <Typography variant="caption" sx={{ color: '#22C55E', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22C55E' }} />
                Copilot Online
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setOpen(false)} size="small" sx={{ color: '#64748B' }}>
            <Icons.X size={18} />
          </IconButton>
        </Box>

        {/* Scrollable Conversation Thread */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {messages.map((m, idx) => (
            <Box 
              key={idx} 
              sx={{ 
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                display: 'flex',
                gap: 1,
                flexDirection: m.role === 'user' ? 'row-reverse' : 'row'
              }}
            >
              <Avatar 
                sx={{ 
                  width: 28, 
                  height: 28, 
                  fontSize: '11px',
                  backgroundColor: m.role === 'user' ? '#10B981' : '#1E3A8A' 
                }}
              >
                {m.role === 'user' ? 'ME' : 'AI'}
              </Avatar>
              <Paper
                elevation={0}
                sx={{
                  p: 1.75,
                  borderRadius: m.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                  backgroundColor: m.role === 'user' ? '#10B981' : '#FFFFFF',
                  color: m.role === 'user' ? '#FFFFFF' : '#0F172A',
                  border: m.role === 'user' ? 'none' : '1px solid #E2E8F0',
                  boxShadow: m.role === 'user' ? 'none' : '0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                {renderMessageContent(m.content, m.role === 'user')}
              </Paper>
            </Box>
          ))}
          {loading && (
            <Box sx={{ alignSelf: 'flex-start', display: 'flex', gap: 1, alignItems: 'center' }}>
              <Avatar sx={{ width: 28, height: 28, backgroundColor: '#1E3A8A' }}>
                <CircularProgress size={12} color="inherit" />
              </Avatar>
              <Paper sx={{ p: 1.75, border: '1px solid #E2E8F0', borderRadius: '4px 16px 16px 16px', backgroundColor: '#FFFFFF' }}>
                <Box display="flex" gap={0.5}>
                  <Box className="dot" sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#64748B', animation: 'bounce 1.4s infinite alternate' }} />
                  <Box className="dot" sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#64748B', animation: 'bounce 1.4s infinite alternate 0.2s' }} />
                  <Box className="dot" sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#64748B', animation: 'bounce 1.4s infinite alternate 0.4s' }} />
                </Box>
              </Paper>
            </Box>
          )}
          <div ref={messagesEndRef} />
        </Box>

        {/* Quick Action Suggestion Chips */}
        <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 1, backgroundColor: '#FFFFFF', borderTop: '1px solid #E2E8F0' }}>
          {[
            'Show me leads above ₹1 Cr',
            'Find projects with zero bookings',
            'Which RM has the lowest conversion?',
            'Generate Today\'s Briefing'
          ].map((cmd, i) => (
            <Chip
              key={i}
              label={cmd}
              onClick={() => handleQuickCommand(cmd)}
              icon={<Icons.Sparkles size={11} />}
              sx={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#1E3A8A',
                backgroundColor: '#EFF6FF',
                borderColor: '#BFDBFE',
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: '#DBEAFE'
                }
              }}
              variant="outlined"
              size="small"
            />
          ))}
        </Box>

        {/* Chat Control Input Input Area */}
        <Box sx={{ p: 2, backgroundColor: '#FFFFFF', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 1, alignItems: 'center' }}>
          <Tooltip title={isListening ? "Listening... Click to stop" : "Record voice command"}>
            <IconButton 
              onClick={handleVoiceToggle} 
              sx={{ 
                color: isListening ? '#EF4444' : '#64748B',
                backgroundColor: isListening ? '#FEE2E2' : '#F1F5F9',
                '&:hover': {
                  backgroundColor: isListening ? '#FCA5A5' : '#E2E8F0'
                }
              }}
            >
              <Icons.Mic size={18} />
            </IconButton>
          </Tooltip>
          
          <TextField
            fullWidth
            size="small"
            placeholder={isListening ? "Listening voice..." : "Ask Copilot a question..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={loading}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '12px',
                backgroundColor: '#F8FAFC',
                fontSize: '13px'
              }
            }}
          />

          <IconButton 
            onClick={() => handleSend()}
            disabled={loading || !inputValue.trim()}
            sx={{ 
              backgroundColor: '#1E3A8A', 
              color: '#FFFFFF',
              borderRadius: '12px',
              '&:hover': {
                backgroundColor: '#1D4ED8'
              },
              '&.Mui-disabled': {
                backgroundColor: '#F1F5F9',
                color: '#94A3B8'
              }
            }}
          >
            <Icons.Send size={18} />
          </IconButton>
        </Box>
      </Drawer>
      
      {/* Styles for bouncing animation */}
      <style>{`
        @keyframes bounce {
          to { transform: translateY(-4px); }
        }
      `}</style>
    </>
  );
}
