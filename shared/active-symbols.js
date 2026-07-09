// ============================================
//  МОДУЛЬ ПРОВЕРКИ АКТИВНЫХ МОНЕТ
// ============================================

const exchanges = require('./exchanges');
const cache = require('./cache');
const { logger } = require('./logger');
const log = logger('active-symbols');

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'active_symbols';

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

        const contracts = await exchangeClient.getContracts();
        if (!contracts || !Array.isArray(contracts)) {
            log.error('Не удалось получить список контрактов', { exchange });
            return [];
        }

        // Фильтруем активные USDT-контракты (BingX V2)
        const activeSymbols = contracts
            .filter(c => c.status === 1 && c.currency === 'USDT')
            .map(c => c.symbol);

        cache.set(cacheKey, activeSymbols, CACHE_TTL);
        log.info(`Получено ${activeSymbols.length} активных символов`);

        return activeSymbols;
    } catch (error) {
        log.error('Ошибка получения активных символов', { error: error.message });
        return [];
    }
}

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