/**
 * Bread API Client — HTTP interface to the VPS backend
 * Used by the Vercel-hosted Telegram bot to read/write data
 */

const BREAD_API_URL = process.env.BREAD_API_URL || 'https://bakery229.duckdns.org';
const BOT_API_KEY = process.env.BOT_API_KEY || '';

async function apiCall(method, path, body = null) {
    const url = `${BREAD_API_URL}${path}`;
    const opts = {
        method,
        headers: {
            'Authorization': `Bearer ${BOT_API_KEY}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${method} ${path}: ${res.status} ${text}`);
    }
    return res.json();
}

/** Get all active categories and subcategories */
async function getCategories() {
    return apiCall('GET', '/api/bot/categories');
}

/** Create a new entry */
async function createEntry(entry) {
    return apiCall('POST', '/api/bot/entries', entry);
}

/** Get entries with filters (for reports) */
async function getEntries({ date_from, date_to, type } = {}) {
    const params = new URLSearchParams();
    if (date_from) params.set('date_from', date_from);
    if (date_to) params.set('date_to', date_to);
    if (type) params.set('type', type);
    return apiCall('GET', `/api/bot/entries?${params}`);
}

/** Get schedule for a specific date */
async function getSchedule(date) {
    return apiCall('GET', `/api/bot/schedule/${date}`);
}

/** Mark reminders as sent */
async function markReminded(date) {
    return apiCall('POST', '/api/bot/mark-reminded', { date });
}

/** Get linked Telegram users */
async function getLinkedUsers() {
    return apiCall('GET', '/api/bot/users');
}

/** Link a chat_id to the admin user */
async function linkUser(chatId) {
    return apiCall('POST', '/api/bot/link-user', { chat_id: chatId });
}

module.exports = {
    getCategories, createEntry, getEntries,
    getSchedule, markReminded, getLinkedUsers, linkUser
};
