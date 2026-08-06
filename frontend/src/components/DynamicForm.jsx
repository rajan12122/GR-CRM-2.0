import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  TextField, 
  Button, 
  Box, 
  Paper,
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  FormHelperText,
  Grid,
  Chip,
  Switch,
  FormControlLabel,
  Typography,
  Alert,
  Autocomplete,
  InputAdornment
} from '@mui/material';
import axios from 'axios';
import { useApp, API_BASE_URL } from '../context/AppContext';
import { Home, Cpu } from 'lucide-react';
import VoiceInputButton from './VoiceInputButton';

const parseIndianNumber = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  
  let cleanStr = String(val).toLowerCase().replace(/,/g, '').trim();
  
  // Match Cr/Crore
  if (cleanStr.includes('cr') || cleanStr.includes('crore')) {
    const numPart = parseFloat(cleanStr.replace(/cr(ore)?/g, '').trim());
    if (!isNaN(numPart)) {
      return numPart * 10000000;
    }
  }
  
  // Match L/Lakh/Lac
  if (cleanStr.includes('lakh') || cleanStr.includes('lac') || cleanStr.match(/\bl\b/) || (cleanStr.endsWith('l') && !cleanStr.endsWith('al'))) {
    const numPart = parseFloat(cleanStr.replace(/lakh|lac|l/g, '').trim());
    if (!isNaN(numPart)) {
      return numPart * 100000;
    }
  }
  
  // Match k/thousand
  if (cleanStr.endsWith('k') || cleanStr.includes('thousand')) {
    const numPart = parseFloat(cleanStr.replace(/k|thousand/g, '').trim());
    if (!isNaN(numPart)) {
      return numPart * 1000;
    }
  }
  
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
};

const getSingularLabel = (label) => {
  if (!label) return '';
  if (label.toLowerCase() === 'queries') return 'Query';
  if (label.toLowerCase() === 'leaves') return 'Leave';
  if (label.toLowerCase() === 'attendance') return 'Attendance';
  if (label.endsWith('ies')) return label.slice(0, -3) + 'y';
  if (label.endsWith('s')) return label.slice(0, -1);
  return label;
};

const DynamicForm = ({ 
  open, 
  onClose, 
  moduleKey, 
  fields, 
  initialData, 
  onSubmit 
}) => {
  const { moduleData, fetchModuleData, metadata, createRecord, user } = useApp();
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [customValues, setCustomValues] = useState({});
  const [propSearch, setPropSearch] = useState('');
  const [dealerSearch, setDealerSearch] = useState('');

  const [rawText, setRawText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState(null);

  const handleParseAI = async () => {
    if (!rawText.trim()) {
      setParseMessage({ type: 'error', text: 'Please paste some text first.' });
      return;
    }
    setIsParsing(true);
    setParseMessage(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/ai/parse-wanted-text`, { rawText });
      if (res.data.parseFailed) {
        setParseMessage({ type: 'error', text: "Couldn't auto-detect details, please fill manually." });
      } else {
        const parsedData = res.data;
        const newFormData = { ...formData };
        if (parsedData.requirementType) newFormData.requirementType = parsedData.requirementType;
        if (parsedData.propertyType) newFormData.propertyType = parsedData.propertyType;
        if (parsedData.locality) newFormData.locality = parsedData.locality;
        if (parsedData.sizeRequired) newFormData.sizeRequired = parsedData.sizeRequired;
        if (parsedData.budget) newFormData.budget = parsedData.budget;
        if (parsedData.dealerContactNum) newFormData.dealerContactNum = parsedData.dealerContactNum;
        if (parsedData.dealerContactName) newFormData.dealerContactName = parsedData.dealerContactName;
        if (parsedData.dealerFirmName) newFormData.dealerFirmName = parsedData.dealerFirmName;
        if (parsedData.dealerAddress) newFormData.dealerAddress = parsedData.dealerAddress;
        
        newFormData.rawText = rawText;
        setFormData(newFormData);
        setParseMessage({ type: 'success', text: 'AI successfully extracted and filled fields!' });
      }
    } catch (err) {
      console.error(err);
      setParseMessage({ type: 'error', text: "Couldn't auto-detect details, please fill manually." });
    } finally {
      setIsParsing(false);
    }
  };

  // Inline creation states for property / project pitches
  const [nestedDealerData, setNestedDealerData] = useState({});
  const [nestedPropertyData, setNestedPropertyData] = useState({});
  const [nestedProjectData, setNestedProjectData] = useState({});
  const [pitchedItemType, setPitchedItemType] = useState('Property');

  // Dynamic field filtering based on leadType or queryType and dealer conditional checks
  const filteredFields = fields.filter(f => {
    let allowed = true;
    if (user && user.role !== 'Admin') {
      if (metadata?.userColumnPermissions?.[user.id]?.[moduleKey]) {
        const userOverriden = metadata.userColumnPermissions[user.id][moduleKey][f.name];
        if (userOverriden !== undefined) {
          allowed = userOverriden.includes('view');
        }
      } else if (metadata?.fieldPermissions?.[user.role]?.[moduleKey]) {
        allowed = metadata.fieldPermissions[user.role][moduleKey].includes(f.name);
      }
    }
    if (!allowed) return false;

    if (moduleKey === 'leads' || moduleKey === 'properties') {
      if (f.name === 'referrer_type') return false;
      if (f.name === 'referrer_id') {
        const src = formData.source || formData.lead_source;
        return ['Employee Referral', 'Client Referral', 'Dealer Referral'].includes(src);
      }
    }

    if (moduleKey === 'leads') {
      const type = formData.leadType;
      if (f.name === 'assignmentStatus' || f.name === 'assignmentTime' || f.name === 'droppedBy') {
        return false;
      }
      if (type === 'Buyer') {
        if (f.name === 'demand') return false;
      }
      if (type === 'Seller' || type === 'Seller Client') {
        if (f.name === 'budget') return false;
        if (f.name === 'demand') return false;
        const duplicateFields = [
          'r_c_i',
          'propertyType',
          'locality',
          'size',
          'bhk_and_washrooms',
          'sector_block',
          'facing',
          'bhk_and_washroom'
        ];
        if (duplicateFields.includes(f.name)) return false;
      }
    }
    if (moduleKey === 'queries') {
      const type = formData.queryType;
      if (f.name === 'title') {
        return type === 'Buy Property';
      }
      if (type === 'Buy Property') {
        if (f.name === 'demand') return false;
      }
      if (type === 'Sell Property') {
        if (f.name === 'budget') return false;
        const duplicateFields = [
          'r_c_i',
          'propertyType',
          'locality',
          'size',
          'bhk_and_washrooms',
          'sector_block',
          'facing',
          'bhk_and_washroom'
        ];
        if (duplicateFields.includes(f.name)) return false;
      }
    }
    if (moduleKey === 'properties') {
      if (f.name === 'current_owner_id') return false;
      if (f.name === 'contact_number') {
        return !(formData.dealer_owner_booked === 'Dealer' && formData.dealerId);
      }
      if (f.name === 'dealerId' || f.name === 'dealer_deal_type') {
        return formData.dealer_owner_booked === 'Dealer';
      }
      if (f.name === 'firm_name') {
        return formData.dealer_owner_booked === 'Dealer';
      }
      if (f.name === 'booked_by_customer_id') {
        return formData.dealer_owner_booked === 'Booked By Us';
      }
      if (f.name === 'land_type') {
        return false;
      }
      if (f.name === 'zone') {
        return formData.r_c_i === 'Land Parcel';
      }
      if (f.name === 'propertyType') {
        return true;
      }
    }
    if (moduleKey === 'wanted_properties') {
      if (f.name === 'matchedPropertyId') return false;
    }
    if (moduleKey === 'follow_ups') {
      if (f.name === 'queryId') return false;
      if (f.name === 'pipelineAction') {
        const cId = formData.customerId || initialData?.customerId;
        if (cId) {
          const lead = (moduleData.leads || []).find(l => String(l.id) === String(cId));
          if (lead && lead.leadType === 'Seller') return false;
          
          const cust = (moduleData.customers || []).find(c => String(c.id) === String(cId));
          if (cust) {
            const assocLead = (moduleData.leads || []).find(l => String(l.id) === String(cust.leadId));
            if (assocLead && assocLead.leadType === 'Seller') return false;
            if (cust.stage === 'Active Seller' || cust.stage === 'Converted Seller') return false;
          }
        }
      }
    }
    return true;
  });

  // Trigger references fetches on form open
  useEffect(() => {
    if (open) {
      setPropSearch('');
      setDealerSearch('');
      setRawText('');
      setIsParsing(false);
      setParseMessage(null);
      // Find all ref fields and load their databases
      fields.forEach(f => {
        if (f.type === 'ref' && f.refModule) {
          fetchModuleData(f.refModule);
        }
      });

      if (moduleKey === 'leads' || moduleKey === 'follow_ups' || moduleKey === 'queries') {
        fetchModuleData('projects');
      }
      if (moduleKey === 'leads') {
        fetchModuleData('employees');
        fetchModuleData('customers');
        fetchModuleData('dealers');
      }

      // Populate form data
      if (initialData) {
        const initialForm = {};
        const initialCustom = {};
        fields.forEach(f => {
          let val = initialData[f.name];
          if (f.type === 'date' && val) {
            // Convert d/m/yyyy to yyyy-MM-dd for HTML5 input
            const parts = String(val).split('/');
            if (parts.length === 3) {
              const d = parts[0].padStart(2, '0');
              const m = parts[1].padStart(2, '0');
              const y = parts[2];
              val = `${y}-${m}-${d}`;
            }
          }
          if ((val === undefined || val === null || String(val).trim() === '') && f.required && f.editable === false) {
            if (f.name === 'pitchDate') {
              val = new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN');
            } else if (f.name === 'dateAdded') {
              val = new Date().toISOString().split('T')[0];
            } else if (f.name === 'date' && f.type === 'date') {
              val = new Date().toISOString().split('T')[0];
            } else if (f.name === 'employeeName' && user?.name) {
              val = user.name;
            } else if (f.name === 'employeeId' && user?.id) {
              val = user.id;
            } else if (f.name === 'assignedEmployeeId' && user?.id) {
              val = user.id;
            }
          }
          if (f.type === 'select' && f.chipGroup && metadata?.chips[f.chipGroup]) {
            const options = metadata.chips[f.chipGroup];
            const hasOption = options.some(opt => opt.value === val);
            if (val && !hasOption) {
              initialForm[f.name] = 'Other';
              initialCustom[f.name] = val;
            } else {
              initialForm[f.name] = val || '';
            }
          } else if (f.type === 'ref' && f.refModule) {
            const options = moduleData[f.refModule] || [];
            const hasOption = options.some(opt => opt.id === val);
            if (val && !hasOption) {
              initialForm[f.name] = 'Other';
              initialCustom[f.name] = val;
            } else {
              initialForm[f.name] = val || '';
            }
          } else {
            initialForm[f.name] = val || '';
          }
        });
        if (initialData.size) {
          const sizeStr = String(initialData.size);
          const currentRCI = initialData.r_c_i || 'Residential';
          if (currentRCI === 'Land' || currentRCI === 'Land Parcel') {
            const parts = sizeStr.split(',').map(p => p.trim());
            const comp1Part = parts[0] || '';
            const comp2Part = parts[1] || '';
            const comp3Part = parts[2] || '';
            
            const match1 = comp1Part.match(/^([\d\.\w\s\-]+)\s+(Sq\.\s*ft\.|Sq\.\s*yd\.|Marla|Kanal|Acre)$/i);
            const match2 = comp2Part.match(/^([\d\.\w\s\-]+)\s+(Sq\.\s*ft\.|Sq\.\s*yd\.|Marla|Kanal|Acre)$/i);
            const match3 = comp3Part.match(/^([\d\.\w\s\-]+)\s+(Sq\.\s*ft\.|Sq\.\s*yd\.|Marla|Kanal|Acre)$/i);
            
            initialForm.size_comp1 = match1 ? match1[1] : '';
            initialForm.size_unit1 = match1 ? match1[2] : 'Acre';
            initialForm.size_comp2 = match2 ? match2[1] : '';
            initialForm.size_unit2 = match2 ? match2[2] : 'Kanal';
            initialForm.size_comp3 = match3 ? match3[1] : '';
            initialForm.size_unit3 = match3 ? match3[2] : 'Marla';
          } else {
            const match = sizeStr.match(/^([\d\.\w\s\-]+)\s+(Sq\.\s*ft\.|Sq\.\s*yd\.|Marla|Kanal|Acre)$/i);
            if (match) {
              initialForm.size_val = match[1];
              initialForm.size_unit = match[2];
            } else {
              initialForm.size_val = sizeStr;
              initialForm.size_unit = 'Sq. yd.';
            }
          }
        }
        setFormData(initialForm);
        setCustomValues(initialCustom);
        
        const pitchedVal = initialData.pitchedPropertyId || '';
        if (pitchedVal.startsWith('PROJ-')) {
          setPitchedItemType('Project');
        } else {
          setPitchedItemType('Property');
        }
      } else {
        const defaultForm = {};
        fields.forEach(f => {
          if (f.name === 'pitchDate') {
            defaultForm[f.name] = new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN');
          } else if (f.name === 'dateAdded') {
            defaultForm[f.name] = new Date().toISOString().split('T')[0];
          } else if (f.name === 'date' && f.type === 'date') {
            defaultForm[f.name] = new Date().toISOString().split('T')[0];
          } else if (f.name === 'employeeName' && user?.name) {
            defaultForm[f.name] = user.name;
          } else if (f.name === 'employeeId' && user?.id) {
            defaultForm[f.name] = user.id;
          } else if (f.name === 'assignedEmployeeId' && user?.id) {
            defaultForm[f.name] = user.id;
          } else if (f.name === 'dealer_owner_booked') {
            defaultForm[f.name] = 'Direct';
          } else if (moduleKey === 'tasks' && f.name === 'status') {
            defaultForm[f.name] = 'Pending';
          } else {
            defaultForm[f.name] = '';
          }
        });
        setFormData(defaultForm);
        setCustomValues({});
        setPitchedItemType('Property');
      }
      
      setNestedDealerData({
        firm_name: '',
        address: '',
        sector_block: '',
        person_name: '',
        contact_num: '',
        contacted_num: '',
        remarks: '',
        callOutcome: 'Call Done'
      });

      setNestedPropertyData({
        contact_person_name: '',
        contact_number: '',
        dealer_owner_booked: 'Direct',
        dealerId: '',
        dealer_deal_type: '',
        booked_by_customer_id: '',
        locality: '',
        sector_block: '',
        size: '',
        demand: '',
        propertyType: 'Plot',
        r_c_i: 'Residential',
        status: 'Available'
      });
      setNestedProjectData({
        name: '',
        builder: 'DLF Group',
        locality: '',
        sector_block: '',
        type: 'Residential',
        property_category: 'Plot',
        pricing_details: '',
        plc_percent: '',
        status: 'Under Construction'
      });
      
      setErrors({});
    }
  }, [open, initialData, fields, user]);

  useEffect(() => {
    if (open) {
      fetchModuleData('employees').catch(() => {});
      fetchModuleData('customers').catch(() => {});
      fetchModuleData('dealers').catch(() => {});
    }
  }, [open]);

  const isSellerLead = moduleKey === 'leads' && (formData.leadType === 'Seller' || formData.leadType === 'Seller Client');
  const isSellerQuery = moduleKey === 'queries' && formData.queryType === 'Sell Property';
  const showSellerPropertyForm = isSellerLead || isSellerQuery;

  useEffect(() => {
    if (showSellerPropertyForm) {
      let ownerName = formData.name || formData.person_name || '';
      let ownerPhone = formData.phone || formData.contact_num || '';
      
      if (formData.customerId) {
        const custs = moduleData.customers || [];
        const leadsList = moduleData.leads || [];
        const found = custs.find(c => String(c.id) === String(formData.customerId)) || leadsList.find(l => String(l.id) === String(formData.customerId));
        if (found) {
          ownerName = found.name || found.person_name || '';
          ownerPhone = found.phone || found.contact_num || '';
        }
      }

      setNestedPropertyData(prev => {
        const updated = { ...prev };
        if (!updated.contact_person_name || updated.contact_person_name === prev._lastSyncName) {
          updated.contact_person_name = ownerName;
          updated._lastSyncName = ownerName;
        }
        if (!updated.contact_number || updated.contact_number === prev._lastSyncPhone) {
          updated.contact_number = ownerPhone;
          updated._lastSyncPhone = ownerPhone;
        }
        return updated;
      });
    }
  }, [showSellerPropertyForm, formData.name, formData.person_name, formData.phone, formData.contact_num, formData.customerId, moduleData.customers, moduleData.leads]);

  const handleNestedPropertyChange = (name, val) => {
    setNestedPropertyData(prev => {
      const updated = { ...prev, [name]: val };
      if (name === 'dealerId') {
        const selectedDealer = (moduleData.dealers || []).find(d => String(d.id) === String(val));
        if (selectedDealer) {
          updated.firm_name = selectedDealer.firm_name || '';
          updated.contact_person_name = selectedDealer.person_name || '';
          updated.contact_number = selectedDealer.contact_num || '';
        }
      }
      if (name === 'dealer_owner_booked' && (val === 'Direct' || val === 'Owned')) {
        const ownerName = formData.name || formData.person_name || '';
        const ownerPhone = formData.phone || formData.contact_num || '';
        if (!updated.contact_person_name) {
          updated.contact_person_name = ownerName;
        }
        if (!updated.contact_number) {
          updated.contact_number = ownerPhone;
        }
      }
      return updated;
    });
  };

  const handleChange = (name, val, type) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        [name]: type === 'number' && val !== '' ? Number(val) : val
      };

      if (name === 'dealerId') {
        const selectedDealer = (moduleData.dealers || []).find(d => String(d.id) === String(val));
        if (selectedDealer) {
          updated.firm_name = selectedDealer.firm_name || '';
          updated.contact_person_name = selectedDealer.person_name || '';
          updated.contact_number = selectedDealer.contact_num || '';
        }
      }

      if (name === 'contact_number' || name === 'dealerContactNum') {
        const cleanVal = String(val).replace(/[^0-9]/g, '');
        if (cleanVal.length >= 10 && moduleData?.dealers) {
          const matchedDealer = moduleData.dealers.find(d => {
            const dealerPhone = String(d.contact_num || '').replace(/[^0-9]/g, '');
            return dealerPhone === cleanVal;
          });
          if (matchedDealer) {
            updated.dealerId = matchedDealer.id;
            if (name === 'contact_number') {
              if (matchedDealer.person_name && !updated.contact_person_name) {
                updated.contact_person_name = matchedDealer.person_name;
              }
              if (matchedDealer.firm_name && !updated.firm_name) {
                updated.firm_name = matchedDealer.firm_name;
              }
            } else if (name === 'dealerContactNum') {
              if (matchedDealer.person_name && !updated.dealerContactName) {
                updated.dealerContactName = matchedDealer.person_name;
              }
              if (matchedDealer.firm_name && !updated.dealerFirmName) {
                updated.dealerFirmName = matchedDealer.firm_name;
              }
              if (matchedDealer.address && !updated.dealerAddress) {
                updated.dealerAddress = matchedDealer.address;
              }
            }
          }
        }
      }

      return updated;
    });
    
    // Clear validation error on type
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleCustomChange = (name, val) => {
    setCustomValues(prev => ({
      ...prev,
      [name]: val
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors = {};
    filteredFields.forEach(f => {
      if (f.name === 'id' && !initialData) return; // Skip validation for auto-assigned ID
      
      if (f.required) {
        const val = formData[f.name];
        if (val === 'Other') {
          const custVal = customValues[f.name];
          if (!custVal || String(custVal).trim() === '') {
            newErrors[f.name] = `Please specify the custom ${f.label}.`;
          }
        } else if (val === undefined || val === null || String(val).trim() === '') {
          newErrors[f.name] = `${f.label} is required.`;
        }
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

   const resolvePitchedProperty = async (payload) => {
    if (payload.pitchedPropertyId === 'Other_Property') {
      let finalDealerId = nestedPropertyData.dealerId;
      if (nestedPropertyData.dealer_owner_booked === 'Dealer' && nestedPropertyData.dealerId === 'Other_Dealer') {
        const dealerRes = await createRecord('dealers', {
          ...nestedDealerData
        });
        if (dealerRes.success) {
          finalDealerId = dealerRes.data.id;
          fetchModuleData('dealers');
        } else {
          throw new Error(dealerRes.message || "Failed to auto-create associated dealer");
        }
      }
      const propRes = await createRecord('properties', {
        ...nestedPropertyData,
        dealerId: finalDealerId,
        date: new Date().toLocaleDateString('en-IN')
      });
      if (propRes.success) {
        payload.pitchedPropertyId = propRes.data.id;
        fetchModuleData('properties');
      } else {
        throw new Error(propRes.message || "Failed to auto-create pitched property");
      }
    } else if (payload.pitchedPropertyId === 'Other_Project') {
      const projRes = await createRecord('projects', {
        ...nestedProjectData
      });
      if (projRes.success) {
        payload.pitchedPropertyId = projRes.data.id;
        fetchModuleData('projects');
      } else {
        throw new Error(projRes.message || "Failed to auto-create pitched project");
      }
    }
    return payload;
  };

  const resolveDealerId = async (payload) => {
    if (moduleKey === 'properties' && payload.dealerId === 'Other_Dealer') {
      const dealerRes = await createRecord('dealers', {
        ...nestedDealerData
      });
      if (dealerRes.success) {
        payload.dealerId = dealerRes.data.id;
        fetchModuleData('dealers');
      } else {
        throw new Error(dealerRes.message || "Failed to auto-create associated dealer");
      }
    }
    return payload;
  };

  const resolveDirectSellerCustomer = async (payload) => {
    if (moduleKey === 'properties' && (payload.dealer_owner_booked === 'Direct' || payload.dealer_owner_booked === 'Owner' || !payload.dealer_owner_booked)) {
      payload.dealer_owner_booked = 'Direct';
      const name = payload.contact_person_name;
      const phone = payload.contact_number;
      if ((name || phone) && !payload.current_owner_id) {
        const cleanPhone = phone ? String(phone).trim() : '';
        const existing = (moduleData.customers || []).find(c => (cleanPhone && c.phone && String(c.phone).trim() === cleanPhone) || (name && c.name && c.name.toLowerCase() === name.toLowerCase()));
        if (existing) {
          payload.current_owner_id = existing.id;
          payload.booked_by_customer_id = existing.id;
        } else {
          const custRes = await createRecord('customers', {
            name: name || 'Direct Property Seller',
            phone: phone || '',
            city: payload.locality || '',
            stage: 'Active Seller',
            source: payload.source || 'Direct Property Seller',
            assignedEmployeeId: payload.assignedEmployeeId || user?.id || 'EMP-001',
            dateAdded: new Date().toISOString().split('T')[0]
          });
          if (custRes.success && custRes.data) {
            payload.current_owner_id = custRes.data.id;
            payload.booked_by_customer_id = custRes.data.id;
            fetchModuleData('customers');
          }
        }
      }
    }
    return payload;
  };

  const compileSize = (payload, isNested = false) => {
    const currentRCI = isNested ? nestedPropertyData.r_c_i : payload.r_c_i;
    if (currentRCI === 'Land' || currentRCI === 'Land Parcel') {
      const parts = [];
      const c1 = isNested ? nestedPropertyData.size_comp1 : payload.size_comp1;
      const u1 = isNested ? nestedPropertyData.size_unit1 : payload.size_unit1;
      const c2 = isNested ? nestedPropertyData.size_comp2 : payload.size_comp2;
      const u2 = isNested ? nestedPropertyData.size_unit2 : payload.size_unit2;
      const c3 = isNested ? nestedPropertyData.size_comp3 : payload.size_comp3;
      const u3 = isNested ? nestedPropertyData.size_unit3 : payload.size_unit3;
      
      if (c1) parts.push(`${c1} ${u1 || 'Acre'}`);
      if (c2) parts.push(`${c2} ${u2 || 'Kanal'}`);
      if (c3) parts.push(`${c3} ${u3 || 'Marla'}`);
      payload.size = parts.join(', ');
    } else {
      const val = isNested ? nestedPropertyData.size_val : payload.size_val;
      const unit = isNested ? nestedPropertyData.size_unit : payload.size_unit;
      payload.size = val ? `${val} ${unit || 'Sq. yd.'}` : '';
    }
    // Clean up temporary fields
    delete payload.size_val;
    delete payload.size_unit;
    delete payload.size_comp1;
    delete payload.size_unit1;
    delete payload.size_comp2;
    delete payload.size_unit2;
    delete payload.size_comp3;
    delete payload.size_unit3;
    return payload;
  };

  const resolveSellerProperty = async (payload) => {
    if (showSellerPropertyForm) {
      let finalDealerId = nestedPropertyData.dealerId;
      if (nestedPropertyData.dealer_owner_booked === 'Dealer' && nestedPropertyData.dealerId === 'Other_Dealer') {
        const dealerRes = await createRecord('dealers', {
          ...nestedDealerData
        });
        if (dealerRes.success) {
          finalDealerId = dealerRes.data.id;
          fetchModuleData('dealers');
        } else {
          throw new Error(dealerRes.message || "Failed to auto-create associated dealer");
        }
      }
      
      let nestedPayload = { ...nestedPropertyData };
      nestedPayload = compileSize(nestedPayload, true);
      const propPayload = {
        ...nestedPayload,
        source: formData.source || nestedPropertyData.source || 'Direct',
        dealer_owner_booked: nestedPropertyData.dealer_owner_booked || 'Direct',
        dealerId: finalDealerId,
        current_owner_id: payload.customerId || '',
        contact_person_name: nestedPropertyData.contact_person_name || payload.name || payload.person_name || '',
        contact_number: nestedPropertyData.contact_number || payload.phone || payload.contact_num || '',
        date: new Date().toLocaleDateString('en-IN')
      };
      
      const propRes = await createRecord('properties', propPayload);
      if (propRes.success) {
        payload.propertyId = propRes.data.id;
        payload.r_c_i = nestedPropertyData.r_c_i || '';
        payload.propertyType = nestedPropertyData.propertyType || '';
        payload.locality = nestedPropertyData.locality || '';
        payload.sector_block = nestedPropertyData.sector_block || '';
        payload.size = nestedPayload.size || '';
        payload.demand = nestedPropertyData.demand || '';
        payload.dealer_owner_booked = nestedPropertyData.dealer_owner_booked || 'Direct';
        fetchModuleData('properties');
      } else {
        throw new Error(propRes.message || "Failed to auto-create seller property");
      }
    }
    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validate()) {
      try {
        let payload = { ...formData };
        fields.forEach(f => {
          if ((f.type === 'select' || f.type === 'ref') && formData[f.name] === 'Other') {
            payload[f.name] = customValues[f.name] || '';
          }
          if (f.type === 'date' && payload[f.name]) {
            const dateVal = payload[f.name];
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
              const parts = dateVal.split('-');
              const y = parts[0];
              const m = String(parts[1]).padStart(2, '0');
              const d = String(parts[2]).padStart(2, '0');
              payload[f.name] = `${d}/${m}/${y}`;
            }
          }
        });
        payload = compileSize(payload, false);
        payload = await resolveDealerId(payload);
        payload = await resolveDirectSellerCustomer(payload);
        payload = await resolvePitchedProperty(payload);
        payload = await resolveSellerProperty(payload);
        onSubmit(payload);
      } catch (err) {
        setErrors({ submit: err.message });
      }
    }
  };

  const handleSaveAndAddAnother = async (e) => {
    e.preventDefault();
    if (validate()) {
      try {
        let payload = { ...formData };
        fields.forEach(f => {
          if ((f.type === 'select' || f.type === 'ref') && formData[f.name] === 'Other') {
            payload[f.name] = customValues[f.name] || '';
          }
          if (f.type === 'date' && payload[f.name]) {
            const dateVal = payload[f.name];
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
              const parts = dateVal.split('-');
              const y = parts[0];
              const m = String(parts[1]).padStart(2, '0');
              const d = String(parts[2]).padStart(2, '0');
              payload[f.name] = `${d}/${m}/${y}`;
            }
          }
        });
        payload = compileSize(payload, false);
        payload = await resolveDealerId(payload);
        payload = await resolveDirectSellerCustomer(payload);
        payload = await resolvePitchedProperty(payload);
        payload = await resolveSellerProperty(payload);
        
        const res = await createRecord(moduleKey, payload);
        if (res.success) {
          // Clear all fields to let user enter next property
          const defaultForm = {};
          fields.forEach(f => {
            defaultForm[f.name] = '';
          });
          setFormData(defaultForm);
          setCustomValues({});
          setErrors({});
          fetchModuleData(moduleKey);
        } else {
          setErrors({ submit: res.message || 'Failed to save record.' });
        }
      } catch (err) {
        setErrors({ submit: err.message });
      }
    }
  };

  // Helper to extract reference items (sorted in ascending order)
  const getReferenceOptions = (refModule) => {
    const raw = moduleData[refModule] || [];
    return [...raw].sort((a, b) => {
      const nameA = String(a.firm_name || a.person_name || a.name || a.propertyName || a.title || a.id || '');
      const nameB = String(b.firm_name || b.person_name || b.name || b.propertyName || b.title || b.id || '');
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        style: {
          borderRadius: 16,
          padding: '8px'
        }
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, fontSize: '20px', fontFamily: 'Poppins', pb: 1 }}>
        {initialData ? `Edit Record: ${initialData.id}` : `Register New ${getSingularLabel(metadata?.modules[moduleKey]?.label) || 'Record'}`}
      </DialogTitle>
      
      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ py: 2 }}>
          {errors.submit && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>
              {errors.submit}
            </Alert>
          )}
          {moduleKey === 'wanted_properties' && !initialData && (
            <Paper sx={{ p: 2.5, mb: 3, border: '1px solid #E2E8F0', borderRadius: '16px', backgroundColor: '#F8FAFC', boxShadow: 'none' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, fontFamily: 'Poppins', display: 'flex', alignItems: 'center', gap: 1, color: '#0F172A' }}>
                <Cpu size={18} color="#2563EB" />
                AI-Assisted WhatsApp Parsing
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 2 }}>
                Paste the WhatsApp message from the dealer below, then click "Parse with AI" to automatically fill the form fields.
              </Typography>
              <TextField
                label="Paste WhatsApp Message Here"
                multiline
                rows={3}
                fullWidth
                variant="outlined"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                sx={{ mb: 1.5, backgroundColor: 'white' }}
              />
              <Box display="flex" justifyContent="space-between" alignItems="center">
                {parseMessage && (
                  <Typography variant="caption" sx={{ color: parseMessage.type === 'error' ? '#EF4444' : '#16A34A', fontWeight: 600 }}>
                    {parseMessage.text}
                  </Typography>
                )}
                {!parseMessage && <span />}
                <Button
                  variant="contained"
                  size="small"
                  disabled={isParsing}
                  onClick={handleParseAI}
                  sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 700 }}
                >
                  {isParsing ? 'Parsing...' : 'Parse with AI'}
                </Button>
              </Box>
            </Paper>
          )}
          <Grid container spacing={2}>
            {filteredFields.map(f => {
              if (f.name === 'id' && !initialData) return null; // Hide auto-generated ID field on create
              
              // Primary keys or non-editable fields (like ID on edit) should be read-only
              let isReadOnly = f.editable === false;
              if (moduleKey === 'tasks' && f.name === 'status') {
                if (!initialData) {
                  isReadOnly = true;
                } else {
                  const isAssignee = user && String(user.id) === String(formData.assignedTo);
                  if (!isAssignee) {
                    isReadOnly = true;
                  }
                }
              }
              if (user && user.role !== 'Admin') {
                if (metadata?.userColumnPermissions?.[user.id]?.[moduleKey]) {
                  const userOverriden = metadata.userColumnPermissions[user.id][moduleKey][f.name];
                  if (userOverriden !== undefined) {
                    isReadOnly = isReadOnly || !userOverriden.includes('edit');
                  }
                }
              }

              // 0. MULTISELECT TEXT TYPE FIELD
              if (f.type === 'multiselect_text') {
                const currentVal = Array.isArray(formData[f.name]) 
                  ? formData[f.name] 
                  : (formData[f.name] ? String(formData[f.name]).split(',').map(s => s.trim()).filter(Boolean) : []);

                return (
                  <Grid item xs={12} sm={f.gridWidth || 6} key={f.name}>
                    <Autocomplete
                      multiple
                      freeSolo
                      options={[]}
                      value={currentVal}
                      disabled={isReadOnly}
                      onChange={(event, newValue) => {
                        handleFieldChange(f.name, newValue.join(','));
                      }}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip variant="outlined" label={option} {...getTagProps({ index })} />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          variant="outlined"
                          label={f.label}
                          placeholder="Type and press Enter"
                        />
                      )}
                    />
                  </Grid>
                );
              }

              // 1. SELECT TYPE FIELD
              if (f.type === 'select' && f.chipGroup && metadata?.chips[f.chipGroup]) {
                let options = metadata.chips[f.chipGroup];
                if (moduleKey === 'follow_ups') {
                  if (f.name === 'status') {
                    options = metadata?.chips?.followUpStatus || [];
                  } else if (f.name === 'pipelineAction') {
                    options = [
                      { value: 'None', label: 'Keep Current Stage', color: '#64748B' },
                      ...(metadata?.chips?.pipelineActionGroup || [])
                    ];
                  }
                }
                if (f.name === 'propertyType') {
                  const currentRCI = formData.r_c_i || 'Residential';
                  const mapping = {
                    Residential: ['Plots', 'LOI', 'Villa', 'Kothi', 'Apartment', 'Farm House', '25% Built Up Plot'],
                    Commercial: ['SCO Plot', 'SCO Builtup', 'SCO LOI', 'Bay Shop Plot', 'Bay Shop Builtup', 'Bay Shop LOI', 'Booth Plot', 'Booth Builtup', 'Booth LOI', 'Office Space', 'Hotel Site', 'Hotel Builtup', 'Restaurant'],
                    Industrial: ['Plot', 'Builtup', 'LOI', 'Floors', 'Factory', 'Operational Business'],
                    'Land Parcel': ['Private Land Under MC', 'Private Land Not Under MC', 'Lal Dora Land']
                  };
                  const allowed = mapping[currentRCI] || [];
                  options = allowed.map(val => ({
                    value: val,
                    label: val,
                    color: '#2563EB'
                  }));
                }
                const isOther = formData[f.name] === 'Other';
                return (
                  <Grid item xs={12} key={f.name}>
                    <FormControl 
                      fullWidth 
                      error={!!errors[f.name]}
                      size="medium"
                    >
                      <InputLabel>{f.label}</InputLabel>
                      <Select
                        label={f.label}
                        value={formData[f.name] || ''}
                        onChange={(e) => handleChange(f.name, e.target.value)}
                        disabled={isReadOnly}
                        renderValue={(selected) => {
                          if (!selected) return null;
                          let searchList = options;
                          if (moduleKey === 'follow_ups') {
                            if (f.name === 'status') {
                              searchList = [
                                ...(metadata?.chips?.followUpStatus || []),
                                ...(metadata?.chips?.callOutcomes || [])
                              ];
                            } else if (f.name === 'pipelineAction') {
                              searchList = [
                                ...(metadata?.chips?.pipelineActionGroup || []),
                                ...(metadata?.chips?.customerStages || [])
                              ];
                            }
                          }
                          const opt = searchList.find(o => String(o.value).toLowerCase() === String(selected).toLowerCase()) || { value: selected, label: selected };
                          const color = opt.color || '#475569';
                          const isFollowupHighlighted = moduleKey === 'follow_ups' && (f.name === 'status' || f.name === 'pipelineAction');
                          return (
                            <Chip 
                              label={opt.label || selected} 
                              size={isFollowupHighlighted ? "medium" : "small"} 
                              sx={{ 
                                height: isFollowupHighlighted ? 26 : 20, 
                                fontSize: isFollowupHighlighted ? '11px' : '10px', 
                                fontWeight: 700,
                                backgroundColor: isFollowupHighlighted ? color : `${color}15`,
                                color: isFollowupHighlighted ? '#FFFFFF' : color,
                                border: isFollowupHighlighted ? 'none' : `1px solid ${color}30`
                              }} 
                            />
                          );
                        }}
                      >
                        {options.map(opt => (
                          <MenuItem key={opt.value} value={opt.value} sx={{ color: opt.color || 'inherit', fontWeight: opt.color ? 700 : 'normal' }}>
                            {opt.label}
                          </MenuItem>
                        ))}
                        <MenuItem value="Other" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                          Other (Specify...)
                        </MenuItem>
                      </Select>
                      {errors[f.name] && <FormHelperText>{errors[f.name]}</FormHelperText>}
                    </FormControl>

                    {isOther && (
                      <TextField
                        fullWidth
                        multiline
                        rows={2}
                        label={`Specify Custom ${f.label}`}
                        value={customValues[f.name] || ''}
                        onChange={(e) => handleCustomChange(f.name, e.target.value)}
                        placeholder="Type custom details here..."
                        sx={{ mt: 1.5 }}
                        required
                      />
                    )}
                  </Grid>
                );
              }

              // 2. REFERENCE TYPE FIELD (Lookups)
              if (f.type === 'ref' && f.refModule) {
                if (f.name === 'pitchedPropertyId') {
                  const propertiesList = moduleData.properties || [];
                  const projectsList = moduleData.projects || [];
                  
                  return (
                    <Grid item xs={12} key={f.name}>
                      <Box sx={{ p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', mb: 1, backgroundColor: '#F8FAFC' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, color: '#1E293B' }}>
                          Outreach Property/Project Pitch
                        </Typography>
                        
                        <Grid container spacing={2}>
                          <Grid item xs={12} sm={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Pitch Item Type</InputLabel>
                              <Select
                                value={pitchedItemType}
                                onChange={(e) => {
                                  setPitchedItemType(e.target.value);
                                  handleChange('pitchedPropertyId', '');
                                }}
                                label="Pitch Item Type"
                              >
                                <MenuItem value="Property">Property Listing</MenuItem>
                                <MenuItem value="Project">Builder Project</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          
                          <Grid item xs={12} sm={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>{pitchedItemType === 'Property' ? 'Select Property' : 'Select Project'}</InputLabel>
                              <Select
                                value={formData.pitchedPropertyId || ''}
                                onChange={(e) => handleChange('pitchedPropertyId', e.target.value)}
                                label={pitchedItemType === 'Property' ? 'Select Property' : 'Select Project'}
                              >
                                <MenuItem
                                  disableRipple
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  sx={{ 
                                    backgroundColor: 'transparent !important', 
                                    cursor: 'default',
                                    p: '4px 16px',
                                    '&:hover': { backgroundColor: 'transparent' }
                                  }}
                                >
                                  <TextField
                                    size="small"
                                    placeholder={pitchedItemType === 'Property' ? "Search properties..." : "Search projects..."}
                                    fullWidth
                                    value={propSearch}
                                    onChange={(e) => setPropSearch(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  />
                                </MenuItem>
                                <MenuItem value="">-- None --</MenuItem>
                                {pitchedItemType === 'Property' ? (
                                  propertiesList.filter(p => {
                                    if (!propSearch) return true;
                                    const searchStr = `${p.locality} {p.sector_block ? \`Sector \${p.sector_block}\` : ''} \${p.id}`.toLowerCase();
                                    return searchStr.includes(propSearch.toLowerCase());
                                  }).map(p => (
                                    <MenuItem key={p.id} value={p.id}>
                                      {p.locality} {p.sector_block ? `(Sector ${p.sector_block})` : ''} - ₹{p.demand} ({p.id})
                                    </MenuItem>
                                  ))
                                ) : (
                                  projectsList.filter(p => {
                                    if (!propSearch) return true;
                                    const searchStr = `${p.name} \${p.locality} \${p.id}`.toLowerCase();
                                    return searchStr.includes(propSearch.toLowerCase());
                                  }).map(p => (
                                    <MenuItem key={p.id} value={p.id}>
                                      {p.name} - {p.locality} ({p.id})
                                    </MenuItem>
                                  ))
                                )}
                                <MenuItem value={pitchedItemType === 'Property' ? 'Other_Property' : 'Other_Project'} sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                  + Create New {pitchedItemType === 'Property' ? 'Property' : 'Project'}...
                                </MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>

                          {/* Inline Nested Property Form */}
                          {formData.pitchedPropertyId === 'Other_Property' && (
                            <Grid item xs={12}>
                              <Box sx={{ mt: 1, p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', backgroundColor: '#FFFFFF' }}>
                                <Typography variant="caption" sx={{ fontWeight: 800, mb: 1.5, display: 'block', color: '#64748B', textTransform: 'uppercase' }}>
                                  Create New Property Detail
                                </Typography>
                                <Grid container spacing={1.5}>
                                  {nestedPropertyData.dealer_owner_booked !== 'Dealer' && (
                                    <>
                                      <Grid item xs={12} sm={6}>
                                        <TextField label="Contact Person Name" size="small" fullWidth value={nestedPropertyData.contact_person_name || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, contact_person_name: e.target.value }))} />
                                      </Grid>
                                      <Grid item xs={12} sm={6}>
                                        <TextField label="Contact Number" size="small" fullWidth value={nestedPropertyData.contact_number || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, contact_number: e.target.value }))} />
                                      </Grid>
                                    </>
                                  )}
                                  <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Dealer/Booked/Owned</InputLabel>
                                      <Select
                                        value={nestedPropertyData.dealer_owner_booked || 'Owned'}
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, dealer_owner_booked: e.target.value }))}
                                        label="Dealer/Booked/Owned"
                                      >
                        <MenuItem value="Dealer">Dealer</MenuItem>
                                        <MenuItem value="Booked">Booked</MenuItem>
                                        <MenuItem value="Owned">Owned</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>

                                  {nestedPropertyData.dealer_owner_booked === 'Dealer' && (
                                    <>
                                      <Grid item xs={12} sm={6}>
                                        <FormControl fullWidth size="small">
                                          <InputLabel>Associated Dealer</InputLabel>
                                          <Select
                                            value={nestedPropertyData.dealerId || ''}
                                            onChange={(e) => handleNestedPropertyChange('dealerId', e.target.value)}
                                            label="Associated Dealer"
                                          >
                                            <MenuItem value="">-- Select --</MenuItem>
                                            {(moduleData.dealers || []).map(d => (
                                              <MenuItem key={d.id} value={d.id}>{d.firm_name} ({d.id})</MenuItem>
                                            ))}
                                            <MenuItem value="Other_Dealer" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                              + Add New Property Dealer
                                            </MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>

                                      <Grid item xs={12} sm={6}>
                                        <TextField 
                                          label="Firm Name" 
                                          size="small" 
                                          fullWidth 
                                          value={nestedPropertyData.firm_name || ''} 
                                          onChange={(e) => handleNestedPropertyChange('firm_name', e.target.value)} 
                                        />
                                      </Grid>

                                      {(() => {
                                        const selectedDealer = (moduleData.dealers || []).find(d => String(d.id) === String(nestedPropertyData.dealerId));
                                        let contactPersonsList = [];
                                        if (selectedDealer) {
                                          try {
                                            let cp = selectedDealer.contact_persons;
                                            if (typeof cp === 'string') cp = JSON.parse(cp);
                                            if (Array.isArray(cp)) contactPersonsList = cp;
                                          } catch (e) {}
                                        }

                                        if (contactPersonsList.length > 0) {
                                          return (
                                            <Grid item xs={12}>
                                              <FormControl fullWidth size="small">
                                                <InputLabel>Select Existing Contact Person</InputLabel>
                                                <Select
                                                  label="Select Existing Contact Person"
                                                  value={nestedPropertyData.contact_person_name || ''}
                                                  onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (val === 'CUSTOM_NEW') {
                                                      handleNestedPropertyChange('contact_person_name', '');
                                                      handleNestedPropertyChange('contact_number', '');
                                                    } else {
                                                      const matched = contactPersonsList.find(p => p.name === val);
                                                      if (matched) {
                                                        handleNestedPropertyChange('contact_person_name', matched.name);
                                                        handleNestedPropertyChange('contact_number', matched.phone);
                                                      } else {
                                                        handleNestedPropertyChange('contact_person_name', val);
                                                      }
                                                    }
                                                  }}
                                                >
                                                  <MenuItem value="CUSTOM_NEW" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                                    + Add/Write Custom Contact Person...
                                                  </MenuItem>
                                                  {contactPersonsList.map(person => (
                                                    <MenuItem key={person.phone} value={person.name}>
                                                      {person.name} ({person.phone})
                                                    </MenuItem>
                                                  ))}
                                                </Select>
                                              </FormControl>
                                            </Grid>
                                          );
                                        }
                                        return null;
                                      })()}

                                      <Grid item xs={12} sm={6}>
                                        <TextField 
                                          label="Contact Person Name" 
                                          size="small" 
                                          fullWidth 
                                          value={nestedPropertyData.contact_person_name || ''} 
                                          onChange={(e) => handleNestedPropertyChange('contact_person_name', e.target.value)} 
                                        />
                                      </Grid>

                                      <Grid item xs={12} sm={6}>
                                        <TextField 
                                          label="Contact Number" 
                                          size="small" 
                                          fullWidth 
                                          value={nestedPropertyData.contact_number || ''} 
                                          onChange={(e) => handleNestedPropertyChange('contact_number', e.target.value)} 
                                        />
                                      </Grid>

                                      <Grid item xs={12} sm={6}>
                                        <FormControl fullWidth size="small">
                                          <InputLabel>Dealer Deal Type</InputLabel>
                                          <Select
                                            value={nestedPropertyData.dealer_deal_type || ''}
                                            onChange={(e) => handleNestedPropertyChange('dealer_deal_type', e.target.value)}
                                            label="Dealer Deal Type"
                                          >
                                            <MenuItem value="Dealer To Dealer">Dealer To Dealer</MenuItem>
                                            <MenuItem value="Direct">Direct</MenuItem>
                                            <MenuItem value="Booked">Booked</MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>
                                      
                                      {nestedPropertyData.dealerId === 'Other_Dealer' && (
                                        <Grid item xs={12}>
                                          <Paper sx={{ p: 2, border: '1px solid #3B82F6', borderRadius: '12px', backgroundColor: '#EFF6FF', boxShadow: 'none' }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, color: '#1E3A8A' }}>
                                              Create New Property Dealer
                                            </Typography>
                                            <Grid container spacing={1.5}>
                                              <Grid item xs={12} sm={6}>
                                                <TextField label="Firm Name" size="small" fullWidth required value={nestedDealerData.firm_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, firm_name: e.target.value }))} />
                                              </Grid>
                                              <Grid item xs={12} sm={6}>
                                                <TextField label="Person Name" size="small" fullWidth required value={nestedDealerData.person_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, person_name: e.target.value }))} />
                                              </Grid>
                                              <Grid item xs={12} sm={6}>
                                                <TextField label="Contact Number" size="small" fullWidth required value={nestedDealerData.contact_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contact_num: e.target.value }))} />
                                              </Grid>
                                              <Grid item xs={12} sm={6}>
                                                <TextField label="Contacted Number" size="small" fullWidth value={nestedDealerData.contacted_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contacted_num: e.target.value }))} />
                                              </Grid>
                                              <Grid item xs={12} sm={6}>
                                                <TextField label="Area/Sector/Block" size="small" fullWidth required value={nestedDealerData.sector_block || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, sector_block: e.target.value }))} />
                                              </Grid>
                                              <Grid item xs={12} sm={6}>
                                                <TextField label="Address" size="small" fullWidth value={nestedDealerData.address || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, address: e.target.value }))} />
                                              </Grid>
                                              <Grid item xs={12}>
                                                <TextField label="Call Notes/Remarks" size="small" fullWidth multiline rows={2} value={nestedDealerData.remarks || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, remarks: e.target.value }))} />
                                              </Grid>
                                            </Grid>
                                          </Paper>
                                        </Grid>
                                      )}
                                    </>
                                  )}

                                  {nestedPropertyData.dealer_owner_booked === 'Booked By Us' && (
                                    <Grid item xs={12} sm={6}>
                                      <FormControl fullWidth size="small">
                                        <InputLabel>Booked By (Customer)</InputLabel>
                                        <Select
                                          value={nestedPropertyData.booked_by_customer_id || ''}
                                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, booked_by_customer_id: e.target.value }))}
                                          label="Booked By (Customer)"
                                        >
                                          <MenuItem value="">-- Select --</MenuItem>
                                          {(moduleData.customers || []).map(c => (
                                            <MenuItem key={c.id} value={c.id}>{c.name} ({c.id})</MenuItem>
                                          ))}
                                        </Select>
                                      </FormControl>
                                    </Grid>
                                  )}

                                  <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>R/C/I Segment</InputLabel>
                                      <Select
                                        value={nestedPropertyData.r_c_i || 'Residential'}
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, r_c_i: e.target.value }))}
                                        label="R/C/I Segment"
                                      >
                                        <MenuItem value="Residential">Residential</MenuItem>
                                        <MenuItem value="Commercial">Commercial</MenuItem>
                                        <MenuItem value="Industrial">Industrial</MenuItem>
                                        <MenuItem value="Land Parcel">Land Parcel</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>

                                  {nestedPropertyData.r_c_i === 'Land Parcel' && (
                                    <Grid item xs={12} sm={6}>
                                      <FormControl fullWidth size="small">
                                        <InputLabel>Zone</InputLabel>
                                        <Select
                                          value={nestedPropertyData.zone || ''}
                                          onChange={(e) => setNestedPropertyData(prev => ({ ...prev, zone: e.target.value }))}
                                          label="Zone"
                                        >
                                          {['Land Zone', 'R Zone', 'Agriculture Land', 'Baghleani', 'Commercial', 'Industrial'].map(z => (
                                            <MenuItem key={z} value={z}>{z}</MenuItem>
                                          ))}
                                        </Select>
                                      </FormControl>
                                    </Grid>
                                  )}

                                  <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Property Type</InputLabel>
                                      <Select
                                        value={nestedPropertyData.propertyType || ''}
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, propertyType: e.target.value }))}
                                        label="Property Type"
                                      >
                                        {(() => {
                                          const currentRCI = nestedPropertyData.r_c_i || 'Residential';
                                          const mapping = {
                                            Residential: ['Plots', 'LOI', 'Villa', 'Kothi', 'Apartment', 'Farm House', '25% Built Up Plot'],
                                            Commercial: ['SCO Plot', 'SCO Builtup', 'SCO LOI', 'Bay Shop Plot', 'Bay Shop Builtup', 'Bay Shop LOI', 'Booth Plot', 'Booth Builtup', 'Booth LOI', 'Office Space', 'Hotel Site', 'Hotel Builtup', 'Restaurant'],
                                            Industrial: ['Plot', 'Builtup', 'LOI', 'Floors', 'Factory', 'Operational Business'],
                                            'Land Parcel': ['Private Land Under MC', 'Private Land Not Under MC', 'Lal Dora Land']
                                          };
                                          const allowed = mapping[currentRCI] || [];
                                          return [
                                            ...allowed.map(val => <MenuItem key={val} value={val}>{val}</MenuItem>),
                                            <MenuItem key="Other" value="Other">Other</MenuItem>
                                          ];
                                        })()}
                                      </Select>
                                    </FormControl>
                                  </Grid>

                                  {nestedPropertyData.propertyType === 'Showroom' && (
                                    <Grid item xs={12} sm={6}>
                                      <TextField 
                                        label="No. of Floors" 
                                        size="small" 
                                        fullWidth 
                                        value={nestedPropertyData.no_of_floors || ''} 
                                        onChange={(e) => setNestedPropertyData(prev => ({ ...prev, no_of_floors: e.target.value }))} 
                                      />
                                    </Grid>
                                  )}

                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Locality" size="small" fullWidth value={nestedPropertyData.locality || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, locality: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Sector/Block" size="small" fullWidth value={nestedPropertyData.sector_block || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, sector_block: e.target.value }))} />
                                  </Grid>

                                  {(() => {
                                    const currentRCI = nestedPropertyData.r_c_i || 'Residential';
                                    const units = ['Sq. ft.', 'Sq. yd.', 'Marla', 'Kanal', 'Acre'];
                                    if (currentRCI === 'Land' || currentRCI === 'Land Parcel') {
                                      return (
                                        <Grid item xs={12}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, mb: 1, display: 'block', color: '#475569' }}>
                                            Property Size (Land Components)
                                          </Typography>
                                          <Grid container spacing={1}>
                                            <Grid item xs={4}>
                                              <Box display="flex" gap={0.5}>
                                                <TextField 
                                                  label="Size 1" 
                                                  size="small" 
                                                  value={nestedPropertyData.size_comp1 || ''} 
                                                  onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_comp1: e.target.value }))} 
                                                />
                                                <FormControl size="small" fullWidth>
                                                  <Select 
                                                    value={nestedPropertyData.size_unit1 || 'Acre'} 
                                                    onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit1: e.target.value }))}
                                                  >
                                                    {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                                  </Select>
                                                </FormControl>
                                              </Box>
                                            </Grid>
                                            <Grid item xs={4}>
                                              <Box display="flex" gap={0.5}>
                                                <TextField 
                                                  label="Size 2" 
                                                  size="small" 
                                                  value={nestedPropertyData.size_comp2 || ''} 
                                                  onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_comp2: e.target.value }))} 
                                                />
                                                <FormControl size="small" fullWidth>
                                                  <Select 
                                                    value={nestedPropertyData.size_unit2 || 'Kanal'} 
                                                    onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit2: e.target.value }))}
                                                  >
                                                    {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                                  </Select>
                                                </FormControl>
                                              </Box>
                                            </Grid>
                                            <Grid item xs={4}>
                                              <Box display="flex" gap={0.5}>
                                                <TextField 
                                                  label="Size 3" 
                                                  size="small" 
                                                  value={nestedPropertyData.size_comp3 || ''} 
                                                  onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_comp3: e.target.value }))} 
                                                />
                                                <FormControl size="small" fullWidth>
                                                  <Select 
                                                    value={nestedPropertyData.size_unit3 || 'Marla'} 
                                                    onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit3: e.target.value }))}
                                                  >
                                                    {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                                  </Select>
                                                </FormControl>
                                              </Box>
                                            </Grid>
                                          </Grid>
                                        </Grid>
                                      );
                                    } else {
                                      return (
                                        <Grid item xs={12} sm={6}>
                                          <Box display="flex" gap={1} alignItems="flex-start">
                                            <TextField 
                                              label="Property Size" 
                                              size="small"
                                              fullWidth 
                                              value={nestedPropertyData.size_val || ''} 
                                              onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_val: e.target.value }))} 
                                            />
                                            <FormControl size="small" style={{ minWidth: 100 }}>
                                              <InputLabel>Unit</InputLabel>
                                              <Select 
                                                value={nestedPropertyData.size_unit || 'Sq. yd.'} 
                                                onChange={(e) => setNestedPropertyData(prev => ({ ...prev, size_unit: e.target.value }))}
                                                label="Unit"
                                              >
                                                {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                              </Select>
                                            </FormControl>
                                          </Box>
                                        </Grid>
                                      );
                                    }
                                  })()}

                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Demand (Price)" size="small" fullWidth value={nestedPropertyData.demand || ''} onChange={(e) => setNestedPropertyData(prev => ({ ...prev, demand: e.target.value }))} />
                                  </Grid>
                                </Grid>
                              </Box>
                            </Grid>
                          )}

                          {/* Inline Nested Project Form */}
                          {formData.pitchedPropertyId === 'Other_Project' && (
                            <Grid item xs={12}>
                              <Box sx={{ mt: 1, p: 2, border: '1px solid #E2E8F0', borderRadius: '12px', backgroundColor: '#FFFFFF' }}>
                                <Typography variant="caption" sx={{ fontWeight: 800, mb: 1.5, display: 'block', color: '#64748B', textTransform: 'uppercase' }}>
                                  Create New Project Detail
                                </Typography>
                                <Grid container spacing={1.5}>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Project Name" size="small" fullWidth value={nestedProjectData.name || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, name: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Developer</InputLabel>
                                      <Select
                                        value={nestedProjectData.builder || 'DLF Group'}
                                        onChange={(e) => setNestedProjectData(prev => ({ ...prev, builder: e.target.value }))}
                                        label="Developer"
                                      >
                                        <MenuItem value="Gagan Developers">Gagan Developers & Infra</MenuItem>
                                        <MenuItem value="DLF Group">DLF Group India</MenuItem>
                                        <MenuItem value="Omaxe">Omaxe Construction</MenuItem>
                                        <MenuItem value="Hero Homes">Hero Realty Homes</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Locality" size="small" fullWidth value={nestedProjectData.locality || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, locality: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Sector/Block" size="small" fullWidth value={nestedProjectData.sector_block || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, sector_block: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Type (R/C/I)</InputLabel>
                                      <Select
                                        value={nestedProjectData.type || 'Residential'}
                                        onChange={(e) => setNestedProjectData(prev => ({ ...prev, type: e.target.value }))}
                                        label="Type (R/C/I)"
                                      >
                                        <MenuItem value="Residential">Residential</MenuItem>
                                        <MenuItem value="Commercial">Commercial</MenuItem>
                                        <MenuItem value="Industrial">Industrial</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Category</InputLabel>
                                      <Select
                                        value={nestedProjectData.property_category || 'Plot'}
                                        onChange={(e) => setNestedProjectData(prev => ({ ...prev, property_category: e.target.value }))}
                                        label="Category"
                                      >
                                        <MenuItem value="Villa">Luxury Villa</MenuItem>
                                        <MenuItem value="Plot">Residential Land Plot</MenuItem>
                                        <MenuItem value="Apartment">Multistory Apartment</MenuItem>
                                        <MenuItem value="Commercial">Retail/Office Space</MenuItem>
                                        <MenuItem value="LOI">LOI</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Pricing Details" size="small" fullWidth value={nestedProjectData.pricing_details || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, pricing_details: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="PLC %" size="small" fullWidth value={nestedProjectData.plc_percent || ''} onChange={(e) => setNestedProjectData(prev => ({ ...prev, plc_percent: e.target.value }))} />
                                  </Grid>
                                </Grid>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    </Grid>
                  );
                }

                const options = getReferenceOptions(f.refModule);
                const isOther = formData[f.name] === 'Other';
                return (
                  <Grid item xs={12} key={f.name}>
                    <FormControl 
                      fullWidth 
                      error={!!errors[f.name]}
                      size="medium"
                    >
                      <InputLabel>{f.label}</InputLabel>
                      <Select
                        label={f.label}
                        value={formData[f.name] || ''}
                        onChange={(e) => handleChange(f.name, e.target.value)}
                        disabled={isReadOnly}
                      >
                        {f.refModule === 'dealers' && (
                          <MenuItem
                            disableRipple
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            sx={{ 
                              backgroundColor: 'transparent !important', 
                              cursor: 'default',
                              p: '4px 16px',
                              '&:hover': { backgroundColor: 'transparent' }
                            }}
                          >
                            <TextField
                              size="small"
                              placeholder="Search dealers..."
                              fullWidth
                              value={dealerSearch}
                              onChange={(e) => setDealerSearch(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                          </MenuItem>
                        )}
                        {f.refModule === 'properties' && (
                          <MenuItem
                            disableRipple
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            sx={{ 
                              backgroundColor: 'transparent !important', 
                              cursor: 'default',
                              p: '4px 16px',
                              '&:hover': { backgroundColor: 'transparent' }
                            }}
                          >
                            <TextField
                              size="small"
                              placeholder="Search properties..."
                              fullWidth
                              value={propSearch}
                              onChange={(e) => setPropSearch(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                          </MenuItem>
                        )}
                        {f.name === 'employeeId' && f.refModule === 'employees' && (
                          <MenuItem value="">
                            <em>All Employees (Notice for Everyone)</em>
                          </MenuItem>
                        )}
                        {options.filter(opt => {
                          if (f.refModule === 'dealers' && dealerSearch) {
                            const name = opt.name || opt.firm_name || opt.person_name || '';
                            const searchStr = `${name} ${opt.id}`.toLowerCase();
                            return searchStr.includes(dealerSearch.toLowerCase());
                          }
                          if (f.refModule === 'properties' && propSearch) {
                            const desc = `${opt.locality || ''} ${opt.sector_block || ''} ${opt.propertyType || ''} ${opt.id}`.toLowerCase();
                            return desc.includes(propSearch.toLowerCase());
                          }
                          return true;
                        }).map(opt => (
                          <MenuItem key={opt.id} value={opt.id}>
                            {f.refModule === 'dealers'
                              ? `${opt.firm_name || opt.person_name || 'Dealer'} (${opt.id})`
                              : f.refModule === 'properties'
                              ? `${opt.locality || ''} ${opt.sector_block ? `(Sec ${opt.sector_block})` : ''} ${opt.propertyType || ''} - ${opt.id}`
                              : opt.name ? `${opt.name} (${opt.id})` : opt.id
                            }
                          </MenuItem>
                        ))}
                        {f.refModule === 'dealers' && (
                          <MenuItem value="Other_Dealer" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                            + Add New Property Dealer
                          </MenuItem>
                        )}
                        <MenuItem value="Other" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                          Other (Specify...)
                        </MenuItem>
                      </Select>
                      {errors[f.name] && <FormHelperText>{errors[f.name]}</FormHelperText>}
                    </FormControl>

                    {formData[f.name] === 'Other_Dealer' && (
                      <Paper sx={{ p: 2.5, mt: 1.5, border: '1px solid #3B82F6', borderRadius: '12px', backgroundColor: '#EFF6FF', boxShadow: 'none' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#1E3A8A', fontFamily: 'Poppins' }}>
                          Create New Property Dealer
                        </Typography>
                        <Grid container spacing={2}>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Firm Name" size="small" fullWidth required value={nestedDealerData.firm_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, firm_name: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Person Name" size="small" fullWidth required value={nestedDealerData.person_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, person_name: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Contact Number" size="small" fullWidth required value={nestedDealerData.contact_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contact_num: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Contacted Number" size="small" fullWidth value={nestedDealerData.contacted_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contacted_num: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Area/Sector/Block" size="small" fullWidth required value={nestedDealerData.sector_block || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, sector_block: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Address" size="small" fullWidth value={nestedDealerData.address || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, address: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField label="Call Notes/Remarks" size="small" fullWidth multiline rows={2} value={nestedDealerData.remarks || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, remarks: e.target.value }))} />
                          </Grid>
                        </Grid>
                      </Paper>
                    )}

                    {isOther && (
                      <TextField
                        fullWidth
                        multiline
                        rows={2}
                        label={`Specify Custom ${f.label}`}
                        value={customValues[f.name] || ''}
                        onChange={(e) => handleCustomChange(f.name, e.target.value)}
                        placeholder="Type custom reference here..."
                        sx={{ mt: 1.5 }}
                        required
                      />
                    )}
                  </Grid>
                );
              }

              // 2.5 MULTI-REFERENCE TYPE FIELD (Multi-Select Lookups)
              if (f.type === 'multiref' && f.refModule) {
                const options = getReferenceOptions(f.refModule);
                const valArray = Array.isArray(formData[f.name]) 
                  ? formData[f.name] 
                  : formData[f.name] 
                    ? String(formData[f.name]).split(',').filter(Boolean) 
                    : [];
                
                return (
                  <Grid item xs={12} key={f.name}>
                    <FormControl 
                      fullWidth 
                      error={!!errors[f.name]}
                      size="medium"
                    >
                      <InputLabel>{f.label}</InputLabel>
                      <Select
                        multiple
                        label={f.label}
                        value={valArray}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleChange(f.name, Array.isArray(val) ? val.join(',') : val);
                        }}
                        disabled={isReadOnly}
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {selected.map((value) => {
                              const emp = options.find(o => String(o.id) === String(value));
                              return (
                                <Chip 
                                  key={value} 
                                  label={emp ? emp.name : value} 
                                  size="small" 
                                  sx={{ borderRadius: '4px' }}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {options.map(opt => (
                          <MenuItem key={opt.id} value={opt.id}>
                            {opt.name ? `${opt.name} (${opt.id})` : opt.id}
                          </MenuItem>
                        ))}
                      </Select>
                      {errors[f.name] && <FormHelperText>{errors[f.name]}</FormHelperText>}
                    </FormControl>
                  </Grid>
                );
              }

              // 2.7 BOOLEAN / SWITCH FIELD
              if (f.type === 'boolean') {
                return (
                  <Grid item xs={12} key={f.name}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={!!formData[f.name]}
                          onChange={(e) => handleChange(f.name, e.target.checked)}
                          disabled={isReadOnly}
                          color="primary"
                        />
                      }
                      label={f.label}
                    />
                  </Grid>
                );
              }

              // 3. TEXT AREA FIELD
              if (f.type === 'textarea') {
                return (
                  <Grid item xs={12} key={f.name}>
                    <TextField
                      label={f.label}
                      multiline
                      rows={3}
                      fullWidth
                      value={formData[f.name] || ''}
                      onChange={(e) => handleChange(f.name, e.target.value)}
                      error={!!errors[f.name]}
                      helperText={errors[f.name]}
                      disabled={isReadOnly}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 0.5 }}>
                            <VoiceInputButton onTranscript={(txt) => handleChange(f.name, formData[f.name] ? `${formData[f.name]} ${txt}` : txt)} />
                          </InputAdornment>
                        )
                      }}
                    />
                  </Grid>
                );
              }

              // 3.5 SIZE CUSTOM COMPONENT (MAIN FORM)
              if (f.name === 'size') {
                const currentRCI = formData.r_c_i || 'Residential';
                const units = ['Sq. ft.', 'Sq. yd.', 'Marla', 'Kanal', 'Acre'];
                
                if (currentRCI === 'Land' || currentRCI === 'Land Parcel') {
                  return (
                    <Grid item xs={12} key={f.name}>
                      <Typography variant="caption" sx={{ fontWeight: 700, mb: 1, display: 'block', color: '#475569' }}>
                        Property Size (Land Components)
                      </Typography>
                      <Grid container spacing={1}>
                        <Grid item xs={4}>
                          <Box display="flex" gap={0.5}>
                            <TextField 
                              label="Size 1" 
                              size="small" 
                              value={formData.size_comp1 || ''} 
                              onChange={(e) => handleChange('size_comp1', e.target.value)} 
                            />
                            <FormControl size="small" fullWidth>
                              <Select 
                                value={formData.size_unit1 || 'Acre'} 
                                onChange={(e) => handleChange('size_unit1', e.target.value)}
                              >
                                {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                              </Select>
                            </FormControl>
                          </Box>
                        </Grid>
                        <Grid item xs={4}>
                          <Box display="flex" gap={0.5}>
                            <TextField 
                              label="Size 2" 
                              size="small" 
                              value={formData.size_comp2 || ''} 
                              onChange={(e) => handleChange('size_comp2', e.target.value)} 
                            />
                            <FormControl size="small" fullWidth>
                              <Select 
                                value={formData.size_unit2 || 'Kanal'} 
                                onChange={(e) => handleChange('size_unit2', e.target.value)}
                              >
                                {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                              </Select>
                            </FormControl>
                          </Box>
                        </Grid>
                        <Grid item xs={4}>
                          <Box display="flex" gap={0.5}>
                            <TextField 
                              label="Size 3" 
                              size="small" 
                              value={formData.size_comp3 || ''} 
                              onChange={(e) => handleChange('size_comp3', e.target.value)} 
                            />
                            <FormControl size="small" fullWidth>
                              <Select 
                                value={formData.size_unit3 || 'Marla'} 
                                onChange={(e) => handleChange('size_unit3', e.target.value)}
                              >
                                {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                              </Select>
                            </FormControl>
                          </Box>
                        </Grid>
                      </Grid>
                    </Grid>
                  );
                } else {
                  return (
                    <Grid item xs={12} key={f.name}>
                      <Box display="flex" gap={1} alignItems="flex-start">
                        <TextField 
                          label="Property Size" 
                          fullWidth 
                          value={formData.size_val || ''} 
                          onChange={(e) => handleChange('size_val', e.target.value)} 
                        />
                        <FormControl style={{ minWidth: 120 }}>
                          <InputLabel>Unit</InputLabel>
                          <Select 
                            value={formData.size_unit || 'Sq. yd.'} 
                            onChange={(e) => handleChange('size_unit', e.target.value)}
                            label="Unit"
                          >
                            {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                          </Select>
                        </FormControl>
                      </Box>
                    </Grid>
                  );
                }
              }

              if (f.name === 'referrer_id') {
                let options = [];
                let refModuleName = "";
                const src = formData.source || formData.lead_source;
                if (src === 'Employee Referral') {
                  options = moduleData.employees || [];
                  refModuleName = "employees";
                } else if (src === 'Client Referral') {
                  options = moduleData.customers || [];
                  refModuleName = "customers";
                } else if (src === 'Dealer Referral') {
                  options = moduleData.dealers || [];
                  refModuleName = "dealers";
                }

                return (
                  <Grid item xs={12} key={f.name}>
                    <FormControl 
                      fullWidth 
                      error={!!errors[f.name]}
                      size="medium"
                    >
                      <InputLabel>{f.label}</InputLabel>
                      <Select
                        label={f.label}
                        value={formData[f.name] || ''}
                        onChange={(e) => {
                          handleChange('referrer_id', e.target.value);
                          handleChange('referrer_type', refModuleName);
                        }}
                        disabled={isReadOnly}
                      >
                        <MenuItem value="">-- Select Referrer --</MenuItem>
                        {options.map(opt => {
                          let labelText = opt.id;
                          if (refModuleName === 'dealers') {
                            labelText = `${opt.firm_name || opt.person_name || 'Dealer'} (${opt.id})`;
                          } else {
                            labelText = `${opt.name || opt.person_name || 'Referrer'} (${opt.id})`;
                          }
                          return (
                            <MenuItem key={opt.id} value={opt.id}>
                              {labelText}
                            </MenuItem>
                          );
                        })}
                      </Select>
                      {errors[f.name] && <FormHelperText>{errors[f.name]}</FormHelperText>}
                    </FormControl>
                  </Grid>
                );
              }

              if (f.name === 'contact_person_name' && formData.dealer_owner_booked === 'Dealer' && formData.dealerId) {
                const selectedDealer = (moduleData.dealers || []).find(d => String(d.id) === String(formData.dealerId));
                let contactPersonsList = [];
                if (selectedDealer) {
                  try {
                    let cp = selectedDealer.contact_persons;
                    if (typeof cp === 'string') cp = JSON.parse(cp);
                    if (Array.isArray(cp)) contactPersonsList = cp;
                  } catch (e) {}
                }

                return (
                  <Grid item xs={12} key={f.name}>
                    <Box sx={{ p: 2, border: '1px solid #CBD5E1', borderRadius: '12px', mb: 2, backgroundColor: '#F8FAFC' }}>
                      <Typography variant="caption" sx={{ fontWeight: 800, mb: 1, display: 'block', color: '#64748B', textTransform: 'uppercase' }}>
                        Firm Contact Details
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Select Existing Contact Person</InputLabel>
                            <Select
                              label="Select Existing Contact Person"
                              value={formData.contact_person_name || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'CUSTOM_NEW') {
                                  handleChange('contact_person_name', '');
                                  handleChange('contact_number', '');
                                } else {
                                  const matched = contactPersonsList.find(p => p.name === val);
                                  if (matched) {
                                    handleChange('contact_person_name', matched.name);
                                    handleChange('contact_number', matched.phone);
                                  } else {
                                    handleChange('contact_person_name', val);
                                  }
                                }
                              }}
                              disabled={isReadOnly}
                            >
                              <MenuItem value="CUSTOM_NEW" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                + Add/Write Custom Contact Person...
                              </MenuItem>
                              {contactPersonsList.map(person => (
                                <MenuItem key={person.phone} value={person.name}>
                                  {person.name} ({person.phone})
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            label="Contact Person Name"
                            size="small"
                            fullWidth
                            value={formData.contact_person_name || ''}
                            onChange={(e) => handleChange('contact_person_name', e.target.value)}
                            error={!!errors.contact_person_name}
                            helperText={errors.contact_person_name}
                            disabled={isReadOnly}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            label="Contact Number"
                            size="small"
                            fullWidth
                            value={formData.contact_number || ''}
                            onChange={(e) => handleChange('contact_number', e.target.value)}
                            error={!!errors.contact_number}
                            helperText={errors.contact_number}
                            disabled={isReadOnly}
                          />
                        </Grid>
                      </Grid>
                    </Box>
                  </Grid>
                );
              }

              // 4. STANDARD TEXT/NUMBER/DATE FIELD
              return (
                <Grid item xs={f.name === 'id' ? 12 : 6} key={f.name}>
                  <TextField
                    label={f.label}
                    type={f.name === 'password' ? 'password' : (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text')}
                    fullWidth
                    InputLabelProps={f.type === 'date' ? { shrink: true } : undefined}
                    value={formData[f.name] === undefined ? '' : formData[f.name]}
                    onChange={(e) => handleChange(f.name, e.target.value, f.type)}
                    error={!!errors[f.name]}
                    helperText={errors[f.name]}
                    disabled={isReadOnly}
                  />
                </Grid>
              );
            })}

            {showSellerPropertyForm && (
              <Grid item xs={12}>
                <Box sx={{ mt: 3, p: 2.5, border: '1px solid #10B981', borderRadius: '12px', backgroundColor: '#F0FDF4' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 2, color: '#065F46', display: 'flex', alignItems: 'center', gap: 1, fontFamily: 'Poppins' }}>
                    <Home size={18} />
                    Register Property Listing (Seller Details)
                  </Typography>
                  <Grid container spacing={1.5}>
                    {(metadata?.modules?.properties?.fields || []).filter(f => {
                      if (f.name === 'id') return false;
                      if (f.name === 'current_owner_id') return false;
                      if (f.name === 'source' || f.name === 'leadSource' || f.name === 'lead_source') return false;
                      if (f.name === 'dealerId' || f.name === 'dealer_deal_type') {
                        return nestedPropertyData.dealer_owner_booked === 'Dealer';
                      }
                      if (f.name === 'firm_name') {
                        return nestedPropertyData.dealer_owner_booked === 'Dealer';
                      }
                      if (f.name === 'booked_by_customer_id') {
                        return nestedPropertyData.dealer_owner_booked === 'Booked By Us';
                      }
                      if (f.name === 'no_of_floors') {
                        return nestedPropertyData.propertyType === 'Showroom';
                      }
                      if (f.name === 'land_type') {
                        return false;
                      }
                      if (f.name === 'zone') {
                        return nestedPropertyData.r_c_i === 'Land Parcel';
                      }
                      if (f.name === 'propertyType') {
                        return true;
                      }
                      return true;
                    }).map(f => {
                      // 0. SIZE CUSTOM WIDGET (NESTED CARD)
                      if (f.name === 'size') {
                        const currentRCI = nestedPropertyData.r_c_i || 'Residential';
                        const units = ['Sq. ft.', 'Sq. yd.', 'Marla', 'Kanal', 'Acre'];
                        
                        if (currentRCI === 'Land' || currentRCI === 'Land Parcel') {
                          return (
                            <Grid item xs={12} key={f.name}>
                              <Typography variant="caption" sx={{ fontWeight: 700, mb: 1, display: 'block', color: '#475569' }}>
                                Property Size (Land Components)
                              </Typography>
                              <Grid container spacing={1}>
                                <Grid item xs={4}>
                                  <Box display="flex" gap={0.5}>
                                    <TextField 
                                      label="Size 1" 
                                      size="small" 
                                      value={nestedPropertyData.size_comp1 || ''} 
                                      onChange={(e) => handleNestedPropertyChange('size_comp1', e.target.value)} 
                                    />
                                    <FormControl size="small" fullWidth>
                                      <Select 
                                        value={nestedPropertyData.size_unit1 || 'Acre'} 
                                        onChange={(e) => handleNestedPropertyChange('size_unit1', e.target.value)}
                                      >
                                        {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Grid>
                                <Grid item xs={4}>
                                  <Box display="flex" gap={0.5}>
                                    <TextField 
                                      label="Size 2" 
                                      size="small" 
                                      value={nestedPropertyData.size_comp2 || ''} 
                                      onChange={(e) => handleNestedPropertyChange('size_comp2', e.target.value)} 
                                    />
                                    <FormControl size="small" fullWidth>
                                      <Select 
                                        value={nestedPropertyData.size_unit2 || 'Kanal'} 
                                        onChange={(e) => handleNestedPropertyChange('size_unit2', e.target.value)}
                                      >
                                        {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Grid>
                                <Grid item xs={4}>
                                  <Box display="flex" gap={0.5}>
                                    <TextField 
                                      label="Size 3" 
                                      size="small" 
                                      value={nestedPropertyData.size_comp3 || ''} 
                                      onChange={(e) => handleNestedPropertyChange('size_comp3', e.target.value)} 
                                    />
                                    <FormControl size="small" fullWidth>
                                      <Select 
                                        value={nestedPropertyData.size_unit3 || 'Marla'} 
                                        onChange={(e) => handleNestedPropertyChange('size_unit3', e.target.value)}
                                      >
                                        {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Grid>
                              </Grid>
                            </Grid>
                          );
                        } else {
                          return (
                            <Grid item xs={12} sm={6} key={f.name}>
                              <Box display="flex" gap={1} alignItems="flex-start">
                                <TextField 
                                  label="Property Size" 
                                  size="small"
                                  fullWidth 
                                  value={nestedPropertyData.size_val || ''} 
                                  onChange={(e) => handleNestedPropertyChange('size_val', e.target.value)} 
                                />
                                <FormControl size="small" style={{ minWidth: 100 }}>
                                  <InputLabel>Unit</InputLabel>
                                  <Select 
                                    value={nestedPropertyData.size_unit || 'Sq. yd.'} 
                                    onChange={(e) => handleNestedPropertyChange('size_unit', e.target.value)}
                                    label="Unit"
                                  >
                                    {units.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                                  </Select>
                                </FormControl>
                              </Box>
                            </Grid>
                          );
                        }
                      }

                      // 1. SELECT TYPE FIELD
                      if (f.type === 'select' && f.chipGroup) {
                        let options = metadata?.chips?.[f.chipGroup] || [];
                        if (f.name === 'propertyType') {
                          const currentRCI = nestedPropertyData.r_c_i || 'Residential';
                          const mapping = {
                            Residential: ['Plots', 'LOI', 'Villa', 'Kothi', 'Apartment', 'Farm House', '25% Built Up Plot'],
                            Commercial: ['SCO Plot', 'SCO Builtup', 'SCO LOI', 'Bay Shop Plot', 'Bay Shop Builtup', 'Bay Shop LOI', 'Booth Plot', 'Booth Builtup', 'Booth LOI', 'Office Space', 'Hotel Site', 'Hotel Builtup', 'Restaurant'],
                            Industrial: ['Plot', 'Builtup', 'LOI', 'Floors', 'Factory', 'Operational Business'],
                            'Land Parcel': ['Private Land Under MC', 'Private Land Not Under MC', 'Lal Dora Land']
                          };
                          const allowed = mapping[currentRCI] || [];
                          options = allowed.map(val => ({
                            value: val,
                            label: val,
                            color: '#2563EB'
                          }));
                          options.push({ value: 'Other', label: 'Other (Specify...)', color: '#2563EB' });
                        }
                        if (f.name === 'zone') {
                          options = [
                            { value: 'Land Zone', label: 'Land Zone', color: '#2563EB' },
                            { value: 'R Zone', label: 'R Zone', color: '#2563EB' },
                            { value: 'Agriculture Land', label: 'Agriculture Land', color: '#2563EB' },
                            { value: 'Baghleani', label: 'Baghleani', color: '#2563EB' },
                            { value: 'Commercial', label: 'Commercial', color: '#2563EB' },
                            { value: 'Industrial', label: 'Industrial', color: '#2563EB' }
                          ];
                        }
                        const isSpecifiable = nestedPropertyData[f.name] === 'Other' || String(nestedPropertyData[f.name] || '').includes('(Specify)');
                        return (
                          <Grid item xs={12} sm={6} key={f.name}>
                            <FormControl fullWidth size="small">
                              <InputLabel>{f.label}</InputLabel>
                              <Select
                                value={nestedPropertyData[f.name] || ''}
                                onChange={(e) => handleNestedPropertyChange(f.name, e.target.value)}
                                label={f.label}
                              >
                                {options.map(opt => (
                                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                            {isSpecifiable && (
                              <TextField
                                fullWidth
                                size="small"
                                multiline
                                rows={2}
                                label={`Specify Custom ${f.label}`}
                                value={nestedPropertyData[f.name + '_custom'] || ''}
                                onChange={(e) => handleNestedPropertyChange(f.name + '_custom', e.target.value)}
                                placeholder="Type custom details here..."
                                sx={{ mt: 1 }}
                                required
                              />
                            )}
                          </Grid>
                        );
                      }

                      // 2. REFERENCE TYPE FIELD
                      if (f.type === 'ref' && f.refModule) {
                        const options = moduleData[f.refModule] || [];
                        return (
                          <Grid item xs={12} sm={6} key={f.name}>
                            <FormControl fullWidth size="small">
                              <InputLabel>{f.label}</InputLabel>
                              <Select
                                value={nestedPropertyData[f.name] || ''}
                                onChange={(e) => handleNestedPropertyChange(f.name, e.target.value)}
                                label={f.label}
                              >
                                <MenuItem value="">-- Select --</MenuItem>
                                {options.map(opt => (
                                  <MenuItem key={opt.id} value={opt.id}>{opt.name || opt.firm_name || opt.id}</MenuItem>
                                ))}
                                {f.refModule === 'dealers' && (
                                  <MenuItem value="Other_Dealer" sx={{ fontStyle: 'italic', fontWeight: 600, color: '#2563EB' }}>
                                    + Add New Property Dealer
                                  </MenuItem>
                                )}
                              </Select>
                            </FormControl>
                            
                            {/* Inner Associated Dealer Sub-Form */}
                            {f.refModule === 'dealers' && nestedPropertyData.dealerId === 'Other_Dealer' && (
                              <Box sx={{ mt: 1.5, p: 2, border: '1px solid #3B82F6', borderRadius: '12px', backgroundColor: '#EFF6FF', width: '100%' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, color: '#1E3A8A' }}>
                                  Create New Property Dealer
                                </Typography>
                                <Grid container spacing={1.5}>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Firm Name" size="small" fullWidth required value={nestedDealerData.firm_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, firm_name: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Person Name" size="small" fullWidth required value={nestedDealerData.person_name || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, person_name: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Contact Number" size="small" fullWidth required value={nestedDealerData.contact_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contact_num: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Contacted Number" size="small" fullWidth value={nestedDealerData.contacted_num || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, contacted_num: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Area/Sector/Block" size="small" fullWidth required value={nestedDealerData.sector_block || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, sector_block: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <TextField label="Address" size="small" fullWidth value={nestedDealerData.address || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, address: e.target.value }))} />
                                  </Grid>
                                  <Grid item xs={12}>
                                    <TextField label="Call Notes/Remarks" size="small" fullWidth multiline rows={2} value={nestedDealerData.remarks || ''} onChange={(e) => setNestedDealerData(prev => ({ ...prev, remarks: e.target.value }))} />
                                  </Grid>
                                </Grid>
                              </Box>
                            )}
                          </Grid>
                        );
                      }

                      // 3. STANDARD TEXT/NUMBER/DATE/TEXTAREA FIELD
                      return (
                        <Grid item xs={12} sm={6} key={f.name}>
                          <TextField
                            label={f.label}
                            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                            multiline={f.type === 'textarea'}
                            rows={f.type === 'textarea' ? 2 : undefined}
                            size="small"
                            fullWidth
                            InputLabelProps={f.type === 'date' ? { shrink: true } : undefined}
                            value={nestedPropertyData[f.name] || ''}
                            onChange={(e) => handleNestedPropertyChange(f.name, e.target.value)}
                            InputProps={f.type === 'textarea' ? {
                              endAdornment: (
                                <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 0.5 }}>
                                  <VoiceInputButton onTranscript={(txt) => handleNestedPropertyChange(f.name, nestedPropertyData[f.name] ? `${nestedPropertyData[f.name]} ${txt}` : txt)} />
                                </InputAdornment>
                              )
                            } : undefined}
                          />
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        
        <DialogActions sx={{ px: 3, pb: 2.5, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onClose} variant="outlined" sx={{ borderColor: '#E2E8F0', color: '#64748B', textTransform: 'none', fontWeight: 700 }}>
            Cancel
          </Button>
          {!initialData && moduleKey === 'properties' && (
            <Button onClick={handleSaveAndAddAnother} variant="outlined" color="primary" sx={{ textTransform: 'none', fontWeight: 700 }}>
              Save & Add Another Property
            </Button>
          )}
          <Button type="submit" variant="contained" sx={{ backgroundColor: '#2563EB', '&:hover': { backgroundColor: '#1D4ED8' }, textTransform: 'none', fontWeight: 700 }}>
            Save Record
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default DynamicForm;
