// ============================================
//  МОДУЛЬ ПРОВЕРКИ АКТИВНЫХ МОНЕТ
// ============================================

const exchanges = require('./exchanges');
const cache = require('./cache');
const { logger } = require('./logger');
const log = logger('active-symbols');

// Кеш активных символов на 5 минут
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'active_symbols';

/**
 * Получить список активных символов с биржи
 * @param {string} exchange - Название биржи
 * @param {string} apiKey - API ключ
 * @param {string} secretKey - Секретный ключ
 * @returns {Promise<Array>} Список активных символов
 */
async function getActiveSymbols(exchange, apiKey, secretKey) {
    try {
        const cacheKey = `${CACHE_KEY}:${exchange}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            log.debug('Активные символы получены из кеша');
            return cached;
        }

        const exchangeClient = exchanges.getExchange(exchange, apiKey, secretKey);
        if (!exchangeClient) {
            log.error('Биржа не поддерживается', { exchange });
            return [];
        }

        // Получаем список контрактов
        const contracts = await exchangeClient.getContracts();
        if (!contracts || !Array.isArray(contracts)) {
            log.error('Не удалось получить список контрактов', { exchange });
            return [];
        }

        // Фильтруем активные USDT-M фьючерсы и добавляем дефис, если его нет
        const activeSymbols = contracts
            .filter(c => c.status === 'ONLINE' && c.quoteAsset === 'USDT')
            .map(c => {
                // Добавляем дефис, если его нет (BONKUSDT → BONK-USDT)
                return c.symbol.includes('-') ? c.symbol : c.symbol.replace('USDT', '-USDT');
            });

        // Сохраняем в кеш
        cache.set(cacheKey, activeSymbols, CACHE_TTL);
        log.info(`Получено ${activeSymbols.length} активных символов`);

        return activeSymbols;
    } catch (error) {
        log.error('Ошибка получения активных символов', { error: error.message });
        return [];
    }
}

/**
 * Очистить неактивные символы из списка бота
 * @param {Object} bot - Бот
 * @param {Array} activeSymbols - Список активных символов
 * @returns {Object} Бот с обновлённым списком символов
 */
function filterActiveSymbols(bot, activeSymbols) {
    if (!bot.symbols || !Array.isArray(bot.symbols)) {
        return bot;
    }

    const filteredSymbols = bot.symbols.filter(symbol => activeSymbols.includes(symbol));
    const removedCount = bot.symbols.length - filteredSymbols.length;

    if (removedCount > 0) {
        log.info(`Удалено ${removedCount} неактивных символов из бота ${bot.name}`, {
            removed: bot.symbols.filter(s => !activeSymbols.includes(s)),
            remaining: filteredSymbols
        });
    }

    return {
        ...bot,
        symbols: filteredSymbols
    };
}

/**
 * Обновить список символов у всех ботов пользователя
 * @param {string} email - Email пользователя
 * @param {string} exchange - Биржа
 * @param {string} apiKey - API ключ
 * @param {string} secretKey - Секретный ключ
 * @param {Object} supabase - Клиент Supabase
 * @returns {Promise<Object>} Результат обновления
 */
async function updateBotSymbols(email, exchange, apiKey, secretKey, supabase) {
    try {
        const activeSymbols = await getActiveSymbols(exchange, apiKey, secretKey);
        if (activeSymbols.length === 0) {
            log.warn('Не удалось получить активные символы, пропускаем обновление');
            return { success: false, reason: 'Нет активных символов' };
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('bots')
            .eq('email', email)
            .single();

        if (userError || !user) {
            log.error('Пользователь не найден', { email });
            return { success: false, reason: 'Пользователь не найден' };
        }

        const bots = user.bots || [];
        let updated = 0;

        const updatedBots = bots.map(bot => {
            const filtered = filterActiveSymbols(bot, activeSymbols);
            if (filtered.symbols.length !== bot.symbols?.length) {
                updated++;
            }
            return filtered;
        });

        if (updated > 0) {
            const { error: updateError } = await supabase
                .from('users')
                .update({ bots: updatedBots })
                .eq('id', user.id);

            if (updateError) {
                log.error('Ошибка обновления ботов', { error: updateError.message });
                return { success: false, reason: updateError.message };
            }

            log.info(`Обновлены боты для ${email}: удалено ${updated} неактивных символов`);
        }

        return { success: true, updated, activeSymbols };

    } catch (error) {
        log.error('Ошибка обновления символов бота', { error: error.message });
        return { success: false, reason: error.message };
    }
}

module.exports = {
    getActiveSymbols,
    filterActiveSymbols,
    updateBotSymbols
};