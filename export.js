const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Entry = require('./models/entry');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/slambook';

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(s) {
    try {
        return new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) { return String(s); }
}

async function exportEntries() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const rows = await Entry.find().sort({ _id: 1 });
    console.log('Total entries found:', rows.length);

    let entryCards = '';
    rows.forEach((x, i) => {
        entryCards += `
        <div class="entry">
            <div class="entry-header">
                ${x.selfie ? `<div class="selfie-wrap"><img src="${x.selfie}" alt="selfie of ${esc(x.name)}"></div>` : ''}
                <div class="name">${i + 1}. ${esc(x.name)}</div>
                <div class="meta">&#128222; ${esc(x.phone)} &bull; &#128336; ${fmtDate(x.created_at)}</div>
            </div>
            <div class="label">Paragraph About Anjali</div>
            <div class="box">${esc(x.paragraph)}</div>
            <div class="label">&#128272; Secret Message</div>
            <div class="secret-box">
                <span class="badge">${x.anonymous ? 'Anonymous Secret' : 'Signed Secret'}</span>
                <span class="author">(Real Author: ${esc(x.name)} &bull; ${esc(x.phone)})</span>
                <div style="margin-top:8px; font-size:15px;">${esc(x.secret)}</div>
            </div>
            <div class="label">1. Favourite memory with Anjali</div>
            <div class="box">${esc(x.q1)}</div>
            <div class="label">2. Three words to describe Anjali</div>
            <div class="box">${esc(x.q2)}</div>
            <div class="label">3. What to remember after college</div>
            <div class="box">${esc(x.q3)}</div>
        </div>`;
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Digital Slam Book - Anjali V - All Entries</title>
<style>
    body { font-family: Georgia, serif; background: #f8f5ff; color: #211b2c; margin: 0; padding: 24px; }
    h1 { text-align: center; font-size: 32px; background: linear-gradient(90deg, #7048d8, #d35b99); -webkit-background-clip: text; color: transparent; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #7955d9; font-size: 14px; margin-bottom: 6px; }
    .total { text-align: center; color: #756c81; font-size: 13px; margin-bottom: 28px; }
    .entry { background: white; border: 1px solid #e6dfef; border-radius: 18px; padding: 24px; margin-bottom: 24px; box-shadow: 0 8px 25px rgba(94,58,160,0.07); page-break-inside: avoid; }
    .entry-header { border-bottom: 1px solid #f0eaff; padding-bottom: 12px; margin-bottom: 16px; }
    .selfie-wrap { text-align: center; margin-bottom: 12px; }
    .selfie-wrap img { width: 110px; height: 110px; object-fit: cover; border-radius: 50%; border: 3px solid #7048d8; }
    .name { font-size: 22px; font-weight: 700; }
    .meta { font-size: 13px; color: #756c81; margin-top: 3px; }
    .label { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #7048d8; margin: 14px 0 6px; }
    .box { background: #faf8ff; border-radius: 10px; padding: 12px 14px; font-size: 15px; line-height: 1.6; white-space: pre-wrap; }
    .secret-box { background: #fff4fa; border: 1px dashed #e891bd; border-radius: 12px; padding: 14px; }
    .badge { display: inline-block; background: #fbe3ef; color: #b82d75; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; margin-bottom: 6px; }
    .author { font-size: 12px; color: #7048d8; font-weight: 700; margin-left: 6px; }
    @media print { body { background: white; } .entry { box-shadow: none; border: 1px solid #ccc; } }
</style>
</head>
<body>
<h1>&#128140; Digital Slam Book</h1>
<div class="subtitle">A DIGITAL AUTOGRAPH BOOK OF ANJALI V</div>
<div class="total">Total Entries: ${rows.length} &bull; Exported on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
${entryCards}
</body>
</html>`;

    // Save to the current directory so it can be easily uploaded
    const outputPath = path.join(__dirname, 'SlamBook_All_Entries.html');
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log('FILE SAVED TO:', outputPath);
    console.log('You can now upload this file to Google Drive.');
    await mongoose.disconnect();
}

exportEntries().catch(e => { console.error('Error:', e.message); mongoose.disconnect(); });
