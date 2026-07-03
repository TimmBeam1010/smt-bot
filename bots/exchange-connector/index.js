// ============================================
//  МОДУЛЬ EXCHANGE CONNECTOR
// ============================================

const WebSocket = require('ws');
global.WebSocket = WebSocket;

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger } = require('../../shared/logger');
const cache = require('../../shared/cache');
const log = logger('exchange-connector');

const app = express();
const PORT = process.env.EXCHANGE_CONNECTOR_PORT || 5001;

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    log.error('SUPABASE_URL и SUPABASE_KEY не заданы');
    process.exit(1);
}

const WebSocket = require('ws');
const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket
    }
});
log.info('✅ Подключение к Supabase установлено');

app.use(cors());
app.use(express.json());

const exchanges = require('../../shared/exchanges');

// ============================================
//  ЭНДПОИНТЫ
// ============================================

app.post('/api/exchange/connect', async (req, res) => {
    try {
        const { email, exchange, api_key, secret_key } = req.body;

        if (!email || !exchange || !api_key || !secret_key) {
            log.warn('Недостаточно данных для подключения', { email, exchange });
            return res.status(400).json({ error: 'Недостаточно данных' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            log.warn('Пользователь не найден', { email });
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const credentials = user.exchange_credentials || {};
        credentials[exchange] = { api_key, secret_key };

        const { error: updateError } = await supabase
            .from('users')
            .update({ exchange_credentials: credentials })
            .eq('id', user.id);

        if (updateError) {
            log.error('Ошибка сохранения ключей', { email, exchange, error: updateError.message });
            return res.status(500).json({ error: 'Ошибка сохранения' });
        }

        const exchangeClient = exchanges.getExchange(exchange, api_key, secret_key);
        if (!exchangeClient) {
            log.error('Биржа не поддерживается', { exchange });
            return res.status(400).json({ error: 'Биржа не поддерживается' });
        }

        const isValid = await exchangeClient.testCredentials();
        if (!isValid) {
            log.warn('Неверные ключи', { email, exchange });
            return res.status(400).json({ error: 'Неверные ключи' });
        }

        log.info('Биржа подключена', { email, exchange });
        res.json({ success: true, message: 'Биржа подключена' });

    } catch (error) {
        log.error('Ошибка подключения биржи', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/exchange/balance/:email/:exchange', async (req, res) => {
    try {
        const { email, exchange } = req.params;

        const cacheKey = `balance:${email}:${exchange}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            log.debug('Баланс получен из кеша', { email, exchange });
            return res.json(cached);
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            log.warn('Пользователь не найден', { email });
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const credentials = user.exchange_credentials?.[exchange];
        if (!credentials) {
            log.warn('Ключи не найдены', { email, exchange });
            return res.status(404).json({ error: 'Ключи не найдены' });
        }

        const exchangeClient = exchanges.getExchange(exchange, credentials.api_key, credentials.secret_key);
        if (!exchangeClient) {
            log.error('Биржа не поддерживается', { exchange });
            return res.status(400).json({ error: 'Биржа не поддерживается' });
        }

        const balance = await exchangeClient.getBalance();
        if (balance === null || balance === undefined) {
            log.error('Не удалось получить баланс', { email, exchange });
            return res.status(500).json({ error: 'Не удалось получить баланс' });
        }

        const result = {
            exchange,
            balance,
            currency: 'USDT',
            updated_at: new Date().toISOString()
        };

        cache.set(cacheKey, result, 30000);
        log.info('Баланс получен с биржи', { email, exchange, balance });

        res.json(result);

    } catch (error) {
        log.error('Ошибка получения баланса', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/exchange/positions/:email/:exchange', async (req, res) => {
    try {
        const { email, exchange } = req.params;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            log.warn('Пользователь не найден', { email });
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const credentials = user.exchange_credentials?.[exchange];
        if (!credentials) {
            log.warn('Ключи не найдены', { email, exchange });
            return res.status(404).json({ error: 'Ключи не найдены' });
        }

        const exchangeClient = exchanges.getExchange(exchange, credentials.api_key, credentials.secret_key);
        if (!exchangeClient) {
            log.error('Биржа не поддерживается', { exchange });
            return res.status(400).json({ error: 'Биржа не поддерживается' });
        }

        const positions = await exchangeClient.getPositions() || [];

        log.info('Позиции получены', { email, exchange, count: positions.length });
        res.json({ positions });

    } catch (error) {
        log.error('Ошибка получения позиций', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    log.info(`🔑 Exchange Connector запущен на порту ${PORT}`);
});