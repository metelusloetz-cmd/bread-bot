const { webhookCallback } = require('grammy');
const { getBot } = require('../lib/bot');

// grammY webhook handler for Vercel serverless
// Adapter "https" is the correct one for Vercel (not "std/http")
module.exports = webhookCallback(getBot(), 'https');
