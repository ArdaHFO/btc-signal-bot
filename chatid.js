const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Set TELEGRAM_BOT_TOKEN in your local environment before requesting chat IDs.');
  process.exitCode = 1;
} else {
  axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, { timeout: 15000 })
    .then(res => {
      if (!res.data.ok || !Array.isArray(res.data.result)) {
        console.error('Telegram did not return a valid update list.');
        process.exitCode = 1;
        return;
      }
      res.data.result.forEach(update => {
        const chat = update.message?.chat;
        if (chat) {
          console.log(`User: ${chat.first_name || chat.title || 'Unknown'}`);
          console.log(`Chat ID: ${chat.id}`);
          console.log('---');
        }
      });
    })
    .catch(err => {
      console.error('Telegram request failed:', err.response?.status || 'NETWORK_ERROR');
      process.exitCode = 1;
    });
}
