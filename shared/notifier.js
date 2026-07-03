// ============================================
//  МОДУЛЬ УВЕДОМЛЕНИЙ (Telegram)
// ============================================

const axios = require('axios');
const { logger } = require('./logger');
const log = logger('notifier');

// Настройки
const TELEGRAM_BOT_TOKEN = '8626291636:AAHS6vk8hTgbEeVfM2B1gOOCCEcTe3HRsr0';
const TELEGRAM_CHAT_ID = '1744745843';

// Ограничение частоты отправки (увеличено до 5 секунд)
let lastNotificationTime = 0;
const MIN_INTERVAL = 5000; // 5 секунд между уведомлениями

/**
 * Отправить сообщение в Telegram
 */
async function sendTelegram(message, level = 'info') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        log.warn('Telegram не настроен: пропуск уведомления');
        return;
    }

    try {
        // Ограничение частоты
        const now = Date.now();
        const waitTime = Math.max(0, MIN_INTERVAL - (now - lastNotificationTime));
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        lastNotificationTime = Date.now();

        const emojis = {
            info: '📘',
            success: '✅',
            warning: '⚠️',
            error: '🔴'
        };

        const emoji = emojis[level] || '📘';
        const fullMessage = `${emoji} ${message}`;

        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: fullMessage,
            parse_mode: 'HTML'
        });

        log.debug(`Уведомление отправлено в Telegram (${level})`);
    } catch (error) {
        if (error.response?.status === 429) {
            log.warn('Telegram: слишком много запросов, уведомление пропущено');
        } else {
            log.error('Ошибка отправки в Telegram', { 
                error: error.response?.data || error.message 
            });
        }
    }
}

// ... остальные функции (notifyError, notifyTrade, notifyClose, notifySignal, notifyInfo) остаются без изменений

module.exports = {
    sendTelegram,
    notifyError,
    notifyTrade,
    notifyClose,
    notifySignal,
    notifyInfo
};