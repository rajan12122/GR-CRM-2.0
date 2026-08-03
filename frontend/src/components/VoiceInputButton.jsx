import React, { useState } from 'react';
import { IconButton, Tooltip, CircularProgress } from '@mui/material';
import * as Icons from 'lucide-react';

const VoiceInputButton = ({ onTranscript, placeholder = "Dictate..." }) => {
  const [listening, setListening] = useState(false);
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return null; // Browser doesn't support Web Speech API
  }

  const startListening = () => {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN'; // Pre-set to English/India to match user locale

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript && onTranscript) {
        onTranscript(transcript);
      }
    };

    recognition.start();
  };

  return (
    <Tooltip title={listening ? "Listening... Speak now" : "Speak to Type"}>
      <IconButton 
        type="button"
        onClick={startListening} 
        color={listening ? "error" : "primary"}
        sx={{
          animation: listening ? 'pulse 1.5s infinite' : 'none',
          p: '6px',
          '@keyframes pulse': {
            '0%': { transform: 'scale(1)' },
            '50%': { transform: 'scale(1.15)', backgroundColor: 'rgba(239, 68, 68, 0.15)' },
            '100%': { transform: 'scale(1)' },
          }
        }}
      >
        {listening ? <CircularProgress size={16} color="error" /> : <Icons.Mic size={16} />}
      </IconButton>
    </Tooltip>
  );
};

export default VoiceInputButton;
