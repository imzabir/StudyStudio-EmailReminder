require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_KEY);

// ---------- SMART TIME CHECK ---------
function shouldSendNow() {
  const now = new Date();

  // UTC → Bangladesh (UTC+6)
  const bdHour = (now.getUTCHours() + 6) % 24;
  const minute = now.getUTCMinutes();

  return bdHour === 18 && minute >= 30 && minute < 40;
}

// ---------- DUPLICATE PREVENTION ----------
const logFile = path.join(__dirname, "lastRun.txt");

function alreadySentToday() {
  const today = new Date().toDateString();

  if (fs.existsSync(logFile)) {
    return fs.readFileSync(logFile, "utf-8") === today;
  }
  return false;
}

function markSent() {
  fs.writeFileSync(logFile, new Date().toDateString());
}

// ---------- SAFE JSON LOADER ----------
function loadJSON(file) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, file), "utf-8")
    );
  } catch (err) {
    console.error(`❌ Failed to load ${file}`, err.message);
    return [];
  }
}

const bangla = loadJSON("json/bangla.json");
const phy    = loadJSON("json/phy.json");
const chem   = loadJSON("json/chem.json");

function getRandom(arr) {
  if (!arr.length) return "No data";
  return arr[Math.floor(Math.random() * arr.length)];
}

const tips = [getRandom(bangla), getRandom(chem), getRandom(phy)];

// ---------- NOTATION PARSER ----------
function parseNotation(str) {
  if (typeof str !== 'string') return str;

  str = str.replace(/\^([^^]+)\^/g, '<sup>$1</sup>');
  str = str.replace(/\^(\w)/g, '<sup>$1</sup>');
  str = str.replace(/\_([^_]+)\_/g, '<sub>$1</sub>');
  str = str.replace(/<=>/g, '⇌');

  str = str.replace(/=([^=]+)=([^=]+)=>([^=]*)/g, (_, above, below, rest) => {
    return `<span style="display:inline-block;text-align:center;">
      <span style="font-size:0.8em;display:block;">${above}</span>
      <span>→</span>
      <span style="font-size:0.8em;display:block;">${below}</span>
    </span>${rest.slice(1)}`;
  });

  str = str.replace(/=([^=]+)=>([^=]*)/g, (_, above, rest) => {
    return `<span style="display:inline-block;text-align:center;">
      <span style="font-size:0.8em;display:block;">${above}</span>
      <span>→</span>
    </span>${rest.slice(1)}`;
  });

  str = str.replace(/==>/g, '→');

  return str;
}

// ---------- EMAIL RENDER ----------
function renderEmail(data) {
  const subjectColors = [
    { accent: '#2563eb', label: 'বাংলা', icon: '✦' },
    { accent: '#0d9488', label: 'Chemistry', icon: '⬡' },
    { accent: '#7c3aed', label: 'Physics', icon: '◎' }
  ];

  function renderValue(value) {
    if (Array.isArray(value)) {
      return value.map(v => `<div style="margin-left:10px;">${renderValue(v)}</div>`).join('');
    }

    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).map(([k, v]) =>
        `<div><strong>${k}:</strong> ${renderValue(v)}</div>`
      ).join('');
    }

    const parsed = parseNotation(String(value));

    return parsed.replace(
      /(\b\d[\d.,/^×·\s]*[a-zA-Zα-ωΑ-Ω²³⁻⁰¹²³⁴⁵⁶⁷⁸⁹]*\b)/g,
      '<span style="color:#2563eb;font-family:monospace;">$1</span>'
    );
  }

  const cards = data.map((item, i) => {
    const theme = subjectColors[i] || subjectColors[0];

    return `
      <div style="border:1px solid #e5e7eb;border-top:3px solid ${theme.accent};padding:12px;margin-bottom:10px;">
        <div style="color:${theme.accent};font-size:12px;">
          ${theme.icon} ${theme.label}
        </div>
        <div>${renderValue(item)}</div>
      </div>
    `;
  }).join('');

  return `
    <div style="font-family:sans-serif;">
      <h2>StudyStudio</h2>
      <p>${new Date().toLocaleString()}</p>
      ${cards}
    </div>
  `;
}

const body = renderEmail(tips);

// ---------- RETRY SYSTEM ----------
async function sendEmailWithRetry(retries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Attempt ${attempt}...`);

      const { data, error } = await resend.emails.send({
        from: 'Reminder <reminder@email.kirtasehidayah.app>',
        to: ['zabir.sgc@gmail.com'],
        subject: `Daily Reminder - ${new Date().toLocaleString()}`,
        html: body,
      });

      if (error) throw error;

      console.log("✅ Email sent:", data);
      markSent();
      return;

    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed:`, err.message);

      if (attempt < retries) {
        await new Promise(res => setTimeout(res, delay * attempt));
      } else {
        console.error("🚨 All attempts failed.");
      }
    }
  }
}

// ---------- MAIN ----------
(async function () {
  console.log("⏰ Checking schedule...");

  if (!shouldSendNow()) {
    console.log("❌ Not 6:30 PM window");
    return;
  }

  if (alreadySentToday()) {
    console.log("⚠️ Already sent today");
    return;
  }

  await sendEmailWithRetry();
})();