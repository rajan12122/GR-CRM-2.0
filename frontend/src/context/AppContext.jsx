import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { encryptData } from '../utils/crypto';

const AppContext = createContext();

export const API_BASE_URL = Capacitor.isNativePlatform()
  ? 'https://gr-crm-backend.onrender.com/api'
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:5000/api'
      : 'https://gr-crm-backend.onrender.com/api');

// Helper to detect specific device models on the client side (especially iOS where userAgent is generic)
const getDeviceModel = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  
  if (/iPhone|iPad|iPod/.test(ua)) {
    const width = window.screen.width;
    const height = window.screen.height;
    const ratio = window.devicePixelRatio;
    
    if (width === 430 && height === 932) return "iPhone 15 Pro Max / 16 Plus";
    if (width === 393 && height === 852) return "iPhone 15 / 15 Pro / 16";
    if (width === 428 && height === 926) return "iPhone 13 Pro Max / 14 Plus";
    if (width === 390 && height === 844) return "iPhone 13 / 13 Pro / 14";
    if (width === 414 && height === 896) {
      return ratio === 3 ? "iPhone 11 Pro Max / XS Max" : "iPhone 11 / XR";
    }
    if (width === 375 && height === 812) return "iPhone 11 Pro / XS / X";
    if (width === 375 && height === 667) return "iPhone SE (2nd/3rd Gen) / 8 / 7";
    if (width === 440 && height === 956) return "iPhone 16 Pro Max";
    if (width === 402 && height === 874) return "iPhone 16 Pro";
    
    return "iPhone";
  }
  
  if (/Android/.test(ua)) {
    const match = ua.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      const parts = match[1].split(';');
      const androidIdx = parts.findIndex(p => p.includes('Android'));
      let model = "";
      if (androidIdx > -1 && parts[androidIdx + 1]) {
        const potentialModel = parts[androidIdx + 1].trim();
        if (!potentialModel.includes('Linux') && !potentialModel.includes('Build') && potentialModel.length > 2) {
          model = potentialModel;
        }
      }
      if (!model) {
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.includes('Build/')) {
            model = trimmed.split('Build/')[0].trim();
            break;
          }
        }
      }
      if (model) return model;
    }
    return "Android Device";
  }
  
  if (ua.includes('Windows')) return "Windows PC";
  if (ua.includes('Macintosh')) return "MacBook / iMac";
  if (ua.includes('Linux')) return "Linux PC";
  
  return "";
};

// Set default auth token header if cached and client device model
const cachedToken = localStorage.getItem('gr_crm_token');
if (cachedToken) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${cachedToken}`;
}
axios.defaults.headers.common['x-client-device-model'] = getDeviceModel();

export const AppProvider = ({ children }) => {
  const [token, setToken] = useState(cachedToken);
  const [user, setUser] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [moduleData, setModuleData] = useState({});
  const [loadingData, setLoadingData] = useState(false);
  const [activityLogs, setActivityLogs] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  const triggerAppReload = () => {
    setModuleData({});
    setReloadKey(prev => prev + 1);
  };

  // Background Location Tracking state & references
  const [sharingLocation, setSharingLocation] = useState(
    localStorage.getItem('gr_sharing_location') === 'true'
  );
  const [sharingError, setSharingError] = useState('');
  const watchIdRef = useRef(null);
  const intervalIdRef = useRef(null);

  const startLocationSharing = async () => {
    if (watchIdRef.current || intervalIdRef.current) return;

    setSharingLocation(true);
    setSharingError("");
    localStorage.setItem('gr_sharing_location', 'true');

    const captureLocation = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
          if (pos) {
            setSharingError("");
            await logEmployeeLocation(pos.coords.latitude, pos.coords.longitude, 'sharing');
          }
        } catch (err) {
          console.warn("GPS initial lock weak/delay:", err);
          const isPerm = err.code === 1 || (err.message && err.message.toLowerCase().includes('permission'));
          if (isPerm) {
            setSharingError("Failed to lock location. Please enable GPS permissions.");
          }
        }
      } else {
        if (!navigator.geolocation) {
          setSharingError("Geolocation is not supported by your browser/device.");
          return;
        }
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (pos) {
              setSharingError("");
              await logEmployeeLocation(pos.coords.latitude, pos.coords.longitude, 'sharing');
            }
          },
          (err) => {
            console.warn("GPS initial lock weak/delay:", err);
            if (err.code === 1) {
              setSharingError("Failed to lock location. Please enable GPS permissions.");
            } else {
              // Retry with high accuracy disabled (Wi-Fi/IP positioning)
              console.log("Retrying location capture with standard accuracy fallback...");
              navigator.geolocation.getCurrentPosition(
                async (pos2) => {
                  if (pos2) {
                    setSharingError("");
                    await logEmployeeLocation(pos2.coords.latitude, pos2.coords.longitude, 'sharing');
                  }
                },
                (err2) => {
                  console.warn("Standard accuracy fallback also failed:", err2);
                  setSharingError("GPS lock timeout. Please check device location settings.");
                },
                { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
              );
            }
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    };

    if (Capacitor.isNativePlatform()) {
      try {
        let status = await Geolocation.checkPermissions();
        if (status.location !== 'granted') {
          status = await Geolocation.requestPermissions();
        }
        if (status.location !== 'granted') {
          setSharingError("Failed to lock location. Please enable GPS permissions.");
          setSharingLocation(false);
          localStorage.removeItem('gr_sharing_location');
          return;
        }

        await captureLocation();

        const watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
          async (pos, err) => {
            if (err) {
              console.warn("GPS watch position error:", err);
              return;
            }
            if (pos) {
              setSharingError("");
              await logEmployeeLocation(pos.coords.latitude, pos.coords.longitude, 'sharing');
            }
          }
        );
        watchIdRef.current = watchId;
      } catch (err) {
        console.error("Error starting location sharing on native platform:", err);
        setSharingLocation(false);
        localStorage.removeItem('gr_sharing_location');
        return;
      }
    } else {
      if (!navigator.geolocation) {
        setSharingError("Geolocation is not supported by your browser/device.");
        return;
      }

      await captureLocation();

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          if (pos) {
            setSharingError("");
            await logEmployeeLocation(pos.coords.latitude, pos.coords.longitude, 'sharing');
          }
        },
        (err) => {
          if (err.code === 1) {
            setSharingError("Failed to lock location. Please enable GPS permissions.");
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }

    intervalIdRef.current = setInterval(captureLocation, 10000);
  };

  const endLocationSharing = async () => {
    setSharingLocation(false);
    localStorage.removeItem('gr_sharing_location');
    setSharingError("");

    if (watchIdRef.current) {
      if (Capacitor.isNativePlatform()) {
        try {
          await Geolocation.clearWatch({ id: watchIdRef.current });
        } catch (e) {
          console.error("Error clearing watch", e);
        }
      } else {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
    }

    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }

    await logEmployeeLocation(0, 0, 'ended');
  };

  // Auto sharing location manager effect
  useEffect(() => {
    if (!user) {
      if (watchIdRef.current || intervalIdRef.current) {
        endLocationSharing();
      }
      return;
    }

    const todayDateStr = new Date().toISOString().split('T')[0];
    const todayRecord = (moduleData.attendance || []).find(
      a => String(a.employeeId) === String(user?.id) && a.date === todayDateStr
    );
    const isCurrentlyCheckedIn = todayRecord && todayRecord.outTime === '--';

    if (isCurrentlyCheckedIn) {
      if (!watchIdRef.current && !intervalIdRef.current) {
        startLocationSharing();
      }
    } else {
      if (watchIdRef.current || intervalIdRef.current) {
        endLocationSharing();
      }
    }
  }, [user, moduleData.attendance]);

  // Clean up on provider unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current) {
        if (Capacitor.isNativePlatform()) {
          Geolocation.clearWatch({ id: watchIdRef.current }).catch(() => {});
        } else {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
      }
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, []);

  // Load user profile and metadata if token exists
  useEffect(() => {
    if (token) {
      loadProfileAndMetadata();
    } else {
      setLoadingMetadata(false);
    }
  }, [token]);

  const loadProfileAndMetadata = async () => {
    try {
      setLoadingMetadata(true);
      // Set Axios auth header
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // 1. Verify token validity and fetch metadata in parallel
      const [userRes, metaRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/auth/me`),
        axios.get(`${API_BASE_URL}/metadata`)
      ]);

      setUser(userRes.data);
      setMetadata(metaRes.data);

      // Unblock the app startup immediately so the UI shell mounts
      setLoadingMetadata(false);

      // 2. Preload secondary tables in the background asynchronously
      const modulesToPreload = ['employees', 'customers', 'properties', 'dealers'];
      Promise.all([
        Promise.all(
          modulesToPreload.map(async (m) => {
            try {
              const res = await axios.get(`${API_BASE_URL}/data/${m}`);
              return { module: m, data: res.data };
            } catch (e) {
              console.error(`Failed to preload lookup module ${m}:`, e);
              return { module: m, data: [] };
            }
          })
        ),
        axios.get(`${API_BASE_URL}/data/activity_logs`).catch(() => ({ data: [] }))
      ]).then(([preloadResults, logsRes]) => {
        const loaded = {};
        preloadResults.forEach(({ module, data }) => {
          loaded[module] = data;
        });
        setModuleData(prev => ({ ...prev, ...loaded }));
        setActivityLogs(logsRes.data || []);
      }).catch(err => {
        console.error('Background preloading failed:', err);
      });

    } catch (err) {
      console.error('Failed to load profile/metadata:', err);
      // Only logout if the error status indicates auth credentials expired (401/403)
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        logout();
      }
      setLoadingMetadata(false);
    }
  };

  const login = async (email, password) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/auth/login`, { email, password });
      const { token: userToken, user: userData } = res.data;
      
      localStorage.setItem('gr_crm_token', userToken);
      axios.defaults.headers.common['Authorization'] = `Bearer ${userToken}`;
      
      setToken(userToken);
      setUser(userData);
      return { success: true };
    } catch (err) {
      console.error('Login failed:', err);
      return { 
        success: false, 
        message: err.response?.data?.message || 'Login failed. Please try again.' 
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('gr_crm_token');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
    setMetadata(null);
    setModuleData({});
  };

  // Fetch data records for a specific module
  const fetchModuleData = async (moduleName, forceReload = false) => {
    if (!forceReload && moduleData[moduleName] && moduleData[moduleName].length > 0) {
      return moduleData[moduleName];
    }
    setLoadingData(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/data/${moduleName}`);
      setModuleData(prev => ({ ...prev, [moduleName]: res.data }));
      return res.data;
    } catch (err) {
      console.error(`Error fetching ${moduleName}:`, err);
      return [];
    } finally {
      setLoadingData(false);
    }
  };

  // Sync pending offline submissions to server
  const syncOfflineSubmissions = async () => {
    const queue = JSON.parse(localStorage.getItem('gr_crm_offline_submissions') || '[]');
    if (queue.length === 0) return;

    console.log(`[Offline Sync] Found ${queue.length} pending offline submissions. Syncing...`);
    const remaining = [];

    for (const item of queue) {
      try {
        if (item.mode === 'create') {
          const cleanPayload = { ...item.payload };
          if (String(cleanPayload.id).startsWith('OFFLINE-')) {
            delete cleanPayload.id;
          }
          await axios.post(`${API_BASE_URL}/data/${item.moduleName}`, cleanPayload);
        } else if (item.mode === 'update') {
          await axios.put(`${API_BASE_URL}/data/${item.moduleName}/${item.id}`, item.payload);
        }
      } catch (err) {
        console.error(`[Offline Sync] Failed to sync item:`, item, err);
        remaining.push(item);
      }
    }

    localStorage.setItem('gr_crm_offline_submissions', JSON.stringify(remaining));

    if (queue.length > remaining.length) {
      alert(`🎉 Network restored! Successfully synced ${queue.length - remaining.length} offline drafts with the server.`);
      const modulesToFetch = ['properties', 'deals', 'customers', 'leads', 'dealers', 'site_visits', 'queries', 'follow_ups'];
      modulesToFetch.forEach(m => fetchModuleData(m).catch(() => {}));
      axios.get(`${API_BASE_URL}/data/activity_logs`).then(r => setActivityLogs(r.data)).catch(() => {});
    }
  };

  // Register window online listener to auto-sync offline submissions
  useEffect(() => {
    const handleOnline = () => {
      syncOfflineSubmissions();
    };
    window.addEventListener('online', handleOnline);
    if (navigator.onLine) {
      syncOfflineSubmissions();
    }
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Create a record dynamically
  const createRecord = async (moduleName, payload) => {
    try {
      if (!navigator.onLine) {
        throw new Error('Network Error');
      }
      const res = await axios.post(`${API_BASE_URL}/data/${moduleName}`, payload);
      // Optimistic cache update
      setModuleData(prev => ({
        ...prev,
        [moduleName]: [...(prev[moduleName] || []), res.data]
      }));
      // Refresh logs
      axios.get(`${API_BASE_URL}/data/activity_logs`).then(r => setActivityLogs(r.data)).catch(() => {});

      // Auto-refresh related modules when pitch, deal, site_visit, query, or follow_up changes to keep UI consistent
      const relatedModules = ['property_pitch_history', 'deals', 'site_visits', 'queries', 'follow_ups'];
      if (relatedModules.includes(moduleName)) {
        fetchModuleData('properties', true);
        fetchModuleData('deals', true);
        fetchModuleData('customers', true);
        fetchModuleData('leads', true);
        fetchModuleData('dealers', true);
        fetchModuleData('site_visits', true);
        fetchModuleData('queries', true);
        fetchModuleData('follow_ups', true);
      }

      return { success: true, data: res.data };
    } catch (err) {
      console.error(`Error creating ${moduleName}:`, err);
      if (!navigator.onLine || err.message === 'Network Error') {
        const tempId = payload.id || `OFFLINE-${moduleName.toUpperCase()}-${Date.now()}`;
        const mockData = { ...payload, id: tempId };
        
        const queue = JSON.parse(localStorage.getItem('gr_crm_offline_submissions') || '[]');
        queue.push({
          mode: 'create',
          moduleName,
          payload: mockData,
          timestamp: Date.now()
        });
        localStorage.setItem('gr_crm_offline_submissions', JSON.stringify(queue));

        setModuleData(prev => ({
          ...prev,
          [moduleName]: [...(prev[moduleName] || []), mockData]
        }));

        return { success: true, isOfflineDraft: true, data: mockData };
      }
      return { success: false, message: err.response?.data?.message || 'Create failed.' };
    }
  };

  // Update a record dynamically
  const updateRecord = async (moduleName, id, payload) => {
    try {
      if (!navigator.onLine) {
        throw new Error('Network Error');
      }
      const res = await axios.put(`${API_BASE_URL}/data/${moduleName}/${id}`, payload);
      // Update cache
      setModuleData(prev => ({
        ...prev,
        [moduleName]: (prev[moduleName] || []).map(rec => String(rec.id) === String(id) ? res.data : rec)
      }));
      axios.get(`${API_BASE_URL}/data/activity_logs`).then(r => setActivityLogs(r.data)).catch(() => {});

      // Auto-refresh related modules when pitch, deal, site_visit, query, or follow_up changes to keep UI consistent
      const relatedModules = ['property_pitch_history', 'deals', 'site_visits', 'queries', 'follow_ups'];
      if (relatedModules.includes(moduleName)) {
        fetchModuleData('properties', true);
        fetchModuleData('deals', true);
        fetchModuleData('customers', true);
        fetchModuleData('leads', true);
        fetchModuleData('dealers', true);
        fetchModuleData('site_visits', true);
        fetchModuleData('queries', true);
        fetchModuleData('follow_ups', true);
      }

      return { success: true, data: res.data };
    } catch (err) {
      console.error(`Error updating ${moduleName}:`, err);
      if (!navigator.onLine || err.message === 'Network Error') {
        const mockData = { ...payload, id };
        
        const queue = JSON.parse(localStorage.getItem('gr_crm_offline_submissions') || '[]');
        const existingIdx = queue.findIndex(q => q.mode === 'update' && q.moduleName === moduleName && String(q.id) === String(id));
        if (existingIdx > -1) {
          queue[existingIdx].payload = { ...queue[existingIdx].payload, ...payload };
        } else {
          queue.push({
            mode: 'update',
            moduleName,
            id,
            payload: mockData,
            timestamp: Date.now()
          });
        }
        localStorage.setItem('gr_crm_offline_submissions', JSON.stringify(queue));

        setModuleData(prev => ({
          ...prev,
          [moduleName]: (prev[moduleName] || []).map(rec => String(rec.id) === String(id) ? { ...rec, ...payload } : rec)
        }));

        return { success: true, isOfflineDraft: true, data: mockData };
      }
      return { success: false, message: err.response?.data?.message || 'Update failed.' };
    }
  };

  // Delete a record dynamically
  const deleteRecord = async (moduleName, id) => {
    try {
      await axios.delete(`${API_BASE_URL}/data/${moduleName}/${id}`);
      // Remove from cache
      setModuleData(prev => ({
        ...prev,
        [moduleName]: (prev[moduleName] || []).filter(rec => rec.id !== id)
      }));
      axios.get(`${API_BASE_URL}/data/activity_logs`).then(r => setActivityLogs(r.data)).catch(() => {});
      
      const relatedModules = ['property_pitch_history', 'deals', 'site_visits', 'queries', 'follow_ups'];
      if (relatedModules.includes(moduleName)) {
        fetchModuleData('properties', true);
        fetchModuleData('deals', true);
        fetchModuleData('customers', true);
        fetchModuleData('leads', true);
        fetchModuleData('dealers', true);
        fetchModuleData('site_visits', true);
        fetchModuleData('queries', true);
        fetchModuleData('follow_ups', true);
      }

      return { success: true };
    } catch (err) {
      console.error(`Error deleting ${moduleName}:`, err);
      return { success: false, message: err.response?.data?.message || 'Delete failed.' };
    }
  };

  // Bulk delete records dynamically
  const bulkDeleteRecord = async (moduleName, ids) => {
    try {
      await axios.post(`${API_BASE_URL}/data/${moduleName}/bulk-delete`, { ids });
      // Remove from cache
      setModuleData(prev => ({
        ...prev,
        [moduleName]: (prev[moduleName] || []).filter(rec => !ids.includes(rec.id))
      }));
      axios.get(`${API_BASE_URL}/data/activity_logs`).then(r => setActivityLogs(r.data)).catch(() => {});
      return { success: true };
    } catch (err) {
      console.error(`Error bulk deleting ${moduleName}:`, err);
      return { success: false, message: err.response?.data?.message || 'Bulk delete failed.' };
    }
  };

  // Log employee coordinates securely
  const logEmployeeLocation = async (lat, lng, status) => {
    try {
      await axios.post(`${API_BASE_URL}/location/log`, {
        employeeId: user?.id,
        employeeName: user?.name,
        latitude: lat,
        longitude: lng,
        status
      });
      return { success: true };
    } catch (err) {
      console.error('Failed to log location:', err);
      return { success: false };
    }
  };

  // Remarks Timeline Operations
  const createRemark = async (targetModule, targetId, comment) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/remarks`, { targetModule, targetId, comment });
      return { success: true, data: res.data };
    } catch (err) {
      console.error('Failed to post remark:', err);
      return { success: false };
    }
  };

  // Document Upload operations
  const uploadDocument = async (targetModule, targetId, name, fileUrl) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/documents`, { targetModule, targetId, name, fileUrl });
      return { success: true, data: res.data };
    } catch (err) {
      console.error('Failed to save document:', err);
      return { success: false };
    }
  };

  // 360 Entity Details Resolver
  const fetchEntity360 = async (moduleName, id) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/360/${moduleName}/${id}`);
      return res.data;
    } catch (err) {
      console.error(`Failed to fetch 360 detail for ${moduleName}:${id}`, err);
      return null;
    }
  };

  // Global Search across entire database
  const searchAll = async (query) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
      return res.data;
    } catch (err) {
      console.error('Search failed:', err);
      return { results: {}, connections: {} };
    }
  };

  // Admin: Update metadata schemas (reorder, add column, chip configurations)
  const saveMetadata = async (newMetadata) => {
    // Optimistic UI update: update local state immediately so user sees changes instantly (high refresh rate feel)
    const prevMetadata = metadata;
    setMetadata(newMetadata);
    try {
      await axios.post(`${API_BASE_URL}/metadata`, newMetadata);
      return { success: true };
    } catch (err) {
      console.error('Save metadata failed:', err);
      // Rollback to original metadata state on network/backend failure
      setMetadata(prevMetadata);
      return { success: false, message: err.response?.data?.message || 'Failed to update configuration.' };
    }
  };

  // Google Sheets Management
  const testSheetsSync = async () => {
    try {
      const res = await axios.post(`${API_BASE_URL}/settings/test-sheets`);
      return { success: true, message: res.data.message };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Sheets connection failed.' };
    }
  };

  const triggerFullSheetsSync = async () => {
    try {
      const res = await axios.post(`${API_BASE_URL}/settings/sync-now`);
      return { success: true, message: res.data.message };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Sync failed.' };
    }
  };

  const hasPermission = (moduleName, action = 'view') => {
    if (user?.role === 'Admin') return true;
    
    // Check specific user-level override permissions first
    const userId = user?.id;
    if (userId && metadata?.userPermissions?.[userId]) {
      const userModulePerms = metadata.userPermissions[userId][moduleName] || [];
      return userModulePerms.includes(action);
    }

    // Fallback to role-level default permissions
    const permissions = metadata?.rolesPermissions?.[user?.role];
    const modulePerms = permissions?.[moduleName] || [];
    return modulePerms.includes(action);
  };

  const refreshMetadata = async () => {
    if (token) {
      try {
        const metaRes = await axios.get(`${API_BASE_URL}/metadata`);
        setMetadata(metaRes.data);
      } catch (err) {
        console.error('Failed to reload metadata:', err);
      }
    }
  };

  return (
    <AppContext.Provider
      value={{
        token,
        user,
        metadata,
        loadingMetadata,
        moduleData,
        loadingData,
        activityLogs,
        reloadKey,
        triggerAppReload,
        login,
        logout,
        fetchModuleData,
        createRecord,
        updateRecord,
        deleteRecord,
        bulkDeleteRecord,
        createRemark,
        uploadDocument,
        fetchEntity360,
        searchAll,
        saveMetadata,
        testSheetsSync,
        triggerFullSheetsSync,
        logEmployeeLocation,
        hasPermission,
        refreshMetadata,
        sharingLocation,
        sharingError,
        startLocationSharing,
        endLocationSharing
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
