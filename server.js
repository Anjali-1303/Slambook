const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const drive = require('./drive-backup');
const Entry = require('./models/entry');

const app = express();

// Admin password configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'anjali123';
if (!process.env.ADMIN_PASSWORD) {
    console.warn('[auth] ADMIN_PASSWORD is not set - falling back to the insecure default passcode.');
}

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/slambook';

// Drive backup retry tuning (env overrides exist for local testing)
function intFromEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const RETRY_DELAY_MS = intFromEnv('DRIVE_RETRY_DELAY_MS', 5 * 60 * 1000);
const RETRY_INTERVAL_MS = intFromEnv('DRIVE_RETRY_INTERVAL_MS', 60 * 1000);

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    retryPendingBackups();
    setInterval(retryPendingBackups, RETRY_INTERVAL_MS).unref();
  })
  .catch(err => console.error('Error connecting to MongoDB:', err));

// Mirrors an entry into the owner's Google Drive (Sheet + selfie folder).
// MongoDB stays the source of truth: a Drive failure is recorded as 'pending'
// and retried by the background sweep, never surfaced to the friend.
function markBackupPending(entry) {
    entry.driveBackup = 'pending';
    entry.driveBackupAt = new Date();
}

async function backupEntryToDrive(entry) {
    if (!drive.isConfigured()) {
        entry.driveBackup = 'skipped';
        await entry.save().catch(() => {});
        return 'skipped';
    }
    try {
        await drive.sendToDrive(entry);
        entry.driveBackup = 'done';
        entry.driveBackupAt = new Date();
        await entry.save();
        return 'done';
    } catch (err) {
        console.error(`[drive] backup failed for ${entry._id}:`, err.message);
        markBackupPending(entry);
        await entry.save().catch(() => {});
        return 'pending';
    }
}

// Retries entries that failed or were never mirrored (including entries created
// before Drive backup was enabled, so deploying this backfills the whole book).
async function retryPendingBackups() {
    if (!drive.isConfigured()) return;
    try {
        const cutoff = new Date(Date.now() - RETRY_DELAY_MS);
        const pending = await Entry.find({
            driveBackup: { $ne: 'done' },
            $or: [
                { driveBackupAt: { $exists: false } },
                { driveBackupAt: null },
                { driveBackupAt: { $lte: cutoff } }
            ]
        }).sort({ _id: -1 }).limit(20);

        for (const entry of pending) {
            try {
                await drive.sendToDrive(entry);
                entry.driveBackup = 'done';
                entry.driveBackupAt = new Date();
                await entry.save();
                console.log(`[drive] retried backup ok for ${entry._id}`);
            } catch (err) {
                markBackupPending(entry);
                await entry.save().catch(() => {});
                console.error(`[drive] retry failed for ${entry._id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[drive] retry sweep failed:', err.message);
    }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const passHeader = req.headers['x-admin-password'];
    const providedPass = passHeader || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (!providedPass || providedPass !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized access. Incorrect or missing admin password.' });
    }
    next();
}

// Admin login verification route
app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (password && password === ADMIN_PASSWORD) {
        return res.json({ ok: true, token: ADMIN_PASSWORD });
    }
    return res.status(401).json({ error: 'Incorrect password' });
});

// Public submission route
app.post('/api/entries', async (req, res) => {
    const { name, phone, paragraph, secret, q1, q2, q3, anonymous, selfie } = req.body || {};
    if (![name, phone, paragraph, secret, q1, q2, q3].every(x => typeof x === 'string' && x.trim())) {
        return res.status(400).json({ error: 'Please fill out all required text fields.' });
    }
    if (!selfie || typeof selfie !== 'string' || !selfie.startsWith('data:image')) {
        return res.status(400).json({ error: 'Please take or upload a selfie for identity verification!' });
    }

    try {
        const newEntry = new Entry({
            name: name.trim(),
            phone: phone.trim(),
            paragraph: paragraph.trim(),
            secret: secret.trim(),
            q1: q1.trim(),
            q2: q2.trim(),
            q3: q3.trim(),
            anonymous: anonymous ? 1 : 0,
            selfie
        });
        const savedEntry = await newEntry.save();
        const driveBackup = await backupEntryToDrive(savedEntry);
        res.json({ ok: true, id: savedEntry._id, driveBackup });
    } catch (err) {
        console.error('Error inserting entry:', err);
        res.status(500).json({ error: 'Failed to save entry' });
    }
});

// Admin-only route to get all entries
app.get('/api/entries', requireAdmin, async (req, res) => {
    try {
        const entries = await Entry.find().sort({ _id: -1 });
        // Map _id to id to maintain frontend compatibility if it relies on 'id' instead of '_id'
        const formattedEntries = entries.map(entry => {
            const obj = entry.toObject();
            obj.id = obj._id;
            return obj;
        });
        res.json(formattedEntries);
    } catch (err) {
        console.error('Error fetching entries:', err);
        res.status(500).json({ error: 'Failed to fetch entries' });
    }
});

// Admin-only route to delete an entry
app.delete('/api/entries/:id', requireAdmin, async (req, res) => {
    try {
        const result = await Entry.findByIdAndDelete(req.params.id);
        res.json({ ok: true, deleted: !!result });
    } catch (err) {
        console.error('Error deleting entry:', err);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Slam Book running on http://localhost:${PORT}`));
