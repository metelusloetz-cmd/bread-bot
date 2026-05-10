const { webhookCallback } = require('grammy');
const { getBot } = require('../lib/bot');

// grammY webhook handler for Vercel serverless
module.exports = webhookCallback(getBot(), 'std/http');
