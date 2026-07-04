// ============================================
//  МОДУЛЬ ОЧИСТКИ СИГНАЛОВ (SIGNAL CLEANER)
// ============================================

const WebSocket = require('ws');
global.WebSocket = WebSocket;

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger } = require('../../shared/logger');
const log = logger('signal-cleaner');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    log.error('SUPABASE_URL и SUPABASE_KEY не заданы');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: { transport: WebSocket },
    db: { timeout: 60000, schema: 'public' }
});
log.info('✅ Подключение к Supabase установлено');

// ============================================
//  КОНФИГУРАЦИЯ
// ============================================

const CLEAN_INTERVAL = 60000; // 1 минута
const SIGNAL_TTL = {
    medium: 12 * 60 * 60 * 1000,
    high: 24 * 60 * 60 * 1000
};

// ============================================
//  ОЧИСТКА СИГНАЛОВ
// ============================================

async function cleanupSignals() {
    try {
        const now = new Date();
        const expiredSignals = [];

        // 1. Удаляем все LOW сигналы
        const { error: lowError } = await supabase
            .from('signals')
            .update({ status: 'expired', executed: true })
            .eq('confidence', 'low')
            .eq('executed', false);

        if (lowError) {
            log.error('Ошибка удаления LOW сигналов', { error: lowError.message });
        } else {
            log.info('🧹 Удалены все LOW сигналы');
        }

        // 2. Удаляем устаревшие MEDIUM и HIGH
        const { data: signals, error } = await supabase
            .from('signals')
            .select('id, confidence, created_at')
            .eq('executed', false)
            .eq('status', 'pending')
            .in('confidence', ['medium', 'high']);

        if (error) {
            log.error('Ошибка получения сигналов для очистки', { error: error.message });
            return;
        }

        if (!signals || signals.length === 0) return;

        for (const signal of signals) {
            const createdAt = new Date(signal.created_at);
            const age = now - createdAt;
            const ttl = SIGNAL_TTL[signal.confidence] || SIGNAL_TTL.medium;

            if (age > ttl) {
                expiredSignals.push(signal.id);
            }
        }

        if (expiredSignals.length > 0) {
            const { error: updateError } = await supabase
                .from('signals')
                .update({ status: 'expired', executed: true })
                .in('id', expiredSignals);

            if (updateError) {
                log.error('Ошибка обновления устаревших сигналов', { error: updateError.message });
            } else {
                log.info(`🧹 Очищено ${expiredSignals.length} устаревших сигналов`);
            }
        }

    } catch (error) {
        log.error('Ошибка в cleanupSignals', { error: error.message });
    }
}

// ============================================
//  ЗАПУСК
// ============================================

log.info('⏰ Signal Cleaner: Запущен (очистка каждую минуту)');

setInterval(cleanupSignals, CLEAN_INTERVAL);
cleanupSignals();