import React, { useEffect, useState, useRef } from 'react';
import { 
  Box, 
  Grid, 
  Card, 
  CardContent, 
  Typography, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemAvatar, 
  Avatar, 
  Chip, 
  Button, 
  Divider, 
  Alert, 
  CircularProgress 
} from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../context/AppContext';

// Dynamically load Leaflet CDN assets for a keyless maps implementation
const loadLeafletAssets = () => {
  return new Promise((resolve) => {
    if (window.L) {
      resolve();
      return;
    }
    
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
};

const LocationTracker = () => {
  const [loading, setLoading] = useState(true);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [mapEngineLoaded, setMapEngineLoaded] = useState(false);
  const [selectedPathData, setSelectedPathData] = useState(null);
  
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const pollingRef = useRef(null);
  const polylineRef = useRef(null);

  // 1. Initial Load Leaflet Map Assets
  useEffect(() => {
    loadLeafletAssets().then(() => {
      setMapEngineLoaded(true);
      setLoading(false);
    });
    
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Fetch and Decrypt Active Coordinates
  const fetchActiveLocations = async () => {
    try {
      const token = localStorage.getItem('gr_crm_token');
      const res = await axios.get(`${API_BASE_URL}/location/active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const decryptedData = res.data.map(log => {
        return {
          ...log,
          lat: Number(log.latitude) || 0,
          lng: Number(log.longitude) || 0
        };
      }).filter(item => item.lat !== 0 && item.lng !== 0);

      setActiveEmployees(decryptedData);
      return decryptedData;
    } catch (err) {
      console.error("Error fetching locations:", err);
      return [];
    }
  };

  // 3. Initialize Map after Assets Load
  useEffect(() => {
    if (!mapEngineLoaded || !mapRef.current || mapInstanceRef.current) return;

    // Default map centered on Chandigarh / Mohali Tri-City coords
    mapInstanceRef.current = window.L.map(mapRef.current, {
      zoomControl: false
    }).setView([30.7046, 76.7179], 12);

    // Add sleek, modern tile layers (CartoDB Voyager looks premium and responsive)
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapInstanceRef.current);

    window.L.control.zoom({ position: 'bottomright' }).addTo(mapInstanceRef.current);

    // Initial fetch
    fetchActiveLocations().then(data => {
      updateMarkersOnMap(data);
    });

    // Start 5-second polling interval
    pollingRef.current = setInterval(async () => {
      const data = await fetchActiveLocations();
      updateMarkersOnMap(data);
      
      if (selectedEmp) {
        const activeItem = data.find(e => e.employeeId === selectedEmp.employeeId);
        if (activeItem) {
          const token = localStorage.getItem('gr_crm_token');
          try {
            const pathRes = await axios.get(`${API_BASE_URL}/location/path/${selectedEmp.employeeId}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            setSelectedPathData(pathRes.data);
            if (mapInstanceRef.current && window.L) {
              if (polylineRef.current) polylineRef.current.remove();
              const pathCoords = pathRes.data.path.map(p => [p.lat, p.lng]);
              pathCoords.push([activeItem.lat, activeItem.lng]);
              if (pathCoords.length > 1) {
                polylineRef.current = window.L.polyline(pathCoords, { color: '#2563EB', weight: 4, opacity: 0.8 }).addTo(mapInstanceRef.current);
              }
              // Smoothly center the map on their live location
              mapInstanceRef.current.setView([activeItem.lat, activeItem.lng], 15);
            }
          } catch (e) {}
        } else {
          // Stopped sharing
          setSelectedEmp(null);
          setSelectedPathData(null);
          if (polylineRef.current) {
            polylineRef.current.remove();
            polylineRef.current = null;
          }
        }
      }
    }, 5000);

  }, [mapEngineLoaded, selectedEmp]);

  // 4. Update Markers Dynamically on Map
  const updateMarkersOnMap = (employees) => {
    if (!mapInstanceRef.current || !window.L) return;

    const L = window.L;
    const currentIds = new Set(employees.map(e => e.employeeId));

    // Clear old disconnected markers
    Object.keys(markersRef.current).forEach(empId => {
      if (!currentIds.has(empId)) {
        markersRef.current[empId].remove();
        delete markersRef.current[empId];
      }
    });

    // Add or Update markers
    employees.forEach(emp => {
      const coords = [emp.lat, emp.lng];
      
      if (markersRef.current[emp.employeeId]) {
        // Move existing marker smoothly
        markersRef.current[emp.employeeId].setLatLng(coords);
      } else {
        // Create premium custom pin icon
        const customIcon = L.divIcon({
          html: `<div class="custom-pin"><span class="pin-initial">${emp.employeeName.charAt(0)}</span></div>`,
          className: 'custom-div-icon',
          iconSize: [36, 36],
          iconAnchor: [18, 36]
        });

        const marker = L.marker(coords, { icon: customIcon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`
            <div style="font-family: Poppins, sans-serif; padding: 4px;">
              <strong style="color:#0F172A;font-size:13px;">${emp.employeeName}</strong><br/>
              <span style="color:#64748B;font-size:11px;">Status: Sharing Location 📡</span><br/>
              <span style="color:#94A3B8;font-size:10px;">Last Active: ${new Date(emp.timestamp).toLocaleTimeString()}</span>
            </div>
          `);
          
        markersRef.current[emp.employeeId] = marker;
      }
    });
  };

  const handleSelectEmployee = async (emp) => {
    setSelectedEmp(emp);
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    try {
      const token = localStorage.getItem('gr_crm_token');
      const res = await axios.get(`${API_BASE_URL}/location/path/${emp.employeeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedPathData(res.data);
      
      if (mapInstanceRef.current && window.L) {
        const pathCoords = res.data.path.map(p => [p.lat, p.lng]);
        if (pathCoords.length === 0 || pathCoords[pathCoords.length - 1][0] !== emp.lat || pathCoords[pathCoords.length - 1][1] !== emp.lng) {
          pathCoords.push([emp.lat, emp.lng]);
        }
        
        if (pathCoords.length > 1) {
          polylineRef.current = window.L.polyline(pathCoords, { color: '#2563EB', weight: 4, opacity: 0.8 }).addTo(mapInstanceRef.current);
          mapInstanceRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [30, 30] });
        } else {
          mapInstanceRef.current.setView([emp.lat, emp.lng], 15, { animate: true });
        }
      }
    } catch (e) {
      console.error(e);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([emp.lat, emp.lng], 15, { animate: true });
      }
    }

    if (markersRef.current[emp.employeeId]) {
      markersRef.current[emp.employeeId].openPopup();
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
        <CircularProgress />
        <Typography variant="subtitle2" sx={{ color: '#64748B' }}>Loading maps mapping engine...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      
      {/* Title */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '26px', color: '#0F172A', fontFamily: 'Poppins' }}>
          Live Employee Tracker
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B' }}>
          Monitor live coordinates of active field representatives securely. Encrypted end-to-end.
        </Typography>
      </Box>

      {/* Grid containing list and map */}
      <Grid container spacing={3} sx={{ flexGrow: 1, minHeight: 0 }}>
        
        {/* Left Side: Active List */}
        <Grid item xs={12} md={4} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ p: 2.5 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '18px', mb: 1, fontFamily: 'Poppins' }}>
                  On-Duty Reps ({activeEmployees.length})
                </Typography>
                <Typography variant="caption" sx={{ color: '#94A3B8' }}>
                  Auto-updates pings in 5s intervals.
                </Typography>
              </Box>
              <Divider />
              
              <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1.5 }}>
                {activeEmployees.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                      No representatives are currently sharing live location.
                    </Typography>
                  </Box>
                ) : (
                  <List disablePadding>
                    {activeEmployees.map(emp => {
                      const isSelected = selectedEmp?.employeeId === emp.employeeId;
                      return (
                        <ListItem 
                          button 
                          key={emp.employeeId}
                          onClick={() => handleSelectEmployee(emp)}
                          sx={{ 
                            borderRadius: '12px', 
                            mb: 1, 
                            border: isSelected ? '1.5px solid #2563EB' : '1px solid #E2E8F0',
                            backgroundColor: isSelected ? 'rgba(37,99,235,0.03)' : '#FFFFFF',
                            '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' }
                          }}
                        >
                          <ListItemAvatar>
                            <Avatar sx={{ backgroundColor: '#2563EB', fontWeight: 800 }}>
                              {emp.employeeName.charAt(0)}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText 
                            primary={
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A' }}>
                                {emp.employeeName}
                              </Typography>
                            }
                            secondary={
                              <Box sx={{ mt: 0.5 }}>
                                <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                                  Last Ping: {new Date(emp.timestamp).toLocaleTimeString()}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#94A3B8', fontSize: '9px', wordBreak: 'break-all', display: 'block' }}>
                                  Lat: {emp.lat.toFixed(5)}, Lng: {emp.lng.toFixed(5)}
                                </Typography>
                                {isSelected && selectedPathData && (
                                  <Box sx={{ mt: 1, p: 1, backgroundColor: 'rgba(37,99,235,0.05)', borderRadius: '6px' }}>
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#2563EB', display: 'block' }}>
                                      ⚡ Dist. Traveled: {selectedPathData.distance || 0} km
                                    </Typography>
                                  </Box>
                                )}
                              </Box>
                            }
                          />
                          <Chip 
                            label="📡 Live" 
                            size="small" 
                            sx={{ backgroundColor: '#22C55E', color: 'white', fontWeight: 700, fontSize: '10px' }} 
                          />
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Right Side: Map Container */}
        <Grid item xs={12} md={8} sx={{ height: '100%' }}>
          <Card sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', height: '100%', overflow: 'hidden', position: 'relative' }}>
            <Box 
              ref={mapRef} 
              sx={{ width: '100%', height: '100%', zIndex: 1 }}
            />
          </Card>
        </Grid>
      </Grid>

      {/* Custom CSS for Map Pins */}
      <style>{`
        .custom-pin {
          width: 36px;
          height: 36px;
          background-color: #2563EB;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid white;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }
        .pin-initial {
          color: white;
          font-weight: 800;
          font-size: 14px;
          transform: rotate(45deg);
          font-family: Poppins, sans-serif;
        }
      `}</style>
    </Box>
  );
};

export default LocationTracker;
