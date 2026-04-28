#!/usr/bin/env node
/**
 * Generate employee-focused training data for the NLP classifier.
 * Writes to data/train.generated.jsonl in the expected schema:
 * { text: string, intent: string, domain: string, risk?: string }
 *
 * Usage: node scripts/generate-employee-train.js [count]
 * Default count: 1000000 (10 lakh)
 */
const fs = require('fs');
const path = require('path');

const COUNT = parseInt(process.argv[2] || '1000000', 10);
const outPath = path.resolve(__dirname, '../data/train.generated.jsonl');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

// INTENTS (closed set)
const INTENTS = ['INCIDENT', 'SERVICE_REQUEST', 'HOW_TO', 'SECURITY_REPORT', 'ACCOUNT_ACCESS', 'CHANGE', 'PROBLEM', 'UNKNOWN'];
// DOMAINS
const DOMAINS = ['IDENTITY_ACCESS','NETWORK_VPN_WIFI','EMAIL_COLLAB','ENDPOINT_DEVICE','BUSINESS_APP_ERP_CRM','SOFTWARE_INSTALL_LICENSE','HARDWARE_PERIPHERAL','SECURITY_INCIDENT','KB_GENERAL','OTHER'];
const RISKS = ['LOW','MEDIUM','HIGH','CRITICAL'];

// Templates per domain
const TEMPLATES = {
  EMAIL_COLLAB: [
    "Outlook is frozen and emails won't send",
    "Can't send email in Outlook",
    "Email not syncing, Outlook stuck on loading",
    "Outlook crashes when opening calendar",
  ],
  HARDWARE_PERIPHERAL: [
    "Office printer shows offline status",
    "Scanner not detected on my PC",
    "External monitor flickers and goes black",
    "Keyboard disconnects intermittently",
  ],
  NETWORK_VPN_WIFI: [
    "Cannot connect to the corporate VPN",
    "Frequent VPN timeouts when connecting",
    "Wi‑Fi connected but no internet access",
    "VPN reports untrusted server warning",
  ],
  IDENTITY_ACCESS: [
    "Account locked after multiple login attempts",
    "Forgot password and need reset",
    "MFA token not working for login",
  ],
  SOFTWARE_INSTALL_LICENSE: [
    "Need installation of licensed Visio",
    "Requesting Adobe Acrobat Pro for documentation",
    "License activation failed for IntelliJ",
  ],
  BUSINESS_APP_ERP_CRM: [
    "SAP login failing with authentication error",
    "Salesforce access request for new project",
  ],
  SECURITY_INCIDENT: [
    "Received suspicious phishing email with attachment",
    "Laptop possibly infected with malware",
    "Unauthorized login alert on my account",
  ],
  OTHER: [
    "General help with setting up new device",
    "System running slow since last update",
  ],
};

function pickIntent(domain) {
  switch (domain) {
    case 'SECURITY_INCIDENT': return 'SECURITY_REPORT';
    case 'IDENTITY_ACCESS': return Math.random() < 0.6 ? 'ACCOUNT_ACCESS' : 'INCIDENT';
    case 'NETWORK_VPN_WIFI':
    case 'EMAIL_COLLAB':
    case 'HARDWARE_PERIPHERAL':
      return Math.random() < 0.7 ? 'INCIDENT' : 'PROBLEM';
    case 'SOFTWARE_INSTALL_LICENSE':
    case 'BUSINESS_APP_ERP_CRM':
      return Math.random() < 0.7 ? 'SERVICE_REQUEST' : 'CHANGE';
    default:
      return randomOf(['INCIDENT','SERVICE_REQUEST','HOW_TO','PROBLEM','UNKNOWN']);
  }
}

function pickRisk(domain) {
  if (domain === 'SECURITY_INCIDENT') return randomOf(['HIGH','CRITICAL']);
  if (domain === 'IDENTITY_ACCESS') return randomOf(['MEDIUM','HIGH']);
  if (domain === 'NETWORK_VPN_WIFI' || domain === 'EMAIL_COLLAB') return randomOf(['LOW','MEDIUM']);
  return 'MEDIUM';
}

// Weighted domain distribution skewed towards common helpdesk load
const DOMAIN_BUCKETS = [
  ['EMAIL_COLLAB', 0.20],
  ['NETWORK_VPN_WIFI', 0.22],
  ['HARDWARE_PERIPHERAL', 0.18],
  ['IDENTITY_ACCESS', 0.12],
  ['SOFTWARE_INSTALL_LICENSE', 0.10],
  ['BUSINESS_APP_ERP_CRM', 0.06],
  ['SECURITY_INCIDENT', 0.04],
  ['OTHER', 0.08],
];
const cumulative = [];
let acc = 0;
for (const [d,w] of DOMAIN_BUCKETS) { acc += w; cumulative.push([d,acc]); }
function sampleDomain() {
  const r = Math.random();
  for (const [d,c] of cumulative) if (r <= c) return d;
  return 'OTHER';
}

console.log(`Generating ${COUNT.toLocaleString()} employee training rows -> ${outPath}`);
const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });
let i = 0;
function write() {
  let ok = true;
  do {
    const domain = sampleDomain();
    const text = randomOf(TEMPLATES[domain] || TEMPLATES.OTHER);
    const intent = pickIntent(domain);
    const risk = pickRisk(domain);
    const row = JSON.stringify({ text, intent, domain, risk }) + '\n';
    i++;
    if (i === COUNT) {
      stream.write(row);
      console.log(`Done: ${COUNT.toLocaleString()} rows`);
    } else {
      ok = stream.write(row);
    }
  } while (i < COUNT && ok);
  if (i < COUNT) stream.once('drain', write);
}
write();

