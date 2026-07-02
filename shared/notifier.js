// ============================================
//  МОДУЛЬ УВЕДОМЛЕНИЙ (Telegram)
// ============================================

const axios = require('axios');

// Настройки (возьми из .env или укажи здесь)
const TELEGRAM_BOT_TOKEN = '8626291636:AAHS6vk8hTgbEeVfM2B1gOOCCEcTe3HRsr0';
const TELEGRAM_CHAT_ID = '1744745843';

/**
 * Отправить сообщение в Telegram
 * @param {string} message - Текст сообщения
 * @param {string} level - Уровень: info, success, warning, error
 */
async function sendTelegram(message, level = 'info') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('⚠️ Telegram не настроен: пропуск уведомления');
        return;
    }

    try {
        // Эмодзи для разных уровней
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

        console.log(`📨 Уведомление отправлено в Telegram (${level})`);
    } catch (error) {
        console.error('❌ Ошибка отправки в Telegram:', error.response?.data || error.message);
    }
}

/**
 * Уведомление об ошибке
 */
async function notifyError(message, context = '') {
    const text = `🚨 <b>ОШИБКА</b>\n${message}\n${context ? `\n📎 Контекст: ${context}` : ''}`;
    await sendTelegram(text, 'error');
}

/**
 * Уведомление об успешной сделке
 */
async function notifyTrade(signal, trade) {
    const sideEmoji = signal.side === 'LONG' ? '📈' : '📉';
    const text = `${sideEmoji} <b>СДЕЛКА ОТКРЫТА</b>\n` +
        `📊 ${signal.symbol}\n` +
        `📌 ${signal.side}\n` +
        `💰 Цена: $${signal.entry_price}\n` +
        `📦 Размер: ${trade.quantity || '—'}\n` +
        `🛑 Стоп-лосс: $${trade.stop_loss || '—'}\n` +
        `🎯 Тейк-профит: $${trade.take_profit || '—'}\n` +
        `👤 Пользователь: ${trade.user_email || '—'}`;
    await sendTelegram(text, 'success');
}

/**
 * Уведомление о закрытии сделки
 */
async function notifyClose(trade, pnl, profitPercent) {
    const emoji = pnl >= 0 ? '💰' : '💸';
    const sign = pnl >= 0 ? '+' : '';
    const text = `${emoji} <b>СДЕЛКА ЗАКРЫТА</b>\n` +
        `📊 ${trade.symbol}\n` +
        `📌 ${trade.side}\n` +
        `📈 PNL: ${sign}${pnl.toFixed(2)} USDT (${sign}${profitPercent.toFixed(2)}%)\n` +
        `🔹 Статус: ${pnl >= 0 ? '✅ ПРОФИТ' : '❌ УБЫТОК'}\n` +
        `👤 Пользователь: ${trade.user_email || '—'}`;
    await sendTelegram(text, pnl >= 0 ? 'success' : 'warning');
}

/**
 * Уведомление о новом сигнале
 */
async function notifySignal(signal) {
    const text = `📡 <b>НОВЫЙ СИГНАЛ</b>\n` +
        `📊 ${signal.symbol}\n` +
        `📌 ${signal.side}\n` +
        `🎯 Уверенность: ${signal.confidence || 'medium'}\n` +
        `💰 Цена: $${signal.entry_price || '—'}`;
    await sendTelegram(text, 'info');
}

module.exports = {
    sendTelegram,
    notifyError,
    notifyTrade,
    notifyClose,
    notifySignal,
    notifyInfo
};
