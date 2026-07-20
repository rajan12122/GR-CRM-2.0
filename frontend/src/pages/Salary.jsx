import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Grid, 
  Select, 
  MenuItem, 
  FormControl, 
  InputLabel, 
  TextField, 
  Button, 
  IconButton, 
  Divider, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  Paper, 
  Chip, 
  Alert,
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions,
  InputAdornment,
  Switch,
  FormControlLabel
} from '@mui/material';
import * as Icons from 'lucide-react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { useApp, API_BASE_URL } from '../context/AppContext';

// Time helpers copied from Attendance page
const parseTimeStr = (timeStr) => {
  if (!timeStr || timeStr === '--' || timeStr === '') return null;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const amp_pm = match[3];

  if (amp_pm) {
    if (amp_pm.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (amp_pm.toUpperCase() === 'AM' && hours === 12) hours = 0;
  }
  return hours + minutes / 60;
};

const getShiftHours = (inTime, outTime) => {
  const inVal = parseTimeStr(inTime);
  const outVal = parseTimeStr(outTime);
  if (inVal === null || outVal === null) return 0;
  const diff = outVal - inVal;
  return diff > 0 ? diff : 0;
};

const formatCurrency = (val) => {
  return Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const Salary = () => {
  const { user, token, moduleData, fetchModuleData, createRecord, updateRecord } = useApp();
  const location = useLocation();
  
  // Selection States
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1); // 1-12
  const [year, setYear] = useState(new Date().getFullYear());
  const [salaryStatus, setSalaryStatus] = useState('Draft');
  const [notes, setNotes] = useState('');

  // Overrides and Manual entries
  const [overtimeHours, setOvertimeHours] = useState(0);
  const [overtimeHourlyRate, setOvertimeHourlyRate] = useState(0);
  const [isOvertimeManual, setIsOvertimeManual] = useState(false);
  const [extraDaysOverride, setExtraDaysOverride] = useState(0);
  const [payPerKm, setPayPerKm] = useState(3);

  // Dynamic Lists
  const [allowances, setAllowances] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [expenses, setExpenses] = useState([]);

  // Advance Salary States
  const [advanceTaken, setAdvanceTaken] = useState(0);
  const [advanceDate, setAdvanceDate] = useState('');
  const [recoveryMonth, setRecoveryMonth] = useState('');
  const [recoveredAmount, setRecoveredAmount] = useState(0);
  const [advanceBalance, setAdvanceBalance] = useState(0);

  // Form input states for adding dynamic items
  const [newAllowName, setNewAllowName] = useState('');
  const [newAllowAmt, setNewAllowAmt] = useState('');
  const [newAllowRemarks, setNewAllowRemarks] = useState('');

  const [newDeductName, setNewDeductName] = useState('');
  const [newDeductAmt, setNewDeductAmt] = useState('');
  const [newDeductRemarks, setNewDeductRemarks] = useState('');

  const [newExpName, setNewExpName] = useState('');
  const [newExpDate, setNewExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [newExpAmt, setNewExpAmt] = useState('');
  const [newExpDesc, setNewExpDesc] = useState('');
  const [newExpApprovedBy, setNewExpApprovedBy] = useState('');

  // Loaded DB data
  const [salariesList, setSalariesList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load backend records on mount & selection
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([
        fetchModuleData('employees'),
        fetchModuleData('attendance'),
        fetchModuleData('leaves'),
        fetchModuleData('salaries')
      ]);
      setLoading(false);
    };
    loadAll();
  }, []);

  const employees = moduleData.employees || [];
  const attendanceList = moduleData.attendance || [];
  const leavesList = moduleData.leaves || [];
  const allSalaries = moduleData.salaries || [];

  // Determine current active employee selection
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const empIdParam = searchParams.get('employeeId');
    if (empIdParam && selectedEmpId !== empIdParam) {
      setSelectedEmpId(empIdParam);
    } else if (employees.length > 0 && !selectedEmpId) {
      if (user.role === 'Admin' || user.role === 'Manager') {
        setSelectedEmpId(employees[0].id);
      } else {
        setSelectedEmpId(user.id);
      }
    }
  }, [employees, selectedEmpId, user, location.search]);

  const selectedEmployeeObj = useMemo(() => {
    return employees.find(e => String(e.id) === String(selectedEmpId));
  }, [employees, selectedEmpId]);

  // Load existing salary record if already saved in db.json
  const existingSavedSalary = useMemo(() => {
    return allSalaries.find(s => 
      String(s.employeeId) === String(selectedEmpId) && 
      Number(s.month) === Number(month) && 
      Number(s.year) === Number(year)
    );
  }, [allSalaries, selectedEmpId, month, year]);

  // Set values from existing database record if it exists
  useEffect(() => {
    if (existingSavedSalary) {
      setSalaryStatus(existingSavedSalary.status || 'Draft');
      setNotes(existingSavedSalary.notes || '');
      setOvertimeHours(Number(existingSavedSalary.overtimeHours) || 0);
      setOvertimeHourlyRate(Number(existingSavedSalary.overtimeHourlyRate) || 0);
      setIsOvertimeManual(existingSavedSalary.isOvertimeManual || false);
      setExtraDaysOverride(Number(existingSavedSalary.extraDays) || 0);
      setPayPerKm(existingSavedSalary.payPerKm !== undefined ? Number(existingSavedSalary.payPerKm) : 3);
      
      try {
        setAllowances(JSON.parse(existingSavedSalary.allowancesJson || '[]'));
        setDeductions(JSON.parse(existingSavedSalary.deductionsJson || '[]'));
        setExpenses(JSON.parse(existingSavedSalary.expensesJson || '[]'));
      } catch (e) {
        console.error("Error parsing saved JSON strings", e);
      }

      setAdvanceTaken(Number(existingSavedSalary.advanceTaken) || 0);
      setAdvanceDate(existingSavedSalary.advanceDate || '');
      setRecoveryMonth(existingSavedSalary.recoveryMonth || '');
      setRecoveredAmount(Number(existingSavedSalary.advanceRecovery) || 0);
      setAdvanceBalance(Number(existingSavedSalary.advanceBalance) || 0);
    } else {
      // Reset form variables to default calculations
      setSalaryStatus('Draft');
      setNotes('');
      setOvertimeHours(0);
      setIsOvertimeManual(false);
      setExtraDaysOverride(0);
      setPayPerKm(3);
      setAllowances([]);
      setDeductions([]);
      setExpenses([]);
      setAdvanceTaken(0);
      setAdvanceDate('');
      setRecoveryMonth('');
      setRecoveredAmount(0);
      setAdvanceBalance(0);
    }
  }, [existingSavedSalary, selectedEmpId, month, year]);

  // Daily logs builder for selected Month (Always considered as 30 Days)
  const dailyLogs = useMemo(() => {
    if (!selectedEmployeeObj) return [];
    
    const logs = [];
    const daysInMonth = 30; // Every month is considered 30 days
    const dutyHours = Number(selectedEmployeeObj.dutyHours) || 8;

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dayName = new Date(year, month - 1, dayNum).toLocaleDateString('en-IN', { weekday: 'short' });
      
      // 1. Find attendance record
      const attRec = attendanceList.find(a => 
        String(a.employeeId) === String(selectedEmpId) && 
        a.date === dateStr
      );

      // 2. Find approved leaves
      const isLeaveApproved = leavesList.some(l => {
        if (String(l.employeeId) !== String(selectedEmpId) || l.status !== 'Approved') return false;
        const start = new Date(l.startDate);
        const end = new Date(l.endDate);
        const curr = new Date(dateStr);
        return curr >= start && curr <= end;
      });

      let checkIn = '--';
      let checkOut = '--';
      let status = 'Absent';
      let workHours = 0;
      let remarks = '';

      if (attRec) {
        checkIn = attRec.inTime || '--';
        checkOut = attRec.outTime || '--';
        workHours = getShiftHours(checkIn, checkOut);
        
        if (attRec.status === 'Absent') {
          status = 'Absent';
        } else if (attRec.status === 'Leave') {
          status = 'Leave';
        } else {
          if (dayName === 'Sun' || attRec.status === 'Extra Day') {
            if (workHours > 0 && workHours < 7) {
              status = 'Half Extra Day';
              remarks = 'Sunday Half Shift (0.5 Extra Day)';
            } else {
              status = 'Extra Day';
              remarks = 'Sunday/Extra Shift Duty';
            }
          } else {
            if (workHours > 0 && workHours < 7) {
              status = 'Half Day';
            } else {
              status = 'Present';
            }
          }
        }
      } else {
        if (isLeaveApproved) {
          status = 'Leave';
        } else {
          if (dayName === 'Sun') {
            status = 'Sunday';
            remarks = 'Weekly Off';
          } else {
            // Check if date is in the future
            const todayStr = new Date().toISOString().split('T')[0];
            if (dateStr > todayStr) {
              status = '--';
            } else {
              status = 'Absent';
              remarks = 'No Clock In (Auto Absent)';
            }
          }
        }
      }

      logs.push({
        date: `${String(dayNum).padStart(2, '0')} ${new Date(year, month - 1, dayNum).toLocaleDateString('en-IN', { month: 'short' })}`,
        day: dayName,
        checkIn,
        checkOut,
        hours: workHours > 0 ? `${Math.floor(workHours)}h ${Math.round((workHours % 1) * 60)}m` : '--',
        workHoursDecimal: workHours,
        status,
        remarks,
        odometerStart: attRec?.odometerStart,
        odometerStartPhoto: attRec?.odometerStartPhoto,
        odometerEnd: attRec?.odometerEnd,
        odometerEndPhoto: attRec?.odometerEndPhoto,
        personalUseKm: attRec?.personalUseKm,
        netKm: attRec?.netKm
      });
    }

    return logs;
  }, [selectedEmployeeObj, selectedEmpId, month, year, attendanceList, leavesList]);

  // Attendance metrics counts
  const attendanceCounts = useMemo(() => {
    let present = 0;
    let leaves = 0;
    let halfDays = 0;
    let absent = 0;
    let extra = 0;
    let sundays = 0;
    let future = 0;

    dailyLogs.forEach(log => {
      if (log.status === 'Present') present++;
      if (log.status === 'Leave') leaves++;
      if (log.status === 'Half Day') halfDays++;
      if (log.status === 'Absent') absent++;
      if (log.status === 'Extra Day') extra++;
      if (log.status === 'Half Extra Day') extra += 0.5;
      if (log.status === 'Sunday') sundays++;
      if (log.status === '--') future++;
    });

    return {
      presentDays: present,
      leaveDays: leaves,
      halfDays,
      absentDays: absent,
      extraDays: extra,
      sundayDays: sundays,
      futureDays: future
    };
  }, [dailyLogs]);

  // Financial Payroll calculations
  const payrollStats = useMemo(() => {
    if (!selectedEmployeeObj) return null;

    const baseSalary = Number(selectedEmployeeObj.salary) || 0;
    const dailyRate = baseSalary / 30;
    
    // Leaves deductions: 4 leaves permitted for free
    const paidLeavesUsed = Math.min(attendanceCounts.leaveDays, 4);

    // Calculate Earned Days: present weekdays + halfDays * 0.5 + paid leaves used + extra days worked + 4 (Weekly Off Sundays)
    const finalExtraDays = extraDaysOverride > 0 ? extraDaysOverride : attendanceCounts.extraDays;
    const isOffDutyFullMonth = attendanceCounts.presentDays === 0 && attendanceCounts.halfDays === 0 && paidLeavesUsed === 0 && finalExtraDays === 0;
    const earnedDays = isOffDutyFullMonth ? 0 : (
      attendanceCounts.presentDays + 
      (attendanceCounts.halfDays * 0.5) + 
      paidLeavesUsed + 
      finalExtraDays + 4
    );

    const earnedSalary = earnedDays * dailyRate;

    // Allowances, Deductions, Expenses totals
    const allowancesTotal = allowances.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const deductionsTotal = deductions.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const expensesReimbursement = expenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    // Travel Allowance based on Odometer final readings
    const totalKmDriven = dailyLogs.reduce((acc, log) => acc + (Number(log.netKm) || 0), 0);
    const travelAllowance = totalKmDriven * payPerKm;

    // Advance Recovery calculations
    const finalRecovery = Math.min(recoveredAmount, Math.max(0, advanceTaken - recoveredAmount));
    const finalBalance = Math.max(0, advanceTaken - finalRecovery);

    // Final Net salary settlement calculations (including Travel Allowance!)
    const netPay = Math.max(0, earnedSalary + allowancesTotal + expensesReimbursement - deductionsTotal - finalRecovery + travelAllowance);

    return {
      baseSalary,
      dailyRate,
      paidLeavesUsed,
      earnedDays,
      earnedSalary,
      allowancesTotal,
      deductionsTotal,
      expensesReimbursement,
      advanceRecovery: finalRecovery,
      advanceBalance: finalBalance,
      netPay,
      totalKmDriven,
      travelAllowance
    };
  }, [selectedEmployeeObj, attendanceCounts, allowances, deductions, expenses, extraDaysOverride, advanceTaken, recoveredAmount, dailyLogs, payPerKm]);

  // Sync state values on changes
  useEffect(() => {
    if (payrollStats) {
      setAdvanceBalance(payrollStats.advanceBalance);
    }
  }, [payrollStats]);

  // Handlers for Allowances list
  const addAllowance = () => {
    if (!newAllowName || !newAllowAmt) return;
    setAllowances(prev => [...prev, { name: newAllowName, amount: Number(newAllowAmt), remarks: newAllowRemarks }]);
    setNewAllowName('');
    setNewAllowAmt('');
    setNewAllowRemarks('');
  };

  const removeAllowance = (idx) => {
    setAllowances(prev => prev.filter((_, i) => i !== idx));
  };

  // Handlers for Deductions list
  const addDeduction = () => {
    if (!newDeductName || !newDeductAmt) return;
    setDeductions(prev => [...prev, { name: newDeductName, amount: Number(newDeductAmt), remarks: newDeductRemarks }]);
    setNewDeductName('');
    setNewDeductAmt('');
    setNewDeductRemarks('');
  };

  const removeDeduction = (idx) => {
    setDeductions(prev => prev.filter((_, i) => i !== idx));
  };

  // Handlers for Expenses list
  const addExpense = () => {
    if (!newExpName || !newExpAmt) return;
    setExpenses(prev => [...prev, { 
      name: newExpName, 
      date: newExpDate, 
      amount: Number(newExpAmt), 
      description: newExpDesc,
      approvedBy: newExpApprovedBy,
      status: 'Approved' 
    }]);
    setNewExpName('');
    setNewExpAmt('');
    setNewExpDesc('');
    setNewExpApprovedBy('');
  };

  const removeExpense = (idx) => {
    setExpenses(prev => prev.filter((_, i) => i !== idx));
  };

  // Save/Lock Salary slip to database
  const handleSaveSalary = async () => {
    if (!selectedEmployeeObj || !payrollStats) return;
    setLoading(true);

    const payload = {
      employeeId: selectedEmpId,
      month: Number(month),
      year: Number(year),
      baseSalary: Number(payrollStats.baseSalary.toFixed(2)),
      dailyRate: Number(payrollStats.dailyRate.toFixed(2)),
      presentDays: attendanceCounts.presentDays,
      leaveDays: attendanceCounts.leaveDays,
      paidLeavesUsed: payrollStats.paidLeavesUsed,
      chargeableLeaves: payrollStats.chargeableLeaves,
      halfDays: attendanceCounts.halfDays,
      absentDays: attendanceCounts.absentDays,
      extraDays: payrollStats.finalExtraDays,
      earnedDays: Number(payrollStats.earnedDays.toFixed(2)),
      earnedSalary: Number(payrollStats.earnedSalary.toFixed(2)),
      allowancesTotal: Number(payrollStats.allowancesTotal.toFixed(2)),
      expensesReimbursement: Number(payrollStats.expensesReimbursement.toFixed(2)),
      deductionsTotal: Number(payrollStats.deductionsTotal.toFixed(2)),
      leaveDeduction: Number((payrollStats.baseSalary - payrollStats.earnedSalary).toFixed(2)), // For backward compatibility/exports
      halfDayDeduction: Number((attendanceCounts.halfDays * 0.5 * payrollStats.dailyRate).toFixed(2)),
      absentDeduction: Number((attendanceCounts.absentDays * payrollStats.dailyRate).toFixed(2)),
      advanceRecovery: Number(payrollStats.advanceRecovery.toFixed(2)),
      netPay: Number(payrollStats.netPay.toFixed(2)),
      status: salaryStatus,
      notes,
      generatedDate: new Date().toLocaleDateString('en-IN'),
      allowancesJson: JSON.stringify(allowances),
      deductionsJson: JSON.stringify(deductions),
      expensesJson: JSON.stringify(expenses),
      attendanceJson: JSON.stringify(dailyLogs.map(l => ({
        date: l.date,
        day: l.day,
        checkIn: l.checkIn,
        checkOut: l.checkOut,
        hours: l.hours,
        status: l.status,
        remarks: l.remarks,
        odometerStart: l.odometerStart,
        odometerStartPhoto: l.odometerStartPhoto,
        odometerEnd: l.odometerEnd,
        odometerEndPhoto: l.odometerEndPhoto,
        personalUseKm: l.personalUseKm,
        netKm: l.netKm
      }))),
      // Advance tracking parameters saved
      advanceTaken: Number(advanceTaken),
      advanceDate,
      recoveryMonth,
      advanceBalance: payrollStats.advanceBalance,
      // Odometer tracking fields saved
      payPerKm: Number(payPerKm),
      travelAllowance: Number(payrollStats.travelAllowance || 0),
      totalKmDriven: Number(payrollStats.totalKmDriven || 0)
    };

    try {
      if (existingSavedSalary) {
        await updateRecord('salaries', existingSavedSalary.id, payload);
      } else {
        await createRecord('salaries', payload);
      }
      // Re-fetch database to refresh the cache
      await fetchModuleData('salaries');
      alert("Salary slip saved successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to save salary slip.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Box sx={{ p: { xs: 1, md: 3 }, pb: '100px', backgroundColor: '#F8FAFC' }}>
      
      {/* HEADER SECTION */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexDirection={{ xs: 'column', sm: 'row' }} gap={2}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#1E293B', fontFamily: 'Poppins' }}>
            Payroll & Settlements
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Review check-in history, adjust allowances, approve expenses, and generate printable salary receipts.
          </Typography>
        </Box>
        <Box display="flex" gap={1.5} width={{ xs: '100%', sm: 'auto' }} justifyContent="flex-end">
          <Button 
            variant="outlined" 
            startIcon={<Icons.Printer size={18} />} 
            onClick={handlePrint}
            sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600 }}
          >
            Print
          </Button>
          {(user.role === 'Admin' || user.role === 'Manager') && (
            <Button 
              variant="contained" 
              color="primary"
              startIcon={<Icons.Lock size={18} />}
              onClick={handleSaveSalary}
              sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1E40AF' } }}
            >
              Lock & Save Slip
            </Button>
          )}
        </Box>
      </Box>

      {/* FILTER & SELECTOR CARD */}
      <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}>
        <CardContent sx={{ p: 3 }}>
          <Grid container spacing={2} alignItems="center">
            
            {/* Employee dropdown selector */}
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Select Employee</InputLabel>
                <Select
                  value={selectedEmpId}
                  label="Select Employee"
                  disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                >
                  {employees.map(emp => (
                    <MenuItem key={emp.id} value={emp.id}>
                      {emp.name} ({emp.id}) - {emp.role}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Month selector */}
            <Grid item xs={6} sm={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Month</InputLabel>
                <Select
                  value={month}
                  label="Month"
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, idx) => (
                    <MenuItem key={idx + 1} value={idx + 1}>
                      {new Date(2026, idx).toLocaleString('en-IN', { month: 'long' })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Year selector */}
            <Grid item xs={6} sm={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Year</InputLabel>
                <Select
                  value={year}
                  label="Year"
                  onChange={(e) => setYear(Number(e.target.value))}
                >
                  {[2025, 2026, 2027].map(yr => (
                    <MenuItem key={yr} value={yr}>{yr}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Pay per KM rate config */}
            <Grid item xs={6} sm={2}>
              <TextField
                label="Pay per KM"
                size="small"
                type="number"
                fullWidth
                value={payPerKm}
                disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                onChange={(e) => setPayPerKm(Number(e.target.value) || 0)}
                InputProps={{
                  startAdornment: <span style={{ marginRight: '4px', color: '#94A3B8', fontSize: '13px' }}>₹</span>
                }}
              />
            </Grid>

            {/* Status controller */}
            {(user.role === 'Admin' || user.role === 'Manager') && (
              <Grid item xs={6} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Settlement Status</InputLabel>
                  <Select
                    value={salaryStatus}
                    label="Settlement Status"
                    onChange={(e) => setSalaryStatus(e.target.value)}
                  >
                    <MenuItem value="Draft">Draft 📝</MenuItem>
                    <MenuItem value="Approved">Approved ✅</MenuItem>
                    <MenuItem value="Rejected">Rejected ❌</MenuItem>
                    <MenuItem value="Hold">Hold ⏸️</MenuItem>
                    <MenuItem value="Locked">Locked 🔒</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            )}

          </Grid>
        </CardContent>
      </Card>

      {selectedEmployeeObj && payrollStats ? (
        <Grid container spacing={3}>
          
          {/* LEFT COLUMN: PARAMETER ADJUSTMENTS (ALLOWANCES, DEDUCTIONS, OVERTIMES) */}
          <Grid item xs={12} lg={8}>
            
            {/* OVERTIME & EXTRA DAYS OVERRIDES */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                  <Icons.Timer size={20} color="#2563EB" /> Overtime & Duty Overrides
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <TextField 
                      fullWidth
                      size="small"
                      type="number"
                      label="Override Extra Duty Days Worked"
                      helperText={`Default from clockings: ${attendanceCounts.extraDays} days`}
                      value={extraDaysOverride}
                      disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                      onChange={(e) => setExtraDaysOverride(Number(e.target.value))}
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* DYNAMIC ALLOWANCES GRID */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                  <Icons.PlusCircle size={20} color="#16A34A" /> Allowances Adjustments (Earned Bonuses)
                </Typography>
                
                {/* Form to add Allowance row */}
                {(user.role === 'Admin' || user.role === 'Manager') && (
                  <Box display="flex" gap={1.5} mb={3} flexWrap={{ xs: 'wrap', sm: 'nowrap' }}>
                    <TextField 
                      size="small"
                      placeholder="Allowance Name (e.g. Fuel, Travel)"
                      value={newAllowName}
                      onChange={(e) => setNewAllowName(e.target.value)}
                      sx={{ flexGrow: 2 }}
                    />
                    <TextField 
                      size="small"
                      type="number"
                      placeholder="Amount (INR)"
                      value={newAllowAmt}
                      onChange={(e) => setNewAllowAmt(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <TextField 
                      size="small"
                      placeholder="Remarks"
                      value={newAllowRemarks}
                      onChange={(e) => setNewAllowRemarks(e.target.value)}
                      sx={{ flexGrow: 2 }}
                    />
                    <Button 
                      variant="contained" 
                      onClick={addAllowance} 
                      sx={{ height: 40, textTransform: 'none', backgroundColor: '#16A34A', '&:hover': { backgroundColor: '#15803D' } }}
                    >
                      Add
                    </Button>
                  </Box>
                )}

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px' }}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Allowance Description</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Amount</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Remarks</TableCell>
                        {(user.role === 'Admin' || user.role === 'Manager') && <TableCell align="center" sx={{ fontWeight: 700 }}>Action</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {allowances.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} align="center" sx={{ py: 3, color: '#64748B' }}>
                            No custom bonuses/allowances added.
                          </TableCell>
                        </TableRow>
                      ) : (
                        allowances.map((allow, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{allow.name}</TableCell>
                            <TableCell align="right">₹{formatCurrency(allow.amount)}</TableCell>
                            <TableCell>{allow.remarks || '---'}</TableCell>
                            {(user.role === 'Admin' || user.role === 'Manager') && (
                              <TableCell align="center">
                                <IconButton color="error" size="small" onClick={() => removeAllowance(idx)}>
                                  <Icons.Trash2 size={16} />
                                </IconButton>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            {/* DYNAMIC DEDUCTIONS GRID */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                  <Icons.MinusCircle size={20} color="#DC2626" /> Custom Deductions (Fine, Uniform, ESI, PF)
                </Typography>

                {(user.role === 'Admin' || user.role === 'Manager') && (
                  <Box display="flex" gap={1.5} mb={3} flexWrap={{ xs: 'wrap', sm: 'nowrap' }}>
                    <TextField 
                      size="small"
                      placeholder="Deduction Name (e.g. Fine, uniform)"
                      value={newDeductName}
                      onChange={(e) => setNewDeductName(e.target.value)}
                      sx={{ flexGrow: 2 }}
                    />
                    <TextField 
                      size="small"
                      type="number"
                      placeholder="Amount (INR)"
                      value={newDeductAmt}
                      onChange={(e) => setNewDeductAmt(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <TextField 
                      size="small"
                      placeholder="Remarks"
                      value={newDeductRemarks}
                      onChange={(e) => setNewDeductRemarks(e.target.value)}
                      sx={{ flexGrow: 2 }}
                    />
                    <Button 
                      variant="contained" 
                      onClick={addDeduction}
                      sx={{ height: 40, textTransform: 'none', backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' } }}
                    >
                      Deduct
                    </Button>
                  </Box>
                )}

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px' }}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Deduction Description</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Amount</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Remarks</TableCell>
                        {(user.role === 'Admin' || user.role === 'Manager') && <TableCell align="center" sx={{ fontWeight: 700 }}>Action</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {deductions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} align="center" sx={{ py: 3, color: '#64748B' }}>
                            No custom deductions/fines added.
                          </TableCell>
                        </TableRow>
                      ) : (
                        deductions.map((ded, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{ded.name}</TableCell>
                            <TableCell align="right">₹{formatCurrency(ded.amount)}</TableCell>
                            <TableCell>{ded.remarks || '---'}</TableCell>
                            {(user.role === 'Admin' || user.role === 'Manager') && (
                              <TableCell align="center">
                                <IconButton color="error" size="small" onClick={() => removeDeduction(idx)}>
                                  <Icons.Trash2 size={16} />
                                </IconButton>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            {/* EXPENSE REIMBURSEMENTS GRID */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                  <Icons.Receipt size={20} color="#2563EB" /> Expense Reimbursements (Fuel, Travel, Client Visits)
                </Typography>

                {(user.role === 'Admin' || user.role === 'Manager') && (
                  <Box display="flex" gap={1.5} mb={3} flexWrap="wrap">
                    <TextField 
                      size="small"
                      placeholder="Expense Item (e.g. Fuel)"
                      value={newExpName}
                      onChange={(e) => setNewExpName(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <TextField 
                      size="small"
                      type="date"
                      value={newExpDate}
                      onChange={(e) => setNewExpDate(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <TextField 
                      size="small"
                      type="number"
                      placeholder="Amount (INR)"
                      value={newExpAmt}
                      onChange={(e) => setNewExpAmt(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <TextField 
                      size="small"
                      placeholder="Approved By"
                      value={newExpApprovedBy}
                      onChange={(e) => setNewExpApprovedBy(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <TextField 
                      size="small"
                      placeholder="Description"
                      value={newExpDesc}
                      onChange={(e) => setNewExpDesc(e.target.value)}
                      sx={{ flexGrow: 2 }}
                    />
                    <Button 
                      variant="contained" 
                      onClick={addExpense}
                      sx={{ height: 40, textTransform: 'none', backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1E40AF' } }}
                    >
                      Reimburse
                    </Button>
                  </Box>
                )}

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px' }}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Expense</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Amount</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Approved By</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                        {(user.role === 'Admin' || user.role === 'Manager') && <TableCell align="center" sx={{ fontWeight: 700 }}>Action</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {expenses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 3, color: '#64748B' }}>
                            No business expense reimbursements filed.
                          </TableCell>
                        </TableRow>
                      ) : (
                        expenses.map((exp, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{exp.name}</TableCell>
                            <TableCell>{exp.date}</TableCell>
                            <TableCell align="right">₹{formatCurrency(exp.amount)}</TableCell>
                            <TableCell>{exp.approvedBy || '---'}</TableCell>
                            <TableCell>{exp.description || '---'}</TableCell>
                            {(user.role === 'Admin' || user.role === 'Manager') && (
                              <TableCell align="center">
                                <IconButton color="error" size="small" onClick={() => removeExpense(idx)}>
                                  <Icons.Trash2 size={16} />
                                </IconButton>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            {/* ADVANCE SALARY SETTING */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                  <Icons.Undo size={20} color="#F59E0B" /> Advance Salary Recovery
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} sm={3}>
                    <TextField 
                      fullWidth
                      size="small"
                      type="number"
                      label="Advance Amount Taken"
                      value={advanceTaken}
                      disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                      onChange={(e) => setAdvanceTaken(Number(e.target.value))}
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField 
                      fullWidth
                      size="small"
                      type="date"
                      InputLabelProps={{ shrink: true }}
                      label="Advance Date"
                      value={advanceDate}
                      disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                      onChange={(e) => setAdvanceDate(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField 
                      fullWidth
                      size="small"
                      placeholder="e.g. July 2026"
                      label="Recovery Month"
                      value={recoveryMonth}
                      disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                      onChange={(e) => setRecoveryMonth(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField 
                      fullWidth
                      size="small"
                      type="number"
                      label="Recovered Amount (This Month)"
                      value={recoveredAmount}
                      disabled={user.role !== 'Admin' && user.role !== 'Manager'}
                      onChange={(e) => setRecoveredAmount(Number(e.target.value))}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Alert severity="info" icon={<Icons.AlertCircle size={18} />}>
                      Remaining Outstanding Balance: <strong>₹{formatCurrency(advanceBalance)}</strong>
                    </Alert>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* DAILY ATTENDANCE DETAILS ACCORDION GRID */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                  <Icons.CalendarRange size={20} color="#2563EB" /> Daily Attendance logs for {new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
                </Typography>
                
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px', maxHeight: 400, overflowY: 'auto' }}>
                  <Table size="small" stickyHeader>
                    <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Day</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Check In</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Check Out</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Hours</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Travel KM</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Remarks</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dailyLogs.map((log, idx) => (
                        <React.Fragment key={idx}>
                          <TableRow 
                            sx={{ 
                              backgroundColor: log.status === 'Absent' ? 'rgba(239, 68, 68, 0.02)' : log.status === 'Leave' ? 'rgba(245, 158, 11, 0.02)' : 'inherit'
                            }}
                          >
                            <TableCell sx={{ fontWeight: 600 }}>{log.date}</TableCell>
                            <TableCell>{log.day}</TableCell>
                            <TableCell>{log.checkIn}</TableCell>
                            <TableCell>{log.checkOut}</TableCell>
                            <TableCell>{log.hours}</TableCell>
                            <TableCell>
                              <Chip 
                                label={log.status} 
                                size="small" 
                                sx={{ 
                                  fontWeight: 700,
                                  fontSize: '10px',
                                  backgroundColor: log.status === 'Present' ? 'rgba(34,197,94,0.1)' : log.status === 'Extra Day' ? 'rgba(37,99,235,0.1)' : log.status === 'Half Day' ? 'rgba(245,158,11,0.1)' : log.status === 'Leave' ? 'rgba(100,116,139,0.1)' : 'rgba(239,68,68,0.1)',
                                  color: log.status === 'Present' ? '#22C55E' : log.status === 'Extra Day' ? '#2563EB' : log.status === 'Half Day' ? '#F59E0B' : log.status === 'Leave' ? '#64748B' : '#EF4444'
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700, color: (Number(log.netKm) || 0) > 0 ? '#16A34A' : '#0F172A' }}>
                              {(log.netKm !== undefined && log.netKm !== "") ? `${log.netKm} KM` : '---'}
                            </TableCell>
                            <TableCell sx={{ color: '#64748B', fontSize: '12px' }}>{log.remarks}</TableCell>
                          </TableRow>
                          {((log.odometerStart !== undefined && log.odometerStart !== "") || (log.odometerEnd !== undefined && log.odometerEnd !== "")) && (
                            <TableRow sx={{ backgroundColor: '#F8FAFC' }}>
                              <TableCell colSpan={8} align="left" sx={{ py: 0.5, pl: 4 }}>
                                <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600 }}>
                                  🏍️ Bike Odometer: Start: <strong>{(log.odometerStart !== undefined && log.odometerStart !== "") ? `${log.odometerStart} KM` : '0 KM'}</strong>
                                  {(log.odometerEnd !== undefined && log.odometerEnd !== "") ? ` | End: ${log.odometerEnd} KM` : ''}
                                  {(log.personalUseKm !== undefined && log.personalUseKm !== "") ? ` | Personal Use: ${log.personalUseKm} KM` : ''}
                                  {(log.netKm !== undefined && log.netKm !== "") ? ` | Final Reading: ${log.netKm} KM` : ''}
                                  {log.odometerStartPhoto && (
                                    <span> | <a href={log.odometerStartPhoto} target="_blank" rel="noreferrer" style={{ color: '#2563EB', textDecoration: 'underline' }}>View Start Pic</a></span>
                                  )}
                                  {log.odometerEndPhoto && (
                                    <span> | <a href={log.odometerEndPhoto} target="_blank" rel="noreferrer" style={{ color: '#2563EB', textDecoration: 'underline' }}>View End Pic</a></span>
                                  )}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

          </Grid>

          {/* RIGHT COLUMN: CALCULATION SUMMARY & PREVIEW SLIP */}
          <Grid item xs={12} lg={4}>
            
            {/* REAL-TIME CALCULATION SUMMARY */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)', color: '#FFFFFF', boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="subtitle2" sx={{ color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', mb: 1 }}>
                  Estimated Net Settlement
                </Typography>
                <Typography variant="h3" sx={{ fontWeight: 800, color: '#38BDF8', mb: 3, fontFamily: 'Poppins' }}>
                  ₹{formatCurrency(payrollStats.netPay)}
                </Typography>
                <Divider sx={{ borderColor: '#334155', mb: 2 }} />

                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Base Salary (Ref)</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(payrollStats.baseSalary)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Daily Rate (Salary/30)</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(payrollStats.dailyRate)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Total Earned Days</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#38BDF8' }}>{payrollStats.earnedDays} Days</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Earned Salary</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#22C55E' }}>₹{formatCurrency(payrollStats.earnedSalary)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Total Allowances</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#22C55E' }}>+ ₹{formatCurrency(payrollStats.allowancesTotal)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Expenses Reimbursed</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#22C55E' }}>+ ₹{formatCurrency(payrollStats.expensesReimbursement)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Travel Allowance ({payrollStats.totalKmDriven || 0} KM)</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#22C55E' }}>+ ₹{formatCurrency(payrollStats.travelAllowance || 0)}</Typography>
                </Box>
                
                <Divider sx={{ borderColor: '#334155', my: 1.5 }} />

                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Custom Deductions</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#F87171' }}>- ₹{formatCurrency(payrollStats.deductionsTotal)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1.5}>
                  <Typography variant="body2" sx={{ color: '#94A3B8' }}>Advance Recovered</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#F87171' }}>- ₹{formatCurrency(payrollStats.advanceRecovery)}</Typography>
                </Box>
              </CardContent>
            </Card>

            {/* PRESET INFORMATION STATS */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1E293B', mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Attendance Days Verification</span>
                  <Chip 
                    label="30 Days Total" 
                    size="small" 
                    sx={{ backgroundColor: '#EEF2F6', color: '#0F172A', fontWeight: 700, fontSize: '10px' }} 
                  />
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Full Days (Present)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#0F172A' }}>{attendanceCounts.presentDays} Days</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Half Days Worked</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#F59E0B' }}>{attendanceCounts.halfDays} Days</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Approved Leave Days</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#3B82F6' }}>{attendanceCounts.leaveDays} Days</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Absent Days (No In/Out)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#EF4444' }}>{attendanceCounts.absentDays} Days</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Sunday Weekly Offs</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#64748B' }}>{attendanceCounts.sundayDays} Days</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Extra Days Worked</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#10B981' }}>{attendanceCounts.extraDays} Days</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* ADMIN NOTES */}
            <Card sx={{ borderRadius: '16px', border: '1px solid #E2E8F0', mb: 3, boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1E293B', mb: 1.5 }}>
                  Settlement Notes & Audit logs
                </Typography>
                <TextField 
                  fullWidth
                  multiline
                  rows={3}
                  placeholder="Type any adjustments notes or special remarks..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </CardContent>
            </Card>

          </Grid>
          
        </Grid>
      ) : (
        <Typography variant="body1" align="center" sx={{ py: 6, color: '#64748B' }}>
          Loading employee details and clock logs...
        </Typography>
      )}

      {/* PRINT VIEW PORT (HIDDEN ON SCREEN) */}
      {selectedEmployeeObj && payrollStats && (
        <Box id="printable-salary-slip" sx={{ display: 'none', p: 4, fontFamily: 'Poppins, Arial', color: '#0F172A', backgroundColor: '#FFFFFF' }}>
          
          {/* Print Header */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={4} borderBottom="2px solid #0F172A" pb={3}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 850, letterSpacing: '-0.5px' }}>GAGAN REALTECH</Typography>
              <Typography variant="caption" color="textSecondary">Corporate Real Estate & CRM Solutions Hub</Typography>
            </Box>
            <Box textAlign="right">
              <Typography variant="h5" sx={{ fontWeight: 700, color: '#64748B' }}>SALARY PAYSLIP SLIP</Typography>
              <Typography variant="body2">Month: {new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</Typography>
            </Box>
          </Box>

          {/* Employee profile metadata grid */}
          <Grid container spacing={2} sx={{ mb: 4, backgroundColor: '#F8FAFC', p: 2, borderRadius: '8px' }}>
            <Grid item xs={6}>
              <Typography variant="caption" color="textSecondary">Employee Details</Typography>
              <Typography variant="body1" sx={{ fontWeight: 700 }}>{selectedEmployeeObj.name}</Typography>
              <Typography variant="body2">ID: {selectedEmployeeObj.id}</Typography>
              <Typography variant="body2">Designation: {selectedEmployeeObj.designation || 'Real Estate Officer'}</Typography>
            </Grid>
            <Grid item xs={6} style={{ textAlign: 'right' }}>
              <Typography variant="caption" color="textSecondary">Settlement Details</Typography>
              <Typography variant="body2">Date Issued: {new Date().toLocaleDateString('en-IN')}</Typography>
              <Typography variant="body2">Status: <strong>{salaryStatus}</strong></Typography>
              <Typography variant="body2">ID: {existingSavedSalary ? existingSavedSalary.id : 'DRAFT'}</Typography>
            </Grid>
          </Grid>

          {/* Earnings / Deductions breakdown tables */}
          <Grid container spacing={4} sx={{ mb: 4 }}>
            <Grid item xs={6}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, borderBottom: '1px solid #E2E8F0', pb: 0.5 }}>EARNING BREAKDOWN</Typography>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Daily Payout Rate (Salary/30)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(payrollStats.dailyRate)}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Paid Days: Full Work</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{attendanceCounts.presentDays} Days</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Paid Days: Half Work (0.5x)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{attendanceCounts.halfDays * 0.5} Days</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Paid Days: Paid Leaves</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{payrollStats.paidLeavesUsed} Days</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Paid Days: Weekly Offs (Sundays)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{payrollStats.earnedDays === 0 ? 0 : 4} Days</Typography>
              </Box>
              {payrollStats.earnedDays - (attendanceCounts.presentDays + attendanceCounts.halfDays*0.5 + payrollStats.paidLeavesUsed + 4) > 0 && (
                <Box display="flex" justifyContent="space-between" py={0.5}>
                  <Typography variant="body2">Paid Days: Extra Work</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{payrollStats.earnedDays - (attendanceCounts.presentDays + attendanceCounts.halfDays*0.5 + payrollStats.paidLeavesUsed + 4)} Days</Typography>
                </Box>
              )}
              <Box display="flex" justifyContent="space-between" py={0.5} sx={{ borderTop: '1px dashed #CBD5E1', mt: 0.5, pt: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Total Earned Salary ({payrollStats.earnedDays} days)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>₹{formatCurrency(payrollStats.earnedSalary)}</Typography>
              </Box>
              {allowances.map((a, i) => (
                <Box display="flex" justifyContent="space-between" py={0.5} key={i}>
                  <Typography variant="body2">{a.name} (Allowance)</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(a.amount)}</Typography>
                </Box>
              ))}
              {expenses.map((e, i) => (
                <Box display="flex" justifyContent="space-between" py={0.5} key={i}>
                  <Typography variant="body2">{e.name} (Reimbursement)</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(e.amount)}</Typography>
                </Box>
              ))}
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Travel Allowance ({payrollStats.totalKmDriven || 0} KM @ ₹{payPerKm || 3}/KM)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>+ ₹{formatCurrency(payrollStats.travelAllowance || 0)}</Typography>
              </Box>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, borderBottom: '1px solid #E2E8F0', pb: 0.5 }}>DEDUCTIONS BREAKDOWN</Typography>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Unpaid Leaves ({Math.max(0, attendanceCounts.leaveDays - 4)} days)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#EF4444' }}>Deducted from Earned Days</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Absent Days ({attendanceCounts.absentDays} days)</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#EF4444' }}>Deducted from Earned Days</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" py={0.5}>
                <Typography variant="body2">Advance Recovery</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(payrollStats.advanceRecovery)}</Typography>
              </Box>
              {deductions.map((d, i) => (
                <Box display="flex" justifyContent="space-between" py={0.5} key={i}>
                  <Typography variant="body2">{d.name}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>₹{formatCurrency(d.amount)}</Typography>
                </Box>
              ))}
            </Grid>
          </Grid>

          {/* NET PAYABLE BOX */}
          <Box sx={{ p: 3, border: '2px solid #0F172A', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 6 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>NET PAYABLE SETTLEMENT AMOUNT</Typography>
            <Typography variant="h4" sx={{ fontWeight: 850 }}>₹{formatCurrency(payrollStats.netPay)}</Typography>
          </Box>

          {/* Daily Attendance Logs for verification */}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, mt: 3, borderBottom: '1px solid #E2E8F0', pb: 0.5, textTransform: 'uppercase', fontSize: '11px' }}>
            DAILY ATTENDANCE & IN-OUT DETAILS
          </Typography>
          <TableContainer component={Box} sx={{ mb: 4, border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
            <Table size="small">
              <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                <TableRow>
                  <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Date</TableCell>
                  <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>In Time</TableCell>
                  <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Out Time</TableCell>
                  <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Hours</TableCell>
                  <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ py: 0.5, fontSize: '9px', fontWeight: 700 }}>Remarks</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dailyLogs.map((log, idx) => (
                  <TableRow key={idx} sx={{ '&:nth-of-type(odd)': { backgroundColor: '#F8FAFC' } }}>
                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.date} ({log.day})</TableCell>
                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.checkIn}</TableCell>
                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.checkOut}</TableCell>
                    <TableCell sx={{ py: 0.2, fontSize: '9px' }}>{log.hours}</TableCell>
                    <TableCell sx={{ py: 0.2, fontSize: '9px', fontWeight: log.status === 'Half Day' || log.status === 'Absent' ? 700 : 400, color: log.status === 'Half Day' ? '#F59E0B' : log.status === 'Absent' ? '#EF4444' : '#0F172A' }}>
                      {log.status}
                    </TableCell>
                    <TableCell sx={{ py: 0.2, fontSize: '9px', color: '#64748B' }}>{log.remarks}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Signatures placeholders */}
          <Box display="flex" justifyContent="space-between" mt={8} pt={4} borderTop="1px dashed #64748B">
            <Box textAlign="center" width="25%">
              <Box sx={{ height: 40 }} />
              <Divider sx={{ mb: 1, borderColor: '#0F172A' }} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>Employee Signature</Typography>
            </Box>
            <Box textAlign="center" width="25%">
              <Box sx={{ height: 40 }} />
              <Divider sx={{ mb: 1, borderColor: '#0F172A' }} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>HR Manager Signature</Typography>
            </Box>
            <Box textAlign="center" width="25%">
              <Box sx={{ height: 40 }} />
              <Divider sx={{ mb: 1, borderColor: '#0F172A' }} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>Authorised Signature</Typography>
            </Box>
          </Box>

        </Box>
      )}

      {/* Global CSS style block for printing A4 layout */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-salary-slip, #printable-salary-slip * {
            visibility: visible;
          }
          #printable-salary-slip {
            display: block !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>

    </Box>
  );
};

export default Salary;
