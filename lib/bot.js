/**
 * Telegram Bot — grammY (Webhook mode for Vercel)
 * 
 * Handles: text, voice → AI classification → save/report via Bread API
 * Runs as a serverless function, no persistent state
 */

const { Bot, InlineKeyboard } = require('grammy');
const { OpenAI } = require('openai');
const breadApi = require('./bread-api');

// --- Singleton instances (cached across warm invocations) ---

let _bot = null;
function getBot() {
    if (!_bot) {
        _bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
        setupHandlers(_bot);
    }
    return _bot;
}

let _ai = null;
function getAI() {
    if (!_ai) {
        _ai = new OpenAI({
            apiKey: process.env.AITUNNEL_API_KEY,
            baseURL: 'https://api.aitunnel.ru/v1/',
            timeout: 25000
        });
    }
    return _ai;
}

// Pending entries: cached in-memory across warm invocations
// If cold-started, user just re-sends the message
const pendingEntries = new Map();

// --- Helpers ---

function getVladivostokNow() {
    const now = new Date();
    const vlk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Vladivostok' }));
    const yyyy = vlk.getFullYear();
    const mm = String(vlk.getMonth() + 1).padStart(2, '0');
    const dd = String(vlk.getDate()).padStart(2, '0');
    const hh = String(vlk.getHours()).padStart(2, '0');
    const min = String(vlk.getMinutes()).padStart(2, '0');
    return {
        date: `${yyyy}-${mm}-${dd}`,
        time: `${hh}:${min}`,
        full: `${yyyy}-${mm}-${dd} ${hh}:${min}`
    };
}

async function callAI(messages) {
    const response = await getAI().chat.completions.create(
        { model: 'gemini-2.5-flash', messages },
        { timeout: 25000 }
    );
    return response.choices[0].message.content || '';
}

function parseAIJson(raw) {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
    return JSON.parse(jsonStr);
}

async function buildRouterPrompt() {
    const { categories, subcategories } = await breadApi.getCategories();
    const catList = categories.map(c => `${c.name} (${c.type})`).join(', ');
    const subList = subcategories.map(s => s.name).join(', ');
    const today = getVladivostokNow();

    return `Ты — Telegram AI-ассистент. Пользователь прислал сообщение.
Определи намерение: добавить запись (расход, доход, расписание, идея) ИЛИ получить отчёт?

Сегодня: ${today.full}. Часовой пояс: Asia/Vladivostok (UTC+10).
"Сегодня" = ${today.date}. "Завтра" = следующий день. "Неделя" = последние 7 дней.

Категории: ${catList}
Подкатегории финансов: ${subList}

ПРАВИЛА: Верни СТРОГО валидный JSON (без маркдауна, без \`\`\`).

ADD_ENTRY:
{
  "intent": "ADD_ENTRY",
  "entry": {
    "category": "schedule" | "expense" | "idea",
    "title": "...", "content": "...", "amount": 1000,
    "subcategory": "Еда", "event_date": "YYYY-MM-DD", "event_time": "HH:MM"
  }
}

REPORT:
{
  "intent": "REPORT",
  "reportParams": {
    "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD",
    "type": "schedule" | "expense" | "idea" | "all",
    "question": "вопрос пользователя"
  }
}

Если просто болтает:
{ "intent": "CHAT", "message": "ответ" }`;
}

function buildReportPrompt() {
    const today = getVladivostokNow();
    return `Ты — AI-ассистент. Сформируй красивый ответ на запрос по данным из базы.
Сегодня: ${today.full}. Часовой пояс: Asia/Vladivostok (UTC+10).
Используй Markdown (*жирность*, эмодзи). Не выдумывай данных. Для расходов — общая сумма + разбивка. Для расписания — хронологически. Верни ТЕКСТ (без JSON).`;
}

function buildPreview(entry) {
    let p = `✨ *Распознано:*\n📁 Тип: ${entry.category}\n`;
    if (entry.title) p += `🏷 Заголовок: ${entry.title}\n`;
    if (entry.amount) p += `💰 Сумма: ${entry.amount} ₽\n`;
    if (entry.subcategory) p += `🗂 Категория: ${entry.subcategory}\n`;
    if (entry.event_date) p += `📅 Дата: ${entry.event_date} ${entry.event_time || ''}\n`;
    if (entry.content) p += `📝 Описание: ${entry.content}\n`;
    return p;
}

// --- Bot Handlers ---

function setupHandlers(bot) {

    // /start — link chat to admin
    bot.command('start', async (ctx) => {
        try {
            await breadApi.linkUser(ctx.chat.id);
            await ctx.reply(
                '✅ Привязка выполнена!\n\n' +
                '📝 Текст — "Потратил 500 на обед"\n' +
                '🎤 Голосовое сообщение\n' +
                '📊 Отчёт — "Расходы за неделю"'
            );
        } catch (err) {
            await ctx.reply('❌ Ошибка привязки: ' + err.message);
        }
    });

    bot.command('ping', async (ctx) => {
        await ctx.reply('🟢 Бот жив! Vercel + Bread API.');
    });

    // Voice messages
    bot.on('message:voice', async (ctx) => {
        let statusMsg;
        try {
            statusMsg = await ctx.reply('⏳ Слушаю голосовое...');

            const file = await ctx.getFile();
            const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
            const resp = await fetch(fileUrl);
            if (!resp.ok) throw new Error(`Download: ${resp.statusText}`);
            const buffer = Buffer.from(await resp.arrayBuffer());
            const base64Audio = buffer.toString('base64');

            await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '🧠 Распознаю речь...');

            const transcription = await callAI([
                { role: 'system', content: 'Транскрибируй голосовое. Верни ТОЛЬКО текст на русском, без пояснений.' },
                { role: 'user', content: [
                    { type: 'text', text: 'Преобразуй в текст:' },
                    { type: 'input_audio', input_audio: { data: base64Audio, format: 'ogg' } }
                ]}
            ]);

            const userText = transcription.trim();
            if (!userText) {
                return ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '❌ Не удалось распознать речь.');
            }

            await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '🧠 Анализирую...');
            await processText(ctx, ctx.chat.id, statusMsg.message_id, userText);
        } catch (err) {
            console.error('[Voice Error]', err);
            const msg = '❌ ' + String(err.message || err).substring(0, 300);
            if (statusMsg) {
                try { await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg); } catch (_) {}
            }
        }
    });

    // Text messages
    bot.on('message:text', async (ctx) => {
        if (ctx.message.text.startsWith('/')) return;

        let statusMsg;
        try {
            statusMsg = await ctx.reply('⏳ Анализирую...');
            await processText(ctx, ctx.chat.id, statusMsg.message_id, ctx.message.text);
        } catch (err) {
            console.error('[Text Error]', err);
            const msg = '❌ ' + String(err.message || err).substring(0, 300);
            if (statusMsg) {
                try { await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg); } catch (_) {}
            }
        }
    });

    // Core: classify and route
    async function processText(ctx, chatId, statusMsgId, userText) {
        const routerPrompt = await buildRouterPrompt();
        const rawAI = await callAI([
            { role: 'system', content: routerPrompt },
            { role: 'user', content: userText }
        ]);
        const parsed = parseAIJson(rawAI);

        if (parsed.intent === 'CHAT') {
            return ctx.api.editMessageText(chatId, statusMsgId, parsed.message || '🤷');
        }

        if (parsed.intent === 'ADD_ENTRY') {
            const entry = parsed.entry;
            const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            pendingEntries.set(reqId, entry);
            setTimeout(() => pendingEntries.delete(reqId), 60 * 60 * 1000);

            const keyboard = new InlineKeyboard()
                .text('✅ Сохранить', `save_${reqId}`)
                .text('❌ Отмена', `cancel_${reqId}`);

            return ctx.api.editMessageText(chatId, statusMsgId, buildPreview(entry), {
                parse_mode: 'Markdown', reply_markup: keyboard
            });
        }

        if (parsed.intent === 'REPORT') {
            const rp = parsed.reportParams;
            const rawData = await breadApi.getEntries({
                date_from: rp.date_from, date_to: rp.date_to, type: rp.type
            });
            const reportText = await callAI([
                { role: 'system', content: buildReportPrompt() },
                { role: 'user', content: `Данные:\n${JSON.stringify(rawData)}\n\nВопрос: ${rp.question || userText}` }
            ]);
            // Try Markdown first; fall back to plain text if AI returns malformed markup
            try {
                return await ctx.api.editMessageText(chatId, statusMsgId, reportText, {
                    parse_mode: 'Markdown'
                });
            } catch (mdErr) {
                // Strip all Markdown symbols and send plain text
                const plain = reportText.replace(/[*_`\[\]]/g, '');
                return ctx.api.editMessageText(chatId, statusMsgId, plain);
            }
        }

        return ctx.api.editMessageText(chatId, statusMsgId, '🤔 Не понял запрос.');
    }

    // Inline buttons (save/cancel)
    bot.on('callback_query:data', async (ctx) => {
        const chatId = ctx.callbackQuery.message?.chat.id;
        const msgId = ctx.callbackQuery.message?.message_id;
        const data = ctx.callbackQuery.data;

        if (data.startsWith('cancel_')) {
            pendingEntries.delete(data.replace('cancel_', ''));
            await ctx.api.editMessageText(chatId, msgId, '❌ Отменено.');
            return ctx.answerCallbackQuery();
        }

        if (data.startsWith('save_')) {
            const reqId = data.replace('save_', '');
            const entry = pendingEntries.get(reqId);

            if (!entry) {
                await ctx.api.editMessageText(chatId, msgId, '⚠️ Истекло. Отправьте заново.');
                return ctx.answerCallbackQuery();
            }

            try {
                await breadApi.createEntry(entry);
                pendingEntries.delete(reqId);
                await ctx.api.editMessageText(chatId, msgId, '✅ Сохранено!');
            } catch (err) {
                await ctx.api.editMessageText(chatId, msgId, '❌ Ошибка: ' + err.message);
            }
            return ctx.answerCallbackQuery();
        }

        await ctx.answerCallbackQuery();
    });

    // Error handler
    bot.catch((err) => {
        console.error('[Bot Error]', err.message || err);
    });
}

module.exports = { getBot };
