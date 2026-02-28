// scripts/currency.js – Currency converter with caching, fallback APIs, exponential backoff, and status indicator

(function() {
    // ====================== CONFIGURATION ======================
    const PRIMARY_API = 'https://api.exchangerate.host/latest?base={from}&symbols={to}';
    const FALLBACK_APIS = [
        'https://api.frankfurter.app/latest?from={from}&to={to}',
        'https://open.er-api.com/v6/latest/{from}' // returns all rates, we'll extract 'to'
    ];
    const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    const RETRY_ATTEMPTS = 2;
    const BASE_DELAY = 1000; // 1 second

    const FAILURE_WEBHOOK_URL = window.FAILURE_WEBHOOK_URL || ''; // optional, set in HTML

    // ====================== CACHE HELPERS ======================
    function getCacheKey(from, to) {
        return `sr_rate_${from}_${to}`.toLowerCase();
    }

    function getCachedRate(from, to) {
        const key = getCacheKey(from, to);
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        try {
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp < CACHE_TTL) {
                return { rate: data.rate, fresh: true };
            }
            // expired but keep for stale
            return { rate: data.rate, timestamp: data.timestamp, expired: true };
        } catch {
            return null;
        }
    }

    function setCachedRate(from, to, rate) {
        const key = getCacheKey(from, to);
        const data = { rate, timestamp: Date.now() };
        localStorage.setItem(key, JSON.stringify(data));
    }

    // ====================== FETCH WITH RETRIES (exponential backoff) ======================
    async function fetchWithRetries(url, attempts = RETRY_ATTEMPTS, baseDelay = BASE_DELAY) {
        let lastError;
        for (let i = 0; i <= attempts; i++) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } catch (err) {
                lastError = err;
                if (i < attempts) {
                    const delay = baseDelay * Math.pow(2, i);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }

    // ====================== RATE FETCHING WITH FALLBACK ======================
    async function fetchRateFromApi(from, to) {
        // Try primary
        const primaryUrl = PRIMARY_API.replace('{from}', from).replace('{to}', to);
        try {
            const data = await fetchWithRetries(primaryUrl);
            if (data && data.rates && data.rates[to] !== undefined) {
                return data.rates[to];
            }
            throw new Error('Invalid primary response');
        } catch (primaryErr) {
            // Log failure to webhook if configured
            if (FAILURE_WEBHOOK_URL) {
                fetch(FAILURE_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api: 'primary', from, to, error: primaryErr.message })
                }).catch(() => {});
            }

            // Try fallbacks
            for (const tmpl of FALLBACK_APIS) {
                try {
                    let url;
                    if (tmpl.includes('{to}')) {
                        url = tmpl.replace('{from}', from).replace('{to}', to);
                    } else {
                        url = tmpl.replace('{from}', from);
                    }
                    const data = await fetchWithRetries(url);
                    let rate;
                    if (data.rates && data.rates[to] !== undefined) {
                        rate = data.rates[to];
                    } else if (data.rates && typeof data.rates === 'object') {
                        // fallback: assume rates object contains target
                        rate = data.rates[to];
                    }
                    if (rate !== undefined) return rate;
                } catch (fallbackErr) {
                    if (FAILURE_WEBHOOK_URL) {
                        fetch(FAILURE_WEBHOOK_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ api: 'fallback', from, to, error: fallbackErr.message })
                        }).catch(() => {});
                    }
                }
            }
            throw new Error('All APIs failed');
        }
    }

    // ====================== MAIN getRate ======================
    async function getRate(from, to) {
        const cached = getCachedRate(from, to);
        if (cached && cached.fresh) {
            return { rate: cached.rate, status: 'live (cached)', fresh: true };
        }
        const staleCache = cached && cached.expired ? cached.rate : null;

        try {
            const rate = await fetchRateFromApi(from, to);
            setCachedRate(from, to, rate);
            return { rate, status: 'live', fresh: true };
        } catch (err) {
            if (staleCache !== null) {
                const cacheTime = cached.timestamp ? new Date(cached.timestamp).toLocaleString() : 'unknown';
                return {
                    rate: staleCache,
                    status: 'cached (stale)',
                    fresh: false,
                    message: `Showing last known rate (cached at ${cacheTime})`
                };
            }
            throw new Error('Unable to fetch live rate. Please try again.');
        }
    }

    // ====================== UI BINDING ======================
    document.addEventListener('DOMContentLoaded', function() {
        const amountInput = document.getElementById('amount');
        const fromSelect = document.getElementById('fromCurrency');
        const toSelect = document.getElementById('toCurrency');
        const convertBtn = document.getElementById('convertBtn');
        const retryBtn = document.getElementById('retryBtn');
        const resultSpan = document.getElementById('conversionResult');
        const apiStatusSpan = document.getElementById('apiStatus');
        const cacheMessageP = document.getElementById('cacheMessage');

        function setStatus(status, msg = '') {
            apiStatusSpan.textContent = status;
            apiStatusSpan.className = 'status-indicator';
            if (status.includes('live')) apiStatusSpan.classList.add('status-live');
            else if (status.includes('cached')) apiStatusSpan.classList.add('status-cached');
            else if (status.includes('Unable') || status.includes('Offline')) apiStatusSpan.classList.add('status-offline');
            cacheMessageP.textContent = msg;
        }

        async function performConversion() {
            const amount = parseFloat(amountInput.value) || 1;
            const from = fromSelect.value;
            const to = toSelect.value;

            resultSpan.textContent = 'Converting...';
            setStatus('Fetching...');

            try {
                const result = await getRate(from, to);
                const converted = (amount * result.rate).toFixed(2);
                resultSpan.textContent = `${converted} ${to}`;
                setStatus(result.status, result.message || '');
            } catch (error) {
                resultSpan.textContent = '—';
                setStatus('Offline', error.message);
            }
        }

        if (convertBtn) {
            convertBtn.addEventListener('click', performConversion);
            retryBtn.addEventListener('click', performConversion);
            // Auto-run on page load
            performConversion();
        }
    });
})();