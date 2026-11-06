/**
 * SlamBook – Express backend
 * Deployed on Render (Node.js Web Service).
 * Static frontend is served by Vercel in production.
 */

'use strict';

const crypto  = require('crypto');
const express = require('express');
const path    = require('path');
const mongoose = require('mongoose');
const cors    = require('cors');
const { rateLimit } = require('express-rate-limit');

const drive = require('./drive-backup');
const Entry = require('./models/entry');

const app = express();

// ─── Environment guards ───────────────────────────────────────────────────────

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!process.env.ADMIN_PASSWORD) {
    if (IS_PRODUCTION) {
        console.error('[startup] FATAL: ADMIN_PASSWORD environment variable is not set. Set it in Render before deploying.');
        process.exit(1);
    } else {
        console.warn('[startup] WARNING: ADMIN_PASSWORD is not set – using insecure dev default. NEVER run in production without it.');
    }
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dev-only-insecure-default';

if (!process.env.MONGODB_URI) {
    if (IS_PRODUCTION) {
        console.error('[startup] FATAL: MONGODB_URI environment variable is not set. Set it in Render before deploying.');
        process.exit(1);
    } else {
        console.warn('[startup] WARNING: MONGODB_URI is not set – falling back to local MongoDB for development.');
    }
}
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/slambook';

// ─── Token helpers ────────────────────────────────────────────────────────────
// A lightweight HMAC-based session token:  <timestamp>.<signature>
// The signature covers the timestamp so the token cannot be forged without
// knowing ADMIN_PASSWORD, and it cannot be replayed after TOKEN_TTL_MS.

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function signToken(ts) {
    return crypto
        .createHmac('sha256', ADMIN_PASSWORD)
        .update(String(ts))
        .digest('hex');
}

function createToken() {
    const ts  = Date.now();
    const sig = signToken(ts);
    return `${ts}.${sig}`;
}

function verifyToken(token) {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [ts, sig] = parts;
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    if (Date.now() - tsNum > TOKEN_TTL_MS) return false;
    // Constant-time comparison to prevent timing attacks
    const expected = Buffer.from(signToken(ts));
    const provided  = Buffer.from(sig);
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
if (process.env.FRONTEND_URL) {
    // Support comma-separated list in case of preview domains
    process.env.FRONTEND_URL.split(',').forEach(u => {
        const trimmed = u.trim().replace(/\/$/, '');
        if (trimmed) allowedOrigins.push(trimmed);
    });
}

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (same-origin / curl / Render health checks)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password'],
    credentials: true
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────

// 10 MB covers a compressed 500×500 JPEG selfie with room to spare.
app.use(express.json({ limit: '10mb' }));

// ─── Static files (development only) ─────────────────────────────────────────
// In production Vercel serves the HTML. Keeping this for local `npm run dev`.

if (!IS_PRODUCTION) {
    app.use(express.static(path.join(__dirname, 'public')));
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // 10 attempts per window per IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' }
});

const submissionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,                    // 5 submissions per IP per hour
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many submissions from this device. Please try again later.' }
});

// ─── Admin authentication middleware ──────────────────────────────────────────

function requireAdmin(req, res, next) {
    const authHeader  = req.headers['authorization'];
    const passHeader  = req.headers['x-admin-password'];
    const token = passHeader ||
        (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (!token || !verifyToken(token)) {
        return res.status(401).json({ error: 'Unauthorized. Please log in again.' });
    }
    next();
}

// ─── Drive backup retry timing ────────────────────────────────────────────────

function intFromEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const RETRY_DELAY_MS    = intFromEnv('DRIVE_RETRY_DELAY_MS',    5 * 60 * 1000);
const RETRY_INTERVAL_MS = intFromEnv('DRIVE_RETRY_INTERVAL_MS', 60 * 1000);

// Guard against overlapping sweeps (e.g. if a sweep takes longer than the interval)
let _retryRunning = false;

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
        entry.driveBackup  = 'pending';
        entry.driveBackupAt = new Date();
        await entry.save().catch(() => {});
        return 'pending';
    }
}

async function retryPendingBackups() {
    if (!drive.isConfigured()) return;
    if (_retryRunning) return; // skip if previous sweep is still in progress
    _retryRunning = true;
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
                entry.driveBackup   = 'done';
                entry.driveBackupAt = new Date();
                await entry.save();
                console.log(`[drive] retry ok for ${entry._id}`);
            } catch (err) {
                entry.driveBackup   = 'pending';
                entry.driveBackupAt = new Date();
                await entry.save().catch(() => {});
                console.error(`[drive] retry failed for ${entry._id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[drive] retry sweep failed:', err.message);
    } finally {
        _retryRunning = false;
    }
}

// ─── MongoDB connection ───────────────────────────────────────────────────────

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000
})
.then(() => {
    console.log('[db] Connected to MongoDB Atlas');
    // Retry any pending Drive backups on startup (handles Render cold starts)
    retryPendingBackups();
    // Keep retrying on a schedule while the service is alive
    const scheduler = setInterval(retryPendingBackups, RETRY_INTERVAL_MS);
    // .unref() lets the process exit normally even if the interval is still pending
    if (scheduler.unref) scheduler.unref();
})
.catch(err => {
    console.error('[db] MongoDB connection failed:', err.message);
    if (IS_PRODUCTION) process.exit(1);
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    const mongoState = mongoose.connection.readyState;
    // 0=disconnected 1=connected 2=connecting 3=disconnecting
    const stateLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] || 'unknown';
    res.json({
        status: 'ok',
        mongo: stateLabel,
        timestamp: new Date().toISOString()
    });
});

// ─── Admin login ──────────────────────────────────────────────────────────────

app.post('/api/login', loginLimiter, (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password.' });
    }
    const token = createToken();
    return res.json({ ok: true, token });
});

// ─── Public entry submission ──────────────────────────────────────────────────

app.post('/api/entries', submissionLimiter, async (req, res) => {
    const { name, phone, paragraph, secret, q1, q2, q3, anonymous, selfie } = req.body || {};

    const textFields = { name, phone, paragraph, secret, q1, q2, q3 };
    for (const [field, value] of Object.entries(textFields)) {
        if (typeof value !== 'string' || !value.trim()) {
            return res.status(400).json({ error: `Field '${field}' is required and must not be empty.` });
        }
    }

    if (!selfie || typeof selfie !== 'string' || !selfie.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Please take or upload a selfie for identity verification.' });
    }

    // Rough size guard – base64 selfie should not exceed ~7 MB encoded
    // (MongoDB document limit is 16 MB; a 500×500 JPEG is well under 1 MB)
    if (selfie.length > 7 * 1024 * 1024) {
        return res.status(400).json({ error: 'Selfie image is too large. Please use the in-page compression.' });
    }

    try {
        const newEntry = new Entry({
            name:      name.trim(),
            phone:     phone.trim(),
            paragraph: paragraph.trim(),
            secret:    secret.trim(),
            q1:        q1.trim(),
            q2:        q2.trim(),
            q3:        q3.trim(),
            anonymous: anonymous ? 1 : 0,
            selfie
        });
        const savedEntry = await newEntry.save();
        const driveBackup = await backupEntryToDrive(savedEntry);
        res.json({ ok: true, id: savedEntry._id, driveBackup });
    } catch (err) {
        console.error('[entries] POST failed:', err.message);
        res.status(500).json({ error: 'Failed to save your entry. Please try again.' });
    }
});

// ─── Admin: list entries ──────────────────────────────────────────────────────

app.get('/api/entries', requireAdmin, async (req, res) => {
    try {
        const entries = await Entry.find().sort({ _id: -1 });
        const formatted = entries.map(entry => {
            const obj = entry.toObject();
            obj.id = obj._id;
            return obj;
        });
        res.json(formatted);
    } catch (err) {
        console.error('[entries] GET failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch entries.' });
    }
});

// ─── Admin: delete entry ──────────────────────────────────────────────────────

app.delete('/api/entries/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid entry ID.' });
    }
    try {
        const result = await Entry.findByIdAndDelete(id);
        if (!result) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ ok: true });
    } catch (err) {
        console.error('[entries] DELETE failed:', err.message);
        res.status(500).json({ error: 'Failed to delete entry.' });
    }
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[server] SlamBook running on port ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
});
