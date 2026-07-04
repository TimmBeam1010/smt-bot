// ============================================
//  МОДУЛЬ ПРОВЕРКИ АКТИВНОСТИ МОНЕТ
// ============================================

const cache = require('./cache');
const { logger } = require('./logger');
const log = logger('symbol-validator');

// Кеш активных символов на 10 минут
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_KEY = 'active_symbols';

/**
 * Получить список активных символов с биржи
 */
async function getActiveSymbols(exchangeClient) {
    try {
        const cached = cache.get(CACHE_KEY);
        if (cached) {
            log.debug('Активные символы получены из кеша');
            return cached;
        }

        const contracts = await exchangeClient.getContracts();
        if (!contracts || !Array.isArray(contracts)) {
            log.error('Не удалось получить список контрактов');
            return [];
        }

        // Фильтруем активные USDT-M фьючерсы
        const activeSymbols = contracts
            .filter(c => c.status === 'ONLINE' && c.quoteAsset === 'USDT')
            .map(c => c.symbol);

        cache.set(CACHE_KEY, activeSymbols, CACHE_TTL);
        log.info(`Получено ${activeSymbols.length} активных символов`);
        return activeSymbols;
    } catch (error) {
        log.error('Ошибка получения активных символов', { error: error.message });
        return [];
    }
}

/**
 * Проверить, активен ли символ
 */
async function isSymbolActive(symbol, exchangeClient) {
    const activeSymbols = await getActiveSymbols(exchangeClient);
    return activeSymbols.includes(symbol);
}

/**
 * Проверить и удалить неактивные сигналы
 */
async function cleanupInactiveSignals(supabase, exchangeClient) {
    try {
        const activeSymbols = await getActiveSymbols(exchangeClient);
        if (activeSymbols.length === 0) {
            log.warn('Не удалось получить активные символы, очистка отключена');
            return;
        }

        // Получаем все pending сигналы
        const { data: signals, error } = await supabase
            .from('signals')
            .select('id, symbol')
            .eq('executed', false)
            .eq('status', 'pending');

        if (error) {
            log.error('Ошибка получения сигналов для очистки', { error: error.message });
            return;
        }

        const inactiveSignals = signals.filter(s => !activeSymbols.includes(s.symbol));
        
        if (inactiveSignals.length > 0) {
            const ids = inactiveSignals.map(s => s.id);
            const { error: deleteError } = await supabase
                .from('signals')
                .update({ status: 'expired', executed: true })
                .in('id', ids);

            if (deleteError) {
                log.error('Ошибка удаления неактивных сигналов', { error: deleteError.message });
            } else {
                log.info(`🧹 Удалено ${inactiveSignals.length} неактивных сигналов`);
                // Логируем какие именно
                inactiveSignals.forEach(s => log.debug(`  - ${s.symbol}`));
            }
        }
    } catch (error) {
        log.error('Ошибка в cleanupInactiveSignals', { error: error.message });
    }
}

module.exports = {
    getActiveSymbols,
    isSymbolActive,
    cleanupInactiveSignals
};