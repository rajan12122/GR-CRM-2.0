import React, { useState, useEffect, useRef } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useApp } from '../context/AppContext';

const PullToRefresh = ({ children }) => {
  const { triggerAppReload } = useApp();
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const startX = useRef(0);
  const containerRef = useRef(null);

  const handleTouchStart = (e) => {
    if (refreshing) return;
    const container = containerRef.current;
    if (!container) return;

    // Traversal check: ensure no child scroll container is currently scrolled down.
    // If any element between the touch target and the PullToRefresh container
    // has scrollTop > 1, then the user is scrolling a list, so skip pull-to-refresh.
    let isChildScrolled = false;
    let current = e.target;
    while (current && current !== container) {
      if (current.scrollTop > 1) {
        isChildScrolled = true;
        break;
      }
      current = current.parentElement;
    }

    if (container.scrollTop === 0 && !isChildScrolled && window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
    } else {
      startY.current = 0;
      startX.current = 0;
    }
  };

  const handleTouchMove = (e) => {
    if (refreshing || startY.current === 0) return;
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    
    const diffY = currentY - startY.current;
    const diffX = Math.abs(currentX - startX.current);
    
    // Only pull if it's a primarily vertical downward swipe
    if (diffY > 0 && diffY > diffX * 1.8) {
      // Apply pull resistance matching native look and feel
      const pull = Math.min(diffY * 0.45, 95);
      setPullY(pull);
      
      // Prevent default pull browser navigation if we handle swipe down
      if (diffY > 15 && e.cancelable) {
        e.preventDefault();
      }
    } else if (diffY < -5 || diffX > diffY) {
      // Cancel gesture if user swipes up or drags horizontally
      startY.current = 0;
      setPullY(0);
    }
  };

  const handleTouchEnd = () => {
    if (refreshing || startY.current === 0) return;
    if (pullY >= 65) {
      setRefreshing(true);
      setPullY(65);
      
      // Trigger dynamic react reload
      triggerAppReload();
      
      setTimeout(() => {
        setRefreshing(false);
        setPullY(0);
      }, 1000);
    } else {
      setPullY(0);
    }
    startY.current = 0;
    startX.current = 0;
  };

  return (
    <Box 
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      sx={{ 
        position: 'relative', 
        height: '100%', 
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        touchAction: 'pan-y'
      }}
    >
      {/* Pull Indicator Badge */}
      <Box sx={{
        position: 'absolute',
        top: -45,
        left: '50%',
        transform: `translate(-50%, ${pullY}px)`,
        transition: refreshing ? 'none' : 'transform 0.12s ease-out',
        zIndex: 1200,
        backgroundColor: '#FFFFFF',
        borderRadius: '50%',
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        border: '1px solid #E2E8F0',
        opacity: pullY > 15 ? 1 : 0
      }}>
        <CircularProgress 
          size={20} 
          variant={refreshing ? "indeterminate" : "determinate"}
          value={refreshing ? undefined : Math.min((pullY / 65) * 100, 100)}
          sx={{ color: '#2563EB' }}
        />
      </Box>

      {/* Children content wrapper */}
      <Box sx={{
        flexGrow: 1,
        transform: `translateY(${refreshing ? 15 : pullY * 0.15}px)`,
        transition: refreshing ? 'none' : 'transform 0.12s ease-out',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%'
      }}>
        {children}
      </Box>
    </Box>
  );
};

export default PullToRefresh;
