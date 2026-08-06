const fs = require('fs');
const path = require('path');

function isActiveRecord(rec) {
  if (!rec) return false;
  if (rec.deleted === true || rec.deleted === 'true' || rec.deleted === 1 || rec.deleted === '1') return false;
  if (rec.isDeleted === true || rec.isDeleted === 'true' || rec.isDeleted === 1 || rec.isDeleted === '1') return false;
  if (rec.archived === true || rec.archived === 'true' || rec.archived === 1 || rec.archived === '1') return false;
  if (rec.active === false || rec.active === 'false' || rec.active === 0 || rec.active === '0') return false;
  
  if (rec.status) {
    const statusLower = String(rec.status).toLowerCase();
    if (statusLower === 'deleted' || 
        statusLower === 'archived' || 
        statusLower === 'removed' || 
        statusLower === 'cancelled' ||
        statusLower === 'inactive') {
      return false;
    }
  }
  
  if (rec.propertyStatus) {
    const statusLower = String(rec.propertyStatus).toLowerCase();
    if (statusLower === 'deleted' || 
        statusLower === 'archived' || 
        statusLower === 'removed' || 
        statusLower === 'cancelled' ||
        statusLower === 'inactive') {
      return false;
    }
  }
  
  return true;
}

function getActiveList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(isActiveRecord);
}

function filterDb(rawDb) {
  if (!rawDb) return {};
  
  // 1. Get filtered base parent lists first
  const employees = getActiveList(rawDb.employees);
  const leads = getActiveList(rawDb.leads);
  const customers = getActiveList(rawDb.customers);
  const properties = getActiveList(rawDb.properties);
  const projects = getActiveList(rawDb.projects);
  const queries = getActiveList(rawDb.queries);
  const dealers = getActiveList(rawDb.dealers);

  // Helper sets for fast lookup
  const activeEmployeeIds = new Set(employees.map(e => String(e.id)));
  const activeLeadIds = new Set(leads.map(l => String(l.id)));
  const activeCustomerIds = new Set(customers.map(c => String(c.id)));
  const activePropertyIds = new Set(properties.map(p => String(p.id)));
  const activeProjectIds = new Set(projects.map(p => String(p.id)));
  const activeQueryIds = new Set(queries.map(q => String(q.id)));
  const activeDealerIds = new Set(dealers.map(d => String(d.id)));

  const db = {
    employees,
    leads,
    customers,
    properties,
    projects,
    queries,
    dealers
  };

  // 2. Filter other tables checking references
  for (const key in rawDb) {
    if (db[key] !== undefined) continue; // already processed base parent tables

    if (Array.isArray(rawDb[key])) {
      const activeRecords = getActiveList(rawDb[key]);
      
      // Filter out records whose referenced parent ID is deleted
      db[key] = activeRecords.filter(rec => {
        // Employee reference check
        if (rec.employeeId && !activeEmployeeIds.has(String(rec.employeeId))) return false;
        if (rec.employeeID && !activeEmployeeIds.has(String(rec.employeeID))) return false;
        
        // Lead reference check
        if (rec.leadId && !activeLeadIds.has(String(rec.leadId))) return false;
        if (rec.leadID && !activeLeadIds.has(String(rec.leadID))) return false;
        
        // Customer reference check (Note: customerId sometimes holds leadId in this CRM)
        if (rec.customerId) {
          const cId = String(rec.customerId);
          if (!activeCustomerIds.has(cId) && !activeLeadIds.has(cId)) return false;
        }
        if (rec.customerID) {
          const cId = String(rec.customerID);
          if (!activeCustomerIds.has(cId) && !activeLeadIds.has(cId)) return false;
        }

        // Property reference check
        if (rec.propertyId && !activePropertyIds.has(String(rec.propertyId))) return false;
        if (rec.propertyID && !activePropertyIds.has(String(rec.propertyID))) return false;
        if (rec.pitchedPropertyId && !activePropertyIds.has(String(rec.pitchedPropertyId))) return false;

        // Project reference check
        if (rec.projectId && !activeProjectIds.has(String(rec.projectId))) return false;
        if (rec.projectID && !activeProjectIds.has(String(rec.projectID))) return false;

        // Query reference check
        if (rec.queryId && !activeQueryIds.has(String(rec.queryId))) return false;
        if (rec.queryID && !activeQueryIds.has(String(rec.queryID))) return false;

        // Dealer reference check
        if (rec.dealerId && !activeDealerIds.has(String(rec.dealerId))) return false;
        if (rec.dealerID && !activeDealerIds.has(String(rec.dealerID))) return false;

        return true;
      });
    } else {
      db[key] = rawDb[key];
    }
  }

  return db;
}

function classifyIntent(sentence, db) {
  let cleanStr = sentence.toLowerCase()
    .replace(/[?,.!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  const stopPhrases = [
    'please', 'kindly', 'can you', 'could you', 'i want', 'i need', 
    'show me', 'tell me', 'help me', 'let me', 'give me', 'show', 'view', 'display', 'open'
  ];
  
  for (const phrase of stopPhrases) {
    cleanStr = cleanStr.replace(new RegExp(`\\b${phrase}\\b`, 'g'), '');
  }
  cleanStr = cleanStr.replace(/\s+/g, ' ').trim();
  
  const words = cleanStr.split(/\s+/).filter(w => w.length > 0);
  
  const spellingCorrections = {
    attendence: 'attendance',
    attndance: 'attendance',
    attendnce: 'attendance',
    employe: 'employee',
    emplyee: 'employee',
    salry: 'salary',
    payrol: 'payroll',
    custmer: 'customer',
    propery: 'property',
    propety: 'property',
    leed: 'lead',
    intkal: 'inteqal',
    intiqal: 'inteqal',
    khwat: 'khewat',
    jamabndi: 'jamabandi'
  };
  
  const correctedWords = words.map(w => spellingCorrections[w] || w);
  
  const synonyms = {
    salary: 'payroll',
    payroll: 'salary',
    employee: 'staff',
    staff: 'employee',
    attendance: 'punch',
    punch: 'attendance',
    customer: 'client',
    client: 'customer',
    lead: 'inquiry',
    inquiry: 'lead',
    prospect: 'lead',
    property: 'plot',
    plot: 'property',
    land: 'property',
    meeting: 'appointment',
    appointment: 'meeting',
    task: 'assignment',
    assignment: 'task',
    payment: 'collection',
    collection: 'payment',
    leave: 'holiday',
    holiday: 'leave',
    pitch: 'pitched',
    pitched: 'pitch',
    recommend: 'pitched',
    recommended: 'pitched'
  };

  const moduleKeywords = {
    Employees: ['employee', 'employees', 'staff', 'worker', 'workers', 'team', 'agent', 'agents', 'sales executive', 'telecaller', 'manager', 'admin', 'hr', 'accountant', 'director', 'owner', 'executive', 'marketing executive', 'profile', 'details', 'information', 'record', 'list'],
    Attendance: ['attendance', 'present', 'absent', 'late', 'half day', 'full day', 'check in', 'check out', 'checkin', 'checkout', 'punch', 'punch in', 'punch out', 'office time', 'working hours', 'login time', 'logout time', 'today attendance', 'monthly attendance', 'weekly attendance', 'attendance report'],
    Payroll: ['salary', 'salaries', 'payroll', 'payrolls', 'deduction', 'deductions', 'bonus', 'bonuses', 'allowance', 'allowances', 'settlement', 'gross', 'net salary', 'payslip', 'payslips', 'salary slip', 'monthly salary', 'salary report'],
    Leaves: ['leave', 'leaves', 'holiday', 'holidays', 'vacation', 'vacations', 'half day', 'full day', 'leave request', 'leave application', 'leave approval', 'leave balance', 'leave status', 'medical leave', 'casual leave', 'earned leave', 'paid leave', 'unpaid leave', 'half leave', 'full leave'],
    Leads: ['lead', 'leads', 'inquiry', 'enquiry', 'prospect', 'new lead', 'hot lead', 'warm lead', 'cold lead', 'pending lead', 'converted lead', 'lost lead', 'lead source', 'lead status', 'lead followup', 'lead history'],
    Followup: ['followup', 'follow up', 'reminder', 'call back', 'callback', 'meeting', 'appointment', 'site visit', 'next call', 'next meeting', 'schedule followup', 'pending followup', 'completed followup'],
    Customers: ['customer', 'customers', 'client', 'clients', 'buyer', 'buyers', 'seller', 'sellers', 'owner', 'tenant', 'investor', 'landlord', 'vendor', 'dealer', 'builder', 'customer history', 'customer profile', 'customer payment'],
    Properties: ['property', 'properties', 'plot', 'land', 'house', 'villa', 'flat', 'apartment', 'office', 'shop', 'showroom', 'warehouse', 'factory', 'farm house', 'commercial', 'residential', 'property details', 'available property', 'sold property', 'property status'],
    Projects: ['project', 'projects', 'township', 'scheme', 'site', 'society', 'development', 'building', 'tower', 'phase', 'block', 'project details'],
    Inventory: ['inventory', 'stock', 'availability', 'available', 'booked', 'reserved', 'sold', 'unsold', 'unit', 'units', 'inventory status'],
    Payments: ['payment', 'payments', 'receipt', 'invoice', 'bill', 'due', 'outstanding', 'received', 'collection', 'refund', 'advance payment', 'emi', 'transaction'],
    Expenses: ['expense', 'expenses', 'office expense', 'travel expense', 'salary expense', 'fuel expense', 'maintenance', 'electricity', 'rent', 'miscellaneous'],
    Tasks: ['task', 'tasks', 'assignment', 'work', 'pending task', 'completed task', 'today task', 'employee task'],
    Reports: ['report', 'reports', 'analytics', 'dashboard', 'summary', 'statistics', 'performance', 'graph', 'chart', 'analysis', 'growth', 'trend', 'comparison'],
    Documents: ['document', 'documents', 'registry', 'sale deed', 'agreement', 'mutation', 'inteqal', 'jamabandi', 'khewat', 'khatauni', 'khasra', 'fard', 'nakal', 'noc', 'clu', 'loi', 'gmada', 'puda', 'rera', 'registry status'],
    Pitches: ['pitched', 'recommended', 'recommended property', 'shared property', 'shown property', 'offered property', 'explained property', 'property suggestion', 'recommended plot', 'pitched status', 'pitched villa', 'pitched flat', 'pitched office', 'pitched commercial', 'pitched residential', 'pitched project', 'site visit', 'brochure shared', 'quotation shared', 'pitch', 'pitches', 'property pitch', 'pitch history']
  };

  const finalScores = {};

  // Global Entity & Context Detections
  let hasEmployeeName = false;
  let hasEmployeeId = false;
  let hasCustomerName = false;
  let hasCustomerId = false;
  let hasPropertyName = false;
  let hasPropertyId = false;
  let hasProjectName = false;
  let hasProjectId = false;
  let hasLeadName = false;
  let hasLeadId = false;
  
  if (db) {
    if (db.employees) {
      hasEmployeeName = db.employees.some(e => e.name && cleanStr.includes(e.name.toLowerCase()));
      hasEmployeeId = db.employees.some(e => String(e.id).toLowerCase() === cleanStr || cleanStr.includes(String(e.id).toLowerCase()));
    }
    if (db.customers) {
      hasCustomerName = db.customers.some(c => (c.name || c.person_name) && cleanStr.includes((c.name || c.person_name).toLowerCase()));
      hasCustomerId = db.customers.some(c => String(c.id).toLowerCase() === cleanStr || cleanStr.includes(String(c.id).toLowerCase()));
    }
    if (db.leads) {
      hasLeadName = db.leads.some(l => (l.name || l.person_name) && cleanStr.includes((l.name || l.person_name).toLowerCase()));
      hasLeadId = db.leads.some(l => String(l.id).toLowerCase() === cleanStr || cleanStr.includes(String(l.id).toLowerCase()));
    }
    if (db.properties) {
      hasPropertyName = db.properties.some(p => (p.propertyName || p.name) && cleanStr.includes((p.propertyName || p.name).toLowerCase()));
      hasPropertyId = db.properties.some(p => String(p.id).toLowerCase() === cleanStr || cleanStr.includes(String(p.id).toLowerCase()));
    }
    if (db.projects) {
      hasProjectName = db.projects.some(p => p.name && cleanStr.includes(p.name.toLowerCase()));
      hasProjectId = db.projects.some(p => String(p.id).toLowerCase() === cleanStr || cleanStr.includes(String(p.id).toLowerCase()));
    }
  }

  // Regex and Keyword checks
  if (/\b(emp-\d+|emp\d+)\b/i.test(sentence)) hasEmployeeId = true;
  if (/\b(cust-\d+|c\d+)\b/i.test(sentence)) hasCustomerId = true;
  if (/\b(lead-\d+|l\d+)\b/i.test(sentence)) hasLeadId = true;
  if (/\b(prop-\d+|p-\d+|p\d+)\b/i.test(sentence)) hasPropertyId = true;
  if (/\b(proj-\d+|pr\d+)\b/i.test(sentence)) hasProjectId = true;

  const hasDateRange = /\b(between|from|to|last month|this month|this year|last week|next week|range|period|duration)\b/i.test(sentence);
  const hasDate = /\b(today|yesterday|tomorrow|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december))\b/i.test(sentence) || hasDateRange;
  const hasLocation = /\b(mohali|chandigarh|panchkula|sector|phase|block)\b/i.test(sentence);
  const hasStatus = /\b(active|inactive|pending|approved|rejected|completed|cancelled|booked|available|sold|vacant|occupied|closed|open)\b/i.test(sentence);
  const hasBudget = /\b(lakh|cr|crore|lakhs|crores|million|thousand|budget|price|demand|cost|rupee|rupees|rs)\b/i.test(sentence) || /\d+[\s]*(cr|lakh|k)/i.test(sentence);
  const hasPropertyType = /\b(plot|villa|flat|apartment|office|shop|showroom|warehouse|factory|farm house|commercial|residential)\b/i.test(sentence);
  const hasPhoneNumber = /\b(\d{10}|\d{3}-\d{3}-\d{4})\b/.test(sentence);
  const hasEmail = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(sentence);
  
  const hasMutation = /\b(mutation|inteqal|intkal)\b/i.test(sentence);
  const hasKhewat = /\b(khewat|khwat)\b/i.test(sentence);
  const hasRegistry = /\b(registry|sale deed)\b/i.test(sentence);
  
  for (const mKey in moduleKeywords) {
    const keywords = moduleKeywords[mKey];
    let baseScore = 0;
    
    // 1. Exact Phrase Match (100%)
    const hasExactPhrase = keywords.some(k => k.includes(' ') && cleanStr.includes(k));
    if (hasExactPhrase) {
      baseScore = Math.max(baseScore, 100);
    }
    
    // Check individual keyword matches (direct, synonym, partial, spelling, etc.)
    let matchCount = 0;
    let hasSynonymMatch = false;
    let hasPartialMatch = false;
    let hasSpellingMatch = false;
    
    for (const word of correctedWords) {
      if (keywords.includes(word)) {
        matchCount++;
      } else {
        // Spelling correction
        const corrected = spellingCorrections[word];
        if (corrected && keywords.includes(corrected)) {
          hasSpellingMatch = true;
          matchCount++;
        } else {
          // Synonym matching
          const syn = synonyms[word];
          if (syn && keywords.includes(syn)) {
            hasSynonymMatch = true;
            matchCount++;
          } else {
            // Partial matching
            const partial = keywords.some(k => k.includes(word) || word.includes(k));
            if (partial && word.length >= 4) {
              hasPartialMatch = true;
              matchCount++;
            }
          }
        }
      }
    }
    
    // Multiple Exact Keywords (99%)
    if (matchCount > 1) {
      baseScore = Math.max(baseScore, 99);
    } else if (matchCount === 1) {
      if (hasSpellingMatch) {
        baseScore = Math.max(baseScore, 82);
      } else if (hasSynonymMatch) {
        baseScore = Math.max(baseScore, 92);
      } else if (hasPartialMatch) {
        baseScore = Math.max(baseScore, 84);
      } else {
        baseScore = Math.max(baseScore, 94);
      }
    }
    
    // Intent Match (97%) (e.g. contains action keywords like show/get/find/check + has some matches)
    const hasIntentIndicator = /\b(show|get|find|check|list|view|display|search|query|details|info|record)\b/i.test(sentence);
    if (hasIntentIndicator && matchCount > 0) {
      baseScore = Math.max(baseScore, 97);
    }

    // Entity + Module Match (98%)
    const hasEntityMatchForModule = 
      (mKey === 'Employees' && (hasEmployeeName || hasEmployeeId)) ||
      (mKey === 'Customers' && (hasCustomerName || hasCustomerId)) ||
      (mKey === 'Leads' && (hasLeadName || hasLeadId)) ||
      (mKey === 'Properties' && (hasPropertyName || hasPropertyId)) ||
      (mKey === 'Projects' && (hasProjectName || hasProjectId)) ||
      (mKey === 'Pitches' && (hasEmployeeName || hasCustomerName || hasPropertyName));
      
    if (hasEntityMatchForModule && matchCount > 0) {
      baseScore = Math.max(baseScore, 98);
    }

    // Date Match: 91%
    if (hasDate && ['Attendance', 'Leaves', 'Followup', 'Pitches', 'Payments'].includes(mKey)) {
      baseScore = Math.max(baseScore, 91);
    }
    
    // Location Match: 90%
    if (hasLocation && ['Properties', 'Projects', 'Leads', 'Customers'].includes(mKey)) {
      baseScore = Math.max(baseScore, 90);
    }

    // Status Match: 89%
    if (hasStatus && matchCount > 0) {
      baseScore = Math.max(baseScore, 89);
    }

    // Relationship Match: 88%
    const hasRelationship = 
      (cleanStr.includes('attendance') && (hasEmployeeName || hasEmployeeId)) ||
      (cleanStr.includes('salary') && (hasEmployeeName || hasEmployeeId)) ||
      (cleanStr.includes('leave') && (hasEmployeeName || hasEmployeeId)) ||
      (cleanStr.includes('payment') && (hasCustomerName || hasCustomerId)) ||
      (cleanStr.includes('pitch') && (hasEmployeeName || hasCustomerName || hasPropertyName));

    if (hasRelationship && ['Attendance', 'Payroll', 'Leaves', 'Payments', 'Pitches'].includes(mKey)) {
      baseScore = Math.max(baseScore, 88);
    }

    // Natural Language Match (75%)
    if (matchCount > 0) {
      baseScore = Math.max(baseScore, 75);
    }
    
    // Add Bonus Scoring
    let totalScore = baseScore;
    if (totalScore > 0) {
      if (hasEmployeeName) totalScore += 20;
      if (hasCustomerName) totalScore += 20;
      if (hasLeadName) totalScore += 20;
      if (hasPropertyName) totalScore += 20;
      if (hasProjectName) totalScore += 20;
      if (hasEmployeeId) totalScore += 25;
      if (hasLeadId) totalScore += 25;
      if (hasCustomerId) totalScore += 25;
      if (hasPropertyId) totalScore += 25;
      if (hasProjectId) totalScore += 25;
      if (hasDate) totalScore += 15;
      if (hasDateRange) totalScore += 20;
      if (hasLocation) totalScore += 15;
      if (hasBudget) totalScore += 15;
      if (hasStatus) totalScore += 15;
      if (hasPropertyType) totalScore += 15;
      if (hasPhoneNumber) totalScore += 20;
      if (hasEmail) totalScore += 20;
      if (hasRegistry) totalScore += 25;
      if (hasMutation) totalScore += 25;
      if (hasKhewat) totalScore += 25;
    }
    
    finalScores[mKey] = totalScore;
  }

  const ranking = Object.keys(moduleKeywords)
    .map(key => ({ module: key, score: finalScores[key] || 0 }))
    .sort((a, b) => b.score - a.score || b.module.localeCompare(a.module));

  let winner = ranking[0].score >= 70 ? ranking[0].module : null;

  const topScore = ranking[0].score;
  const topModules = ranking.filter(r => r.score === topScore).map(r => r.module);

  if (topScore > 0 && topModules.length > 1) {
    if (topModules.includes('Employees') && topModules.includes('Payroll')) winner = 'Payroll';
    else if (topModules.includes('Employees') && topModules.includes('Attendance')) winner = 'Attendance';
    else if (topModules.includes('Properties') && topModules.includes('Inventory')) winner = 'Inventory';
    else if (topModules.includes('Customers') && topModules.includes('Payments')) winner = 'Payments';
  }

  return { winner, ranking };
}

function getRelatedRecords(moduleKey, entityId, db, metadata) {
  const related = {};
  const modules = metadata.modules || {};
  
  for (const mKey in modules) {
    if (mKey === moduleKey) continue;
    const mConfig = modules[mKey];
    const fields = mConfig.fields || [];
    
    const refFields = fields.filter(f => f.type === 'ref' && f.refModule === moduleKey);
    if (refFields.length > 0) {
      const records = getActiveList(db[mKey]);
      const matched = records.filter(rec => {
        return refFields.some(f => String(rec[f.name]) === String(entityId));
      });
      if (matched.length > 0) {
        related[mKey] = matched;
      }
    }
    
    const singularIdKey = moduleKey.endsWith('s') ? `${moduleKey.slice(0, -1)}Id` : `${moduleKey}Id`;
    const camelIdKey = moduleKey.endsWith('s') ? `${moduleKey.slice(0, -1)}ID` : `${moduleKey}ID`;
    
    const idFields = fields.filter(f => 
      f.name === singularIdKey || 
      f.name === camelIdKey || 
      (f.name === 'customerId' && moduleKey === 'customers') || 
      (f.name === 'employeeId' && moduleKey === 'employees') || 
      (f.name === 'propertyId' && moduleKey === 'properties') || 
      (f.name === 'projectId' && moduleKey === 'projects') || 
      (f.name === 'dealerId' && moduleKey === 'dealers')
    );
    if (idFields.length > 0 && !related[mKey]) {
      const records = getActiveList(db[mKey]);
      const matched = records.filter(rec => {
        return idFields.some(f => String(rec[f.name]) === String(entityId));
      });
      if (matched.length > 0) {
        related[mKey] = matched;
      }
    }
  }
  return related;
}

function getParentEntities(moduleKey, rec, db, metadata) {
  const parents = {};
  const mConfig = metadata.modules?.[moduleKey];
  if (!mConfig) return parents;
  
  const fields = mConfig.fields || [];
  const refFields = fields.filter(f => f.type === 'ref');
  
  for (const f of refFields) {
    const parentModule = f.refModule;
    const parentId = rec[f.name];
    if (parentId && db[parentModule]) {
      const parentRec = getActiveList(db[parentModule]).find(p => String(p.id) === String(parentId));
      if (parentRec) {
        parents[parentModule] = parentRec;
      }
    }
  }
  return parents;
}

class CRMSearchService {
  static search(query, rawDb) {
    const db = filterDb(rawDb);
    const qLower = query.toLowerCase().trim();
    
    const metadataPath = path.join(__dirname, '..', 'config', 'metadata.json');
    let metadata = {};
    try {
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      }
    } catch (e) {
      console.error("Failed to read metadata.json in CRMSearchService:", e);
    }
    
    const modules = metadata.modules || {};
    
    // Step 1 & 2 & 3 & 4: Intent detection & ranking
    const { winner, ranking } = classifyIntent(query, db);
    
    const mapping = {
      Employees: 'employees',
      Attendance: 'attendance',
      Payroll: 'salaries',
      Leaves: 'leaves',
      Leads: 'leads',
      Customers: 'customers',
      Properties: 'properties',
      Projects: 'projects',
      Inventory: 'properties',
      Payments: 'deals',
      Pitches: 'property_pitch_history',
      Queries: 'queries',
      Deals: 'deals',
      EmployeeNotices: 'employee_notices',
      DailyPriceLists: 'daily_price_lists',
      Documents: 'documents'
    };

    let targetModuleKey = winner ? mapping[winner] : null;
    const matchedResults = [];
    
    if (targetModuleKey && db[targetModuleKey]) {
      const records = getActiveList(db[targetModuleKey]);
      
      const intentKeywords = new Set([
        'employee', 'employees', 'staff', 'worker', 'agent', 'profile', 'details',
        'attendance', 'present', 'absent', 'checkin', 'checkout', 'punch', 'working', 'hours', 'today', 'yesterday',
        'salary', 'payroll', 'deduction', 'bonus', 'allowance', 'settlement', 'gross', 'net', 'payslip',
        'leave', 'holiday', 'vacation', 'half', 'day', 'application', 'request',
        'lead', 'leads', 'inquiry', 'enquiry', 'prospect',
        'customer', 'client', 'buyer', 'seller', 'investor',
        'property', 'plot', 'house', 'villa', 'flat', 'shop', 'office', 'commercial', 'residential',
        'project', 'site', 'scheme', 'development',
        'inventory', 'stock', 'availability', 'unit', 'units',
        'payment', 'receipt', 'invoice', 'due', 'received',
        'pitch', 'pitches', 'pitched', 'recommend', 'recommended', 'by', 'to',
        'show', 'check', 'want', 'to', 'for', 'is', 'on', 'my', 'the', 'how', 'many', 'who', 'has'
      ]);

      const queryWords = qLower.split(/\s+/).filter(w => !intentKeywords.has(w) && w.length > 2);
      
      for (const rec of records) {
        let match = false;
        if (queryWords.length > 0) {
          match = queryWords.some(word => {
            return Object.keys(rec).some(k => {
              const val = rec[k];
              if (val === undefined || val === null) return false;
              return String(val).toLowerCase().includes(word);
            });
          });
        } else {
          match = true;
        }

        if (match) {
          matchedResults.push({ moduleKey: targetModuleKey, rec });
        }
      }
    }

    // Fallback to searching all modules if no target module matches or no target module winner was detected
    if (matchedResults.length === 0) {
      for (const mKey in modules) {
        const mConfig = modules[mKey];
        const fields = mConfig.fields || [];
        const records = getActiveList(db[mKey] || db[mConfig.id]);
        
        for (const rec of records) {
          let match = false;
          for (const f of fields) {
            const val = rec[f.name];
            if (val === undefined || val === null) continue;
            const valStr = String(val).toLowerCase();
            if (valStr === qLower || valStr.includes(qLower)) {
              match = true;
              break;
            }
          }
          if (match) {
            matchedResults.push({ moduleKey: mKey, rec });
          }
        }
      }
    }
    
    // Sort ranking to show non-zero scores first
    const nonZeroRankings = ranking.filter(r => r.score > 0);
    const rankingSummary = nonZeroRankings.length > 0 
      ? nonZeroRankings.map(r => `${r.module} (${r.score}%)`).join(', ')
      : 'General AI (70%)';

    // If highest confidence is low, return clarification request in rankingSummary
    const topScore = ranking[0].score;
    if (topScore > 0 && topScore < 70) {
      return {
        type: 'clarification',
        rankingSummary,
        data: ranking.slice(0, 3).map(r => r.module)
      };
    }

    if (matchedResults.length === 1) {
      const match = matchedResults[0];
      const rec = match.rec;
      const mKey = match.moduleKey;
      
      const parents = getParentEntities(mKey, rec, db, metadata);
      const related = getRelatedRecords(mKey, rec.id, db, metadata);
      
      return {
        type: 'entity360',
        rankingSummary,
        data: {
          moduleKey: mKey,
          moduleLabel: modules[mKey]?.label || mKey,
          record: rec,
          parents,
          related,
          fields: modules[mKey]?.fields || []
        }
      };
    }
    
    if (matchedResults.length > 1) {
      return {
        type: 'multipleMatches',
        rankingSummary,
        data: matchedResults.map(m => ({
          moduleKey: m.moduleKey,
          moduleLabel: modules[m.moduleKey]?.label || m.moduleKey,
          id: m.rec.id,
          name: m.rec.name || m.rec.person_name || m.rec.firm_name || m.rec.propertyName || m.rec.title || `Record ${m.rec.id}`,
          details: m.rec.status || m.rec.stage || m.rec.role || ''
        }))
      };
    }

    if (targetModuleKey && db[targetModuleKey]) {
      const list = getActiveList(db[targetModuleKey]);
      if (list.length > 0) {
        return {
          type: 'moduleList',
          rankingSummary,
          data: {
            moduleKey: targetModuleKey,
            moduleLabel: modules[targetModuleKey]?.label || targetModuleKey,
            records: list.slice(0, 10),
            fields: modules[targetModuleKey]?.fields || []
          }
        };
      }
    }
    
    return {
      type: 'suggestions',
      rankingSummary,
      data: []
    };
  }
}

module.exports = {
  CRMSearchService,
  isActiveRecord,
  getActiveList,
  filterDb,
  classifyIntent
};
