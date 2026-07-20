const fs = require('fs');
const path = require('path');
const { CRMSearchService } = require('../services/crmSearchService');

// Read AI configurations
function getAIConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'ai-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error("Error reading ai-config.json:", e);
  }
  return { provider: "mock" };
}

/**
 * Universal AI dispatch routine
 */
async function generateAIResponse(prompt, systemPrompt, contextData = {}) {
  const config = getAIConfig();
  const provider = config.provider || "mock";

  // If provider is mock or no API key is provided, trigger dynamic data-driven fallback engine
  if (provider === "mock" || !hasKey(config, provider)) {
    return generateMockAIResponse(prompt, systemPrompt, contextData);
  }

  // Serialize active context data safely for external LLMs
  let contextText = "";
  if (contextData && Object.keys(contextData).length > 0) {
    const cleanContext = {};
    for (const key in contextData) {
      if (Array.isArray(contextData[key])) {
        if (contextData[key].length > 0) {
          cleanContext[key] = contextData[key].map(rec => {
            const { password, deleted, isDeleted, archived, active, ...rest } = rec;
            return rest;
          });
        }
      } else {
        cleanContext[key] = contextData[key];
      }
    }
    contextText = `\n\nActive CRM Database Context (Strictly use ONLY this data to construct your response):\n${JSON.stringify(cleanContext, null, 2)}`;
  }

  const finalSystemPrompt = systemPrompt + contextText;

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.openai.apiKey}`
        },
        body: JSON.stringify({
          model: config.openai.model || "gpt-4o",
          messages: [
            { role: "system", content: finalSystemPrompt },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }

    if (provider === "gemini") {
      const model = config.gemini.model || "gemini-2.5-flash";
      const apiKey = config.gemini.apiKey;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${finalSystemPrompt}\n\nUser Request: ${prompt}` }] }
          ]
        })
      });
      const data = await res.json();
      return data.candidates[0].content.parts[0].text;
    }

    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.claude.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: config.claude.model || "claude-3-5-sonnet",
          system: finalSystemPrompt,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000
        })
      });
      const data = await res.json();
      return data.content[0].text;
    }

    if (provider === "deepseek") {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.deepseek.apiKey}`
        },
        body: JSON.stringify({
          model: config.deepseek.model || "deepseek-chat",
          messages: [
            { role: "system", content: finalSystemPrompt },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }

    if (provider === "local") {
      const endpoint = config.local.endpoint || "http://localhost:11434/v1";
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "local-model",
          messages: [
            { role: "system", content: finalSystemPrompt },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }
  } catch (e) {
    console.error(`AI provider ${provider} call failed, triggering mock fallback:`, e);
  }

  // Fallback if API calls fail
  return generateMockAIResponse(prompt, systemPrompt, contextData);
}

function hasKey(config, provider) {
  if (provider === "local") return true;
  if (!config[provider]) return false;
  return !!config[provider].apiKey;
}

/**
 * High-fidelity, deterministic rule-based response generator (Mock Provider)
 */
function generateMockAIResponse(prompt, systemPrompt, context) {
  const pLower = prompt.toLowerCase().trim();
  const sLower = systemPrompt.toLowerCase();

  // 1. LEAD SCORING REQUEST
  if (sLower.includes("lead score") || pLower.includes("score")) {
    const item = context.lead || context.customer || {};
    const visits = context.siteVisits || [];
    const followups = context.followups || [];
    const budget = parseFloat(String(item.budget || 0).replace(/[^0-9.]/g, '')) || 0;

    let score = 35; // base score
    const reasons = [];

    if (budget > 10000000) {
      score += 15;
      reasons.push("High budget listing indicates premium buyer segment.");
    } else if (budget > 5000000) {
      score += 10;
      reasons.push("Mid-tier budget segment matching active projects.");
    }

    if (visits.length > 0) {
      score += 25;
      reasons.push(`Client completed ${visits.length} property site visit(s), showing strong buyer commitment.`);
    } else {
      reasons.push("No site visits scheduled yet; pending initial property tour.");
    }

    if (followups.length > 2) {
      score += 15;
      reasons.push(`Frequent follow-up touchpoints (${followups.length} logs) maintain high engagement.`);
    }

    score = Math.min(100, Math.max(0, score));
    let label = "Cold";
    if (score >= 85) label = "Very Hot";
    else if (score >= 70) label = "Hot";
    else if (score >= 50) label = "Warm";

    return JSON.stringify({
      score,
      label,
      reasons
    }, null, 2);
  }

  // 2. PROPERTY RECOMMENDATIONS REQUEST
  if (sLower.includes("recommendation") || pLower.includes("recommend")) {
    const item = context.lead || context.customer || {};
    const properties = context.properties || [];
    const budget = parseFloat(String(item.budget || 0).replace(/[^0-9.]/g, '')) || 0;
    const locality = String(item.locality || "").toLowerCase().trim();
    const propType = String(item.propertyType || "").toLowerCase().trim();

    const matches = properties.map(p => {
      let matchScore = 50;
      const pPrice = parseFloat(String(p.demand || p.price || 0).replace(/[^0-9.]/g, '')) || 0;
      const pLoc = String(p.locality || "").toLowerCase().trim();
      const pType = String(p.propertyType || "").toLowerCase().trim();

      // Budget check
      if (budget > 0 && pPrice > 0) {
        const diff = Math.abs(budget - pPrice) / budget;
        if (diff <= 0.1) matchScore += 25;
        else if (diff <= 0.25) matchScore += 15;
      }
      if (locality && pLoc && pLoc.includes(locality)) matchScore += 15;
      if (propType && pType && pType.includes(propType)) matchScore += 10;

      matchScore = Math.min(99, Math.max(20, matchScore));
      return {
        id: p.id,
        name: p.propertyName || p.name || `Property ${p.id}`,
        locality: p.locality || "N/A",
        price: p.demand || p.price || "Contact Owner",
        propertyType: p.propertyType || "N/A",
        status: p.status || "Available",
        matchPercentage: matchScore
      };
    });

    matches.sort((a, b) => b.matchPercentage - a.matchPercentage);
    return JSON.stringify(matches.slice(0, 5), null, 2);
  }

  // 3. WHATSAPP & EMAIL TEMPLATES
  if (pLower.includes("whatsapp") || pLower.includes("email") || pLower.includes("template")) {
    const name = context.customerName || context.name || "Client";
    const project = context.projectName || "Gagan Realtech Projects";
    const employee = context.employeeName || "Your Relationship Manager";

    if (pLower.includes("whatsapp")) {
      if (pLower.includes("visit") || pLower.includes("site")) {
        return `Hello ${name},\n\nHope you are doing well. This is ${employee} from Gagan Realtech. We have scheduled a site visit for you to inspect ${project}. Looking forward to showcasing the layout. Please let us know if the time suits you. Thank you!`;
      }
      return `Hello ${name},\n\nThank you for reaching out to Gagan Realtech. We are looking forward to helping you locate your ideal property. Let's arrange a brief call. Regards, ${employee}`;
    } else {
      return JSON.stringify({
        subject: `Property Options Selection: ${project} Updates`,
        body: `Dear ${name},\n\nI hope this email finds you well.\n\nFollowing up on our discussions, I am sharing the updated inventory layouts and payment plan terms for our under-construction listings in ${project}.\n\nWarm regards,\n\n${employee}\nSales Specialist\nGagan Realtech`,
        cta: "Schedule Property Visit"
      }, null, 2);
    }
  }

  // 4. DAILY / EVENING REPORT BRIEFING
  if (pLower.includes("brief") || pLower.includes("summary") || pLower.includes("morning") || pLower.includes("evening")) {
    const followups = context.followups || [];
    const visits = context.siteVisits || [];
    const tasks = context.tasks || [];
    const employees = context.employees || [];

    const overdueCount = tasks.filter(t => t.status !== 'Completed').length;
    const leavesCount = employees.filter(e => e.status === 'On Leave').length;

    if (pLower.includes("evening") || pLower.includes("achievement")) {
      return JSON.stringify({
        callsCompleted: followups.filter(f => f.status === 'Completed' || f.status === 'Call Completed').length,
        visitsCompleted: visits.length,
        dealsClosed: (context.deals || []).length,
        pendingTasks: overdueCount,
        scheduleTomorrow: "Schedule 3 followups and 1 site visit"
      }, null, 2);
    }

    return JSON.stringify({
      todayFollowups: followups.length,
      todayVisits: visits.length,
      overdueTasks: overdueCount,
      employeesOnLeave: leavesCount,
      pendingSales: overdueCount,
      expectedRevenue: "₹85.6 Cr",
      priorityCustomers: (context.customers || []).slice(0, 3).map(c => c.name)
    }, null, 2);
  }

  // 5. INSIGHTS / ANALYTICS WIDGETS
  if (pLower.includes("insight") || pLower.includes("facebook") || pLower.includes("facebook ads")) {
    return JSON.stringify([
      "Leads volume is stable this week, with active follow-ups completed.",
      "Direct referrals from existing clients show 12% higher booking rate.",
      "Property segment 'Commercial Booths' is experiencing maximum click activity."
    ], null, 2);
  }  // Helper maps & functions
  const moduleIcons = {
    employees: '👤',
    customers: '🤝',
    leads: '📌',
    properties: '🏠',
    projects: '🏗️',
    attendance: '📅',
    leaves: '🗓️',
    salaries: '💵',
    tasks: '📋',
    follow_ups: '📞',
    deals: '🧾',
    sales_bookings: '🧾',
    queries: '❓',
    property_pitches: '💡',
    daily_price_lists: '📊',
    employee_notices: '📢',
    live_track_map: '📍',
    settings: '⚙️',
    metadata: '🗄️',
    permission_matrix: '🔐',
    documents: '📄'
  };

  const moduleButtonLabels = {
    employees: 'Open Employee Profile',
    customers: 'Open Customer Profile',
    leads: 'Open Lead',
    properties: 'View Property',
    projects: 'View Project',
    attendance: 'View Attendance',
    leaves: 'View Leave Details',
    salaries: 'View Salary Details',
    tasks: 'Open Task',
    follow_ups: 'Open Follow-up',
    deals: 'Open Deal',
    sales_bookings: 'Open Booking',
    queries: 'Open Query',
    property_pitches: 'Open Pitch',
    daily_price_lists: 'View Price List',
    employee_notices: 'View Notice',
    live_track_map: 'View Map',
    settings: 'Open Settings',
    metadata: 'Open Metadata',
    permission_matrix: 'Open Permission Matrix',
    documents: 'Open Document'
  };

  function getModulePath(mKey, id) {
    if (mKey === 'attendance') return 'attendance';
    if (mKey === 'salaries' || mKey === 'salary') return 'salary';
    return `${mKey}/${id}`;
  }

  // 6. CRM SEARCH SERVICE ROUTER
  const result = CRMSearchService.search(prompt, context);
  const rankHeader = result.rankingSummary ? `*Ranked Modules by Score: ${result.rankingSummary}*\n\n` : '';

  if (result.type === 'entity360') {
    const info = result.data;
    const rec = info.record;
    const mKey = info.moduleKey;
    const icon = moduleIcons[mKey] || '📄';
    const btnLabel = moduleButtonLabels[mKey] || 'View Details';
    const linkPath = getModulePath(mKey, rec.id);
    
    // Resolve clean display name for header
    let displayName = rec.name || rec.person_name || rec.firm_name || rec.propertyName || rec.title || rec.id;
    if (mKey === 'property_pitch_history') {
      const parentCust = context.customers?.find(c => String(c.id) === String(rec.customerId)) || context.leads?.find(l => String(l.id) === String(rec.customerId));
      const custName = parentCust ? (parentCust.name || parentCust.person_name) : (rec.customerName || 'Customer');
      const parentProp = context.properties?.find(p => String(p.id) === String(rec.propertyId));
      const propName = parentProp ? (parentProp.propertyName || parentProp.name) : (rec.propertyName || 'Property');
      displayName = `Pitch: ${propName} to ${custName}`;
    }

    // Build field summary list with referenced name lookups to override stale text values
    const fieldDetails = info.fields
      .filter(f => f.name !== 'id' && rec[f.name] !== undefined && rec[f.name] !== null && rec[f.name] !== '')
      .map(f => {
        if (f.name === 'customerName' && rec.customerId) {
          const parent = context.customers?.find(c => String(c.id) === String(rec.customerId)) || context.leads?.find(l => String(l.id) === String(rec.customerId));
          if (parent) {
            return `- **${f.label}:** ${parent.name || parent.person_name || parent.firm_name}`;
          }
        }
        if (f.name === 'employeeName' && rec.employeeId) {
          const parent = context.employees?.find(e => String(e.id) === String(rec.employeeId));
          if (parent) {
            return `- **${f.label}:** ${parent.name}`;
          }
        }
        if (f.name === 'propertyName' && rec.propertyId) {
          const parent = context.properties?.find(p => String(p.id) === String(rec.propertyId));
          if (parent) {
            return `- **${f.label}:** ${parent.propertyName || parent.name}`;
          }
        }
        return `- **${f.label}:** ${rec[f.name]}`;
      })
      .join('\n');
      
    // Build parent connections
    const parentList = Object.keys(info.parents).map(pKey => {
      const pRec = info.parents[pKey];
      const pName = pRec.name || pRec.person_name || pRec.firm_name || pRec.propertyName || pRec.title || pRec.id;
      const pLinkPath = getModulePath(pKey, pRec.id);
      const pBtnLabel = moduleButtonLabels[pKey] || 'View';
      return `- **Connected ${pKey}:** [${pName} (${pRec.id})](file:///module/${pLinkPath})`;
    }).join('\n');

    // Build related items lists
    const relatedList = Object.keys(info.related).map(rKey => {
      const list = info.related[rKey];
      return `\n#### 🔗 Related ${rKey.toUpperCase()} (${list.length})
${list.slice(0, 5).map(item => {
    const name = item.name || item.person_name || item.firm_name || item.propertyName || item.title || item.id;
    const status = item.status || item.stage || item.result || '';
    const rLinkPath = getModulePath(rKey, item.id);
    return `- [${name} (${item.id})](file:///module/${rLinkPath}) ${status ? `• Status: ${status}` : ''}`;
  }).join('\n')}`;
    }).join('\n');

    let quickActionsBlock = '';
    if (mKey === 'employees') {
      quickActionsBlock = `\n\n#### ⚡ Quick Actions\n[Open Profile](file:///module/employees/${rec.id}) [Attendance](file:///module/attendance?employeeId=${rec.id}) [Payroll](file:///module/salary?employeeId=${rec.id}) [Leave](file:///module/leaves?employeeId=${rec.id}) [Assigned Leads](file:///module/leads?assignedEmployeeId=${rec.id}) [Assigned Customers](file:///module/customers?relationshipManagerId=${rec.id}) [Property Pitches](file:///module/property_pitch_history?employeeName=${encodeURIComponent(rec.name || '')}) [Meetings](file:///module/follow_ups?employeeId=${rec.id}) [Performance](file:///module/employees/${rec.id})`;
    } else if (mKey === 'customers') {
      quickActionsBlock = `\n\n#### ⚡ Quick Actions\n[Open Customer](file:///module/customers/${rec.id}) [Interested Properties](file:///module/properties?customerId=${rec.id}) [Property Pitches](file:///module/property_pitch_history?customerId=${rec.id}) [Payments](file:///module/deals?customerId=${rec.id}) [Meetings](file:///module/follow_ups?customerId=${rec.id}) [Documents](file:///module/documents?customerId=${rec.id}) [Timeline](file:///module/customers/${rec.id})`;
    } else if (mKey === 'leads') {
      quickActionsBlock = `\n\n#### ⚡ Quick Actions\n[Open Lead](file:///module/leads/${rec.id}) [Customer](file:///module/customers?leadId=${rec.id}) [Property Pitches](file:///module/property_pitch_history?customerId=${rec.id}) [Follow-ups](file:///module/follow_ups?customerId=${rec.id}) [Meetings](file:///module/follow_ups?customerId=${rec.id}) [Call History](file:///module/follow_ups?customerId=${rec.id}) [WhatsApp](https://wa.me/91${rec.phone || ''}?text=Hi) [Documents](file:///module/documents?leadId=${rec.id}) [Booking](file:///module/sales_bookings?leadId=${rec.id})`;
    } else if (mKey === 'properties') {
      quickActionsBlock = `\n\n#### ⚡ Quick Actions\n[Open Property](file:///module/properties/${rec.id}) [Project](file:///module/projects/${rec.projectId || 'PROJ-001'}) [Builder](file:///module/properties/${rec.id}) [Property Pitch History](file:///module/property_pitch_history?propertyId=${rec.id}) [Interested Customers](file:///module/customers?propertyId=${rec.id}) [Assigned Employees](file:///module/employees?propertyId=${rec.id}) [Follow-ups](file:///module/follow_ups?propertyId=${rec.id}) [Site Visits](file:///module/site_visits?propertyId=${rec.id}) [Documents](file:///module/documents?propertyId=${rec.id}) [Booking](file:///module/sales_bookings?propertyId=${rec.id})`;
    }

    return rankHeader + `${icon} **${displayName}**\n🔗 [${btnLabel}](file:///module/${linkPath})\n\n- **Module:** **${info.moduleLabel}**\n${fieldDetails}\n\n${parentList ? `#### 📌 Associations\n${parentList}\n` : ''}${relatedList || ''}${quickActionsBlock}\n\n#### 🧠 CRM Manager Insights & Recommendations\nThis record is connected across your database. RM should follow up within 24 hours to ensure high operational success.`;
  }

  if (result.type === 'multipleMatches') {
    const matchesText = result.data.map(m => {
      const icon = moduleIcons[m.moduleKey] || '📄';
      const btnLabel = moduleButtonLabels[m.moduleKey] || 'Open';
      const linkPath = getModulePath(m.moduleKey, m.id);
      
      let displayName = m.name;
      if (m.moduleKey === 'property_pitch_history') {
        const rec = context.property_pitch_history?.find(p => String(p.id) === String(m.id));
        if (rec) {
          const parentCust = context.customers?.find(c => String(c.id) === String(rec.customerId)) || context.leads?.find(l => String(l.id) === String(rec.customerId));
          const custName = parentCust ? (parentCust.name || parentCust.person_name) : (rec.customerName || 'Customer');
          const parentProp = context.properties?.find(p => String(p.id) === String(rec.propertyId));
          const propName = parentProp ? (parentProp.propertyName || parentProp.name) : (rec.propertyName || 'Property');
          displayName = `Pitch: ${propName} to ${custName}`;
        }
      }
      
      return `${icon} **${displayName}**\n🔗 [${btnLabel}](file:///module/${linkPath})\n*Module:* **${m.moduleLabel}** ${m.details ? `\n*Status:* **${m.details}**` : ''}`;
    }).join('\n\n');

    return rankHeader + `### 🔍 Multiple Matches Found\n\nWe found multiple records matching your query in the CRM:\n\n${matchesText}\n\nPlease search using a specific ID or Full Name to view their 360° profile.`;
  }

  if (result.type === 'moduleList') {
    const info = result.data;
    const mKey = info.moduleKey;
    const icon = moduleIcons[mKey] || '📁';
    const btnLabel = moduleButtonLabels[mKey] || 'Open';
    
    const recordsText = info.records.map(rec => {
      let displayName = rec.name || rec.person_name || rec.firm_name || rec.propertyName || rec.title || rec.id;
      if (mKey === 'property_pitch_history') {
        const parentCust = context.customers?.find(c => String(c.id) === String(rec.customerId)) || context.leads?.find(l => String(l.id) === String(rec.customerId));
        const custName = parentCust ? (parentCust.name || parentCust.person_name) : (rec.customerName || 'Customer');
        const parentProp = context.properties?.find(p => String(p.id) === String(rec.propertyId));
        const propName = parentProp ? (parentProp.propertyName || parentProp.name) : (rec.propertyName || 'Property');
        displayName = `Pitch: ${propName} to ${custName}`;
      }
      
      const status = rec.status || rec.stage || rec.role || '';
      const linkPath = getModulePath(mKey, rec.id);
      return `${icon} **${displayName}**\n🔗 [${btnLabel}](file:///module/${linkPath})${status ? `\n*Status:* **${status}**` : ''}`;
    }).join('\n\n');

    return rankHeader + `### 📁 ${info.moduleLabel} Module Overview\n\nHere are the active records in this module:\n\n${recordsText}\n\nClick the links above to inspect any record in detail.`;
  }

  if (result.type === 'employee360') {
    const emp = result.data.details;
    return `### 👤 AI Employee 360° Profile: **${emp.name}** (${emp.id})
🔗 [Open Employee Profile](file:///module/employees/${emp.id})

- **Role / Profile:** ${emp.role}
- **Current Status:** ${emp.status}
- **Contact Details:** Phone: ${emp.contact.phone} • Email: ${emp.contact.email}

#### 📈 Sales Performance Metrics
- **Assigned Leads Pool:** **${result.data.assignedLeadsCount}** active leads.
- **Assigned Customers:** **${result.data.assignedCustomersCount}** clients.
- **Pending Follow-ups:** **${result.data.pendingFollowUpsCount}** outstanding calls.
- **Conducted Site Visits:** **${result.data.siteVisitsCount}** showings.
- **Deals Closed (Bookings):** **${result.data.bookingsCount}** conversions.
- **Revenue Generated:** **₹${result.data.revenueGenerated.toLocaleString('en-IN')}**
- **Conversion Rate:** ${result.data.conversionRate}

#### 🗓️ Leaves Taken
- **Leaves Registered:** ${result.data.leaves.length} registered entries.

#### 📋 Task List
- **Tasks Assigned:** ${result.data.currentTasks.length} pending tasks.

#### ⚡ Quick Actions
[Open Profile](file:///module/employees/${emp.id}) [Attendance](file:///module/attendance?employeeId=${emp.id}) [Payroll](file:///module/salary?employeeId=${emp.id}) [Leave](file:///module/leaves?employeeId=${emp.id}) [Assigned Leads](file:///module/leads?assignedEmployeeId=${emp.id}) [Assigned Customers](file:///module/customers?relationshipManagerId=${emp.id}) [Property Pitches](file:///module/property_pitch_history?employeeName=${encodeURIComponent(emp.name)}) [Meetings](file:///module/follow_ups?employeeId=${emp.id}) [Performance](file:///module/employees/${emp.id})

#### 🧠 AI Performance Summary & Recommendations
${emp.name} is demonstrating strong client engagement metrics. With ₹${result.data.revenueGenerated.toLocaleString('en-IN')} closed revenue, they are a high-performing asset.`;
  }

  if (result.type === 'customer360') {
    const c = result.data.basicDetails;
    return `### 🤝 AI Customer 360° Profile: **${c.name}** (${c.id})
🔗 [Open Customer Profile](file:///module/customers/${c.id})

- **Contact Details:** Phone: ${c.phone} • Email: ${c.email}
- **Current CRM Stage:** **${c.status}**
- **Budget Constraint:** **${result.data.budget}**
- **Preferred Locations:** ${result.data.preferredLocations}
- **Property Type Preference:** ${result.data.propertyType}
- **Assigned RM (Manager):** ${result.data.assignedEmployee}

#### 📞 Interaction & Journey History
- **Total Calls/Follow-ups logged:** **${result.data.totalCalls}** contacts.
- **Logged Site Visits:** ${result.data.siteVisits.length} visits completed.
- **Sales Bookings Closed:** ${result.data.bookings.length} bookings.

#### 📋 Tasks Checklist
- **Outstanding Tasks:** ${result.data.pendingTasks.length} pending reminders.

#### ⚡ Quick Actions
[Open Customer](file:///module/customers/${c.id}) [Interested Properties](file:///module/properties?customerId=${c.id}) [Property Pitches](file:///module/property_pitch_history?customerId=${c.id}) [Payments](file:///module/deals?customerId=${c.id}) [Meetings](file:///module/follow_ups?customerId=${c.id}) [Documents](file:///module/documents?customerId=${c.id}) [Timeline](file:///module/customers/${c.id})

#### 🧠 Journey Summary & Recommended Actions
Customer is in the **${result.data.stage}** stage with a budget of ${result.data.budget}. They have completed ${result.data.siteVisits.length} site visits.
**Recommended Next Best Action:** Contact within 24 hours to review payment plans or schedule secondary site visit.`;
  }

  if (result.type === 'property360') {
    const p = result.data;
    return `### 🏠 AI Property 360° Profile: **${p.name}** (${p.id})
🔗 [View Property](file:///module/properties/${p.id})

- **Project Name:** ${p.project}
- **Builder Details:** ${p.builder}
- **Current Status:** **${p.status}**
- **Current Registered Owner:** ${p.owner} (Phone: ${p.ownerContact})

#### 🏷️ Financials & Parameters
- **Quoted Price/Demand:** **${p.price}**
- **Availability:** ${p.availability}

#### 📞 Transaction & Pitch History
- **Pitched Count:** Shown to **${p.pitchesCount}** prospective buyers.
- **Site Visits Completed:** **${p.visitsCount}** visits.
- **Sales Bookings:** **${p.bookingsCount}** transactions.

#### ⚡ Quick Actions
[Open Property](file:///module/properties/${p.id}) [Project](file:///module/projects/${p.projectId || 'PROJ-001'}) [Builder](file:///module/properties/${p.id}) [Property Pitch History](file:///module/property_pitch_history?propertyId=${p.id}) [Interested Customers](file:///module/customers?propertyId=${p.id}) [Assigned Employees](file:///module/employees?propertyId=${p.id}) [Follow-ups](file:///module/follow_ups?propertyId=${p.id}) [Site Visits](file:///module/site_visits?propertyId=${p.id}) [Documents](file:///module/documents?propertyId=${p.id}) [Booking](file:///module/sales_bookings?propertyId=${p.id})

#### 🧠 AI Recommendation
This unit is located in a high-demand sector. Pitched to match active buyers seeking ${p.project}.`;
  }

  if (result.type === 'analytics') {
    const data = result.data;
    if (data.type === 'RM Conversion') {
      return `### 📈 RM Conversion Analysis
Based on closed sales bookings and lead assignment logs:
${data.metrics.map(m => `- **${m.name}:** ${m.rate} (${m.role})`).join('\n')}
${data.details}`;
    }
    if (data.type === 'Highest Sales') {
      return `### 🏆 Top Selling Employee Analysis
Based on booking logs and closed sales volume:
- **Top RM:** ${data.topPerformer} with **${data.volume}** in closed bookings this quarter.
- **Runner Up:** ${data.runnerUp} with **${data.runnerUpVolume}** in closed bookings this quarter.`;
    }
    if (data.type === 'Project Bookings Audits') {
      return `### 🏗️ Project Booking Audits
${data.projects.map(p => `- **${p.name}:** ${p.bookings} bookings (${p.status || 'Active'})`).join('\n')}`;
    }
    if (data.type === 'Monthly Revenue') {
      return `### 📊 CRM Revenue Analysis
- **Accumulated Monthly Revenue:** **${data.volume}** in closed booking deals.`;
    }
    if (data.type === 'Inactive Customers') {
      return `### ⚠️ Inactive Customers
The following clients have not been contacted recently:
${data.customers.map(c => `- **${c.name}** (${c.id}) - Last Active: ${c.lastActive}`).join('\n')}`;
    }
  }

  if (result.type === 'hotLeadsList') {
    if (result.data.length === 0) {
      return `There are currently no active leads tagged as "Hot" inside the database.`;
    }
    return `### 🔥 Live Hot Leads
Here are the active leads tagged as high-priority:
${result.data.map(l => `- **[${l.name || l.person_name} (${l.id})](file:///module/leads/${l.id})** - Budget: ${l.budget || 'N/A'} • Assigned to: ${l.assignedEmployeeId || 'RM'}`).join('\n')}
**Next Action:** RMs should call today to present the newly updated project sheets.`;
  }

  if (result.type === 'followupsList') {
    if (result.data.length === 0) {
      return `There are no pending follow-ups registered in the CRM today. All scheduled calls are completed!`;
    }
    return `### 📞 Today's Active Follow-ups
Here are the scheduled follow-up actions:
${result.data.slice(0, 5).map(f => `- **[Follow-up (${f.id})](file:///module/follow_ups/${f.id})** • Client: ${f.customerId || 'N/A'} • RM Assigned: ${f.employeeId || 'EMP-001'} • Status: ${f.status || 'Pending'}`).join('\n')}`;
  }

  if (result.type === 'highValueLeadsList') {
    if (result.data.length === 0) {
      return `There are currently no active leads matching a budget constraint above ₹1 Cr in the pool.`;
    }
    return `### 💎 Premium Leads (Above ₹1 Cr)
Here are the active high-value client leads:
${result.data.map(l => `- **[${l.name || l.person_name} (${l.id})](file:///module/leads/${l.id})** - Budget: ${l.budget} (Interest: ${l.interest_level || 'Warm'})`).join('\n')}`;
  }

  if (result.type === 'clarification') {
    return rankHeader + `No exact match found. The confidence score for your request is below 75%. Did you mean: ${result.data.join(', ')}? Please clarify your query.`;
  }

  if (result.type === 'suggestions') {
    if (result.data.length > 0) {
      return rankHeader + `No exact match found for "${prompt}". Did you mean:
${result.data.map(s => `- **${s.name}** (${s.type})`).join('\n')}`;
    }
  }

  return rankHeader + "No active matching record was found in the CRM.";
}

module.exports = {
  generateAIResponse
};
