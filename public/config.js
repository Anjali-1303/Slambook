/**
 * SlamBook – Frontend configuration
 *
 * This file is loaded by both index.html and admin.html before any other
 * scripts.  It sets window.SLAMBOOK_API_URL so every fetch() call in the
 * page uses the right backend without hardcoding URLs in multiple places.
 *
 * How the URL is resolved (first match wins):
 *   1. window.SLAMBOOK_API_URL already set before this script runs
 *      (lets Vercel inject it via a tiny inline <script> if needed)
 *   2. Empty string / same-origin  →  relative URLs work (local dev via Express)
 *   3. Defaults to empty string so relative /api/* calls work in local dev
 *
 * To point the Vercel frontend at the Render backend, add a single
 * <script> tag BEFORE config.js in your HTML:
 *
 *   <script>window.SLAMBOOK_API_URL = 'https://your-app.onrender.com';</script>
 *
 * Or, set it once here for the whole project if you prefer a hardcoded value
 * (remember to update it if your Render URL changes):
 *
 *   window.SLAMBOOK_API_URL = window.SLAMBOOK_API_URL || 'https://your-app.onrender.com';
 */

window.SLAMBOOK_API_URL = window.SLAMBOOK_API_URL || '';

// ─── Keep-awake / cold-start warm-up ─────────────────────────────────────────
// Render Free instances sleep after ~15 minutes of inactivity.  Hitting
// /api/health as soon as the page loads gives the backend a head-start so it
// is usually awake by the time the visitor tries to submit.
//
// Rules:
//  • Fires once on page load – not a polling loop.
//  • Does NOT block page rendering (fire-and-forget).
//  • Retries up to HEALTH_MAX_RETRIES times with exponential back-off.
//  • Surfaces a gentle status banner only when a user-initiated API call is
//    made while the backend is still waking (handled in each page's script).

(function initKeepAwake() {
    const HEALTH_URL        = (window.SLAMBOOK_API_URL || '') + '/api/health';
    const HEALTH_MAX_RETRIES = 4;
    const HEALTH_BASE_DELAY  = 3000; // ms – doubles each retry

    let _backendReady = false;
    let _healthCheckDone = false;

    async function checkHealth(attempt) {
        try {
            const res = await fetch(HEALTH_URL, {
                method: 'GET',
                // Do not send cookies to the backend (cross-origin in production)
                credentials: 'omit',
                // Short timeout – we just want to wake the dyno, not wait forever
                signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
            });
            if (res.ok) {
                _backendReady = true;
                _healthCheckDone = true;
                console.debug('[slambook] backend is awake');
                return;
            }
        } catch (_) {
            // Network error or timeout – backend is still waking up
        }

        if (attempt < HEALTH_MAX_RETRIES) {
            const delay = HEALTH_BASE_DELAY * Math.pow(2, attempt);
            console.debug(`[slambook] backend not ready yet, retrying in ${delay}ms (attempt ${attempt + 1})`);
            setTimeout(() => checkHealth(attempt + 1), delay);
        } else {
            _healthCheckDone = true;
            console.debug('[slambook] backend health check exhausted – it may still be waking up');
        }
    }

    // Expose state so page scripts can show a "waking up" notice if needed
    window.SLAMBOOK = window.SLAMBOOK || {};
    window.SLAMBOOK.isBackendReady = () => _backendReady;
    window.SLAMBOOK.isHealthCheckDone = () => _healthCheckDone;

    // Fire immediately, non-blocking
    checkHealth(0);
})();
