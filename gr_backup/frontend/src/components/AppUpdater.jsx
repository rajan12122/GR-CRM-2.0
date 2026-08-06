import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Button, 
  Typography, 
  Box, 
  LinearProgress, 
  Alert
} from '@mui/material';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { API_BASE_URL } from '../context/AppContext';
import * as Icons from 'lucide-react';

const AppUpdater = () => {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [currentVersion, setCurrentVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState('');
  const [updateTitle, setUpdateTitle] = useState('Update Available');
  const [updateMessage, setUpdateMessage] = useState('');
  const [apkUrl, setApkUrl] = useState('');
  const [forceUpdate, setForceUpdate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [permissionRequired, setPermissionRequired] = useState(false);

  useEffect(() => {
    // Check if we are running inside native Capacitor environment
    if (!Capacitor.isNativePlatform() || !Capacitor.Plugins.AppUpdater) {
      setChecking(false);
      return;
    }

    const checkUpdates = async () => {
      try {
        const NativeUpdater = Capacitor.Plugins.AppUpdater;
        
        // 1. Get current installed version from native app
        const appInfo = await NativeUpdater.getAppVersionCode();
        const installedCode = Number(appInfo.versionCode);
        setCurrentVersion(appInfo.versionName + ` (Build ${installedCode})`);

        // 2. Fetch latest version configurations from remote backend
        const res = await axios.get(`${API_BASE_URL}/public/update-check`);
        const remoteCode = Number(res.data.versionCode);
        setLatestVersion(res.data.versionName + ` (Build ${remoteCode})`);
        setUpdateTitle(res.data.title || 'Update Available');
        setUpdateMessage(res.data.message || 'A new update is available. Please download to continue.');
        setApkUrl(res.data.apkUrl);
        setForceUpdate(!!res.data.forceUpdate);

        // 3. Compare versions
        if (installedCode < remoteCode) {
          // Open update dialog
          setOpen(true);
        }
      } catch (err) {
        console.error('App Update Check failed:', err);
        // Silently catch error and proceed so the app doesn't crash or block
      } finally {
        setChecking(false);
      }
    };

    checkUpdates();

    // Register Capacitor listeners for download progress and state changes
    let progressListener;
    let stateListener;

    if (Capacitor.isNativePlatform() && Capacitor.Plugins.AppUpdater) {
      const NativeUpdater = Capacitor.Plugins.AppUpdater;
      
      progressListener = NativeUpdater.addListener('downloadProgress', (info) => {
        setProgress(info.progress);
      });

      stateListener = NativeUpdater.addListener('installState', (state) => {
        if (state.action === 'requestPermission') {
          setPermissionRequired(true);
          setDownloading(false);
          setErrorMsg("Permission Required: Please enable 'Install Unknown Apps' for Gagan Realtech CRM in Settings and tap Update Now again.");
        } else if (state.action === 'installed') {
          setDownloading(false);
          setOpen(false);
        }
      });
    }

    return () => {
      if (progressListener) progressListener.remove();
      if (stateListener) stateListener.remove();
    };
  }, []);

  const handleUpdate = async () => {
    setErrorMsg('');
    setPermissionRequired(false);
    setDownloading(true);
    setProgress(0);

    try {
      const NativeUpdater = Capacitor.Plugins.AppUpdater;
      await NativeUpdater.downloadAndInstallApk({ url: apkUrl });
    } catch (err) {
      console.error('Update failed:', err);
      setDownloading(false);
      setErrorMsg(err.message || 'An error occurred during update download.');
    }
  };

  if (checking) {
    return null; // Silently check in the background
  }

  return (
    <Dialog 
      open={open} 
      onClose={forceUpdate ? undefined : () => setOpen(false)}
      disableEscapeKeyDown={forceUpdate}
      maxWidth="xs" 
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '24px',
          p: 2,
          backgroundColor: '#0F172A',
          color: '#FFFFFF',
          border: '1px solid rgba(255,255,255,0.05)'
        }
      }}
    >
      <DialogContent sx={{ textAlign: 'center', p: 3 }}>
        <Box sx={{ display: 'inline-flex', p: 2, borderRadius: '20px', backgroundColor: 'rgba(37,99,235,0.1)', mb: 3 }}>
          <Icons.DownloadCloud size={40} style={{ color: '#3B82F6' }} />
        </Box>
        
        <Typography variant="h5" sx={{ fontWeight: 800, fontFamily: 'Poppins', mb: 1 }}>
          {updateTitle}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, my: 2 }}>
          <Box sx={{ p: 1, px: 2, borderRadius: '12px', backgroundColor: '#1E293B', border: '1px solid #334155' }}>
            <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block' }}>Installed</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>v{currentVersion}</Typography>
          </Box>
          <Box sx={{ p: 1, px: 2, borderRadius: '12px', backgroundColor: 'rgba(37,99,235,0.15)', border: '1px solid #2563EB' }}>
            <Typography variant="caption" sx={{ color: '#60A5FA', display: 'block' }}>Latest</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#60A5FA' }}>v{latestVersion}</Typography>
          </Box>
        </Box>

        <Typography variant="body2" sx={{ color: '#94A3B8', mb: 3, px: 1, lineHeight: 1.6 }}>
          {updateMessage}
        </Typography>

        {errorMsg && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: '12px', textAlign: 'left', backgroundColor: 'rgba(239,68,68,0.1)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.2)' }}>
            {errorMsg}
          </Alert>
        )}

        {downloading && (
          <Box sx={{ width: '100%', mb: 2 }}>
            <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4, backgroundColor: '#1E293B', '& .MuiLinearProgress-bar': { backgroundColor: '#3B82F6' } }} />
            <Typography variant="caption" sx={{ color: '#94A3B8', mt: 1, display: 'block', fontWeight: 600 }}>
              Downloading Update: {progress}%
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'center', gap: 1.5, pb: 2, px: 3 }}>
        {!forceUpdate && !downloading && (
          <Button 
            onClick={() => setOpen(false)} 
            variant="outlined"
            sx={{ 
              borderRadius: '12px', 
              color: '#94A3B8', 
              borderColor: '#334155', 
              textTransform: 'none', 
              fontWeight: 700,
              flex: 1,
              '&:hover': { borderColor: '#475569', backgroundColor: 'rgba(255,255,255,0.05)' }
            }}
          >
            Later
          </Button>
        )}
        
        <Button 
          onClick={handleUpdate} 
          disabled={downloading}
          variant="contained"
          fullWidth={forceUpdate}
          sx={{ 
            borderRadius: '12px', 
            backgroundColor: '#3B82F6', 
            color: '#FFFFFF',
            textTransform: 'none', 
            fontWeight: 800,
            flex: forceUpdate ? 'none' : 1,
            '&:hover': { backgroundColor: '#2563EB' }
          }}
        >
          {downloading ? 'Downloading...' : permissionRequired ? 'Retry Install' : 'Update Now'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AppUpdater;
