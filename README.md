# Bread Telegram Bot (Vercel)

Telegram-бот для приложения [Bread PWA](https://bakery229.duckdns.org).  
Работает на Vercel в режиме webhook.

## Функционал
- 📝 Ввод расходов, доходов, расписания, идей (текст/голос)
- 📊 Запрос отчётов за период
- ⏰ Утренние/вечерние напоминания о расписании

## Настройка

### Переменные окружения (Vercel Dashboard → Settings → Environment Variables)
```
TELEGRAM_BOT_TOKEN=...      # Токен бота от @BotFather
AITUNNEL_API_KEY=...         # API ключ AiTunnel
BREAD_API_URL=https://bakery229.duckdns.org
BOT_API_KEY=...              # Общий секрет для авторизации с Bread backend
```

### Установка webhook
После деплоя на Vercel, выполнить один раз:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<VERCEL_URL>/api/webhook"
```

## Деплой
```bash
vercel --prod
```
