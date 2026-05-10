/**
 * Cron: Send schedule reminders to linked Telegram users
 * 
 * Triggered by Vercel Cron:
 * - 22:00 UTC (08:00 VLK) → morning reminders
 * - 10:00 UTC (20:00 VLK) → evening reminders for tomorrow
 */

const { getBot } = require('../../lib/bot');
const breadApi = require('../../lib/bread-api');

function getVladivostokDate(offsetDays = 0) {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    const vlk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Vladivostok' }));
    const yyyy = vlk.getFullYear();
    const mm = String(vlk.getMonth() + 1).padStart(2, '0');
    const dd = String(vlk.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

module.exports = async function handler(req, res) {
    try {
        const period = req.query.period || 'morning';
        const isMorning = period === 'morning';
        const targetDate = isMorning ? getVladivostokDate(0) : getVladivostokDate(1);
        const label = isMorning ? 'События на сегодня' : 'События на завтра';

        // Get linked users and schedule
        const users = await breadApi.getLinkedUsers();
        if (users.length === 0) return res.json({ ok: true, sent: 0 });

        const events = await breadApi.getSchedule(targetDate);
        const unsent = events.filter(e => !e.reminder_sent);
        if (unsent.length === 0) return res.json({ ok: true, sent: 0 });

        // Build message
        let message = `📅 *${label}* (${targetDate}):\n\n`;
        unsent.forEach((ev, i) => {
            const time = ev.event_time ? `⏰ ${ev.event_time}` : '';
            message += `${i + 1}. *${ev.title || 'Без названия'}* ${time}\n`;
            if (ev.content) message += `   ${ev.content}\n`;
            message += '\n';
        });

        // Send to all linked users
        const bot = getBot();
        for (const user of users) {
            try {
                await bot.api.sendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error(`[Cron] Failed to send to ${user.telegram_chat_id}:`, err.message);
            }
        }

        // Mark as sent
        await breadApi.markReminded(targetDate);

        res.json({ ok: true, sent: unsent.length, users: users.length });
    } catch (err) {
        console.error('[Cron Error]', err);
        res.status(500).json({ error: err.message });
    }
};
