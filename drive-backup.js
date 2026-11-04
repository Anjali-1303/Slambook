const DRIVE_WEBHOOK_URL = process.env.DRIVE_WEBHOOK_URL;
const DRIVE_SHARED_SECRET = process.env.DRIVE_SHARED_SECRET;

function isConfigured() {
    return Boolean(DRIVE_WEBHOOK_URL && DRIVE_SHARED_SECRET);
}

function toPayload(entry) {
    return {
        secret: DRIVE_SHARED_SECRET,
        id: String(entry._id || entry.id || ''),
        name: entry.name,
        phone: entry.phone,
        paragraph: entry.paragraph,
        secretMessage: entry.secret,
        anonymous: Boolean(entry.anonymous),
        q1: entry.q1,
        q2: entry.q2,
        q3: entry.q3,
        selfie: entry.selfie || '',
        createdAt: entry.created_at || new Date()
    };
}

async function sendToDrive(entry, { timeoutMs = 8000 } = {}) {
    if (!isConfigured()) {
        throw new Error('Drive backup is not configured (DRIVE_WEBHOOK_URL / DRIVE_SHARED_SECRET missing)');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(DRIVE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toPayload(entry)),
            signal: controller.signal,
            redirect: 'follow'
        });

        const body = (await res.text()).trim();
        if (!res.ok) {
            throw new Error(`Drive webhook returned ${res.status}: ${body.slice(0, 200)}`);
        }
        if (body.toLowerCase() !== 'ok') {
            throw new Error(`Drive webhook rejected the entry: ${body.slice(0, 200)}`);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Drive webhook timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { sendToDrive, isConfigured };
