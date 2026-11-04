/**
 * DIGITAL SLAM BOOK - Google Drive backup receiver
 * ================================================
 *
 * SETUP (one time, ~5 minutes)
 *
 * 1. Create a Google Sheet called "Slam Book Responses".
 * 2. In that Sheet: Extensions > Apps Script. Delete the sample code and paste
 *    this whole file in.
 * 3. Create a Drive folder called "Slam Book Selfies". Open it and copy the ID
 *    from the URL: https://drive.google.com/drive/folders/<THIS_PART_IS_THE_ID>
 *    Paste it into SELFIE_FOLDER_ID below.
 * 4. Generate a long random string (e.g. mash the keyboard for 40+ characters)
 *    and paste it into SHARED_SECRET below. You will use the SAME string as the
 *    DRIVE_SHARED_SECRET environment variable on your server.
 * 5. Click Deploy > New deployment > Select type "Web app".
 *      Description : Slam Book backup
 *      Execute as  : Me
 *      Who has access : Anyone
 *    Click Deploy and authorize the permissions Google asks for.
 * 6. Copy the "Web app" URL (it ends in /exec). That is your DRIVE_WEBHOOK_URL.
 * 7. Run setupSheet() once from the editor to create the header row.
 *
 * Every submission is appended as one row. The selfie is saved as an image file
 * in your private folder and its filename is written into the row. Retries are
 * de-duplicated by entry ID, so a network hiccup will never create duplicates.
 */

const SELFIE_FOLDER_ID = 'PASTE_FOLDER_ID_HERE';
const SHARED_SECRET = 'PASTE_LONG_RANDOM_SECRET_HERE';
const SHEET_NAME = 'Entries';

const HEADERS = [
    'Entry ID',
    'Created At',
    'Name',
    'Phone',
    'Paragraph',
    'Secret Message',
    'Anonymous',
    'Q1 Favourite Memory',
    'Q2 Three Words',
    'Q3 Remember After College',
    'Selfie File'
];

function setupSheet() {
    const sheet = getSheet_();
    if (sheet.getLastRow() === 0) {
        sheet.appendRow(HEADERS);
    }
    const head = sheet.getRange(1, 1, 1, HEADERS.length);
    head.setFontWeight('bold').setBackground('#7048d8').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 190);
    sheet.setColumnWidth(5, 320);
    sheet.setColumnWidth(6, 320);
    sheet.setColumnWidth(11, 240);
    return 'Sheet ready';
}

function doPost(e) {
    try {
        if (!e || !e.postData || !e.postData.contents) {
            return respond_('no-body');
        }

        const data = JSON.parse(e.postData.contents);

        if (!SHARED_SECRET || SHARED_SECRET.indexOf('PASTE_') === 0) {
            return respond_('error: SHARED_SECRET not configured in Apps Script');
        }
        if (data.secret !== SHARED_SECRET) {
            return respond_('unauthorized');
        }

        const sheet = getSheet_();
        if (sheet.getLastRow() === 0) {
            setupSheet();
        }

        const id = String(data.id || '');

        if (id) {
            const existing = sheet
                .getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1)
                .createTextFinder(id)
                .matchEntireCell(true)
                .findNext();
            if (existing) {
                return respond_('ok');
            }
        }

        let selfieFile = '';
        if (data.selfie && /^data:image\//.test(String(data.selfie))) {
            try {
                selfieFile = saveSelfie_(data.selfie, data.name);
            } catch (err) {
                selfieFile = 'UPLOAD_FAILED: ' + err.message;
            }
        }

        sheet.appendRow([
            id,
            data.createdAt ? new Date(data.createdAt) : new Date(),
            data.name || '',
            data.phone || '',
            data.paragraph || '',
            data.secretMessage || '',
            data.anonymous ? 'Yes' : 'No',
            data.q1 || '',
            data.q2 || '',
            data.q3 || '',
            selfieFile
        ]);

        const lastRow = sheet.getLastRow();
        sheet.getRange(lastRow, 2).setNumberFormat('yyyy-mm-dd hh:mm');
        sheet.getRange(lastRow, 5, 1, 3).setWrap(true);

        return respond_('ok');
    } catch (err) {
        return respond_('error: ' + err.message);
    }
}

function saveSelfie_(dataUrl, name) {
    if (SELFIE_FOLDER_ID.indexOf('PASTE_') === 0) {
        throw new Error('SELFIE_FOLDER_ID not configured');
    }
    const parts = String(dataUrl).split(',');
    if (parts.length < 2) {
        throw new Error('Selfie data is malformed');
    }
    const mimeMatch = parts[0].match(/data:(image\/[a-zA-Z0-9.+-]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    let ext = mime.split('/')[1] || 'jpg';
    if (ext === 'jpeg') ext = 'jpg';

    const safe = String(name || 'friend')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40) || 'friend';

    const blob = Utilities.newBlob(
        Utilities.base64Decode(parts[1]),
        mime,
        `slambook_${safe}_${Date.now()}.${ext}`
    );

    return DriveApp.getFolderById(SELFIE_FOLDER_ID).createFile(blob).getName();
}

function getSheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
        throw new Error('This script must be bound to a Google Sheet');
    }
    return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function respond_(text) {
    return ContentService
        .createTextOutput(text)
        .setMimeType(ContentService.MimeType.TEXT);
}
