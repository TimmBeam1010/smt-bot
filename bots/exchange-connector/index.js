// ============================================
//  МОДУЛЬ ПОДКЛЮЧЕНИЯ БИРЖ (EXCHANGE CONNECTOR)
// ============================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET (Node.js 20) ===
const WebSocket = require('ws');
global.WebSocket = WebSocket;
// =============================================

const app = express();
const port = process.env.EXCHANGE_CONNECTOR_PORT || 5001;

app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY не заданы");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Exchange Connector: Подключение к Supabase установлено");

// ============================================
//  МАРШРУТЫ
// ============================================

/**
 * ПОДКЛЮЧЕНИЕ БИРЖИ
 * POST /api/exchange/connect
 */
app.post('/api/exchange/connect', async (req, res) => {
    const { email, exchange, apiKey, secretKey } = req.body;

    if (!email || !exchange || !apiKey || !secretKey) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        // 1. Получаем пользователя
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('exchange_credentials, connected_exchanges')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // 2. Сохраняем ключи в открытом виде (временно, без шифрования)
        const credentials = user.exchange_credentials || {};
        credentials[exchange] = {
            api_key: apiKey,
            secret_key: secretKey,
            enabled: true,
            last_checked: new Date().toISOString()
        };

        const connectedExchanges = user.connected_exchanges || [];
        if (!connectedExchanges.includes(exchange)) {
            connectedExchanges.push(exchange);
        }

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({
                exchange_credentials: credentials,
                connected_exchanges: connectedExchanges
            })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({
            success: true,
            message: `Биржа ${exchange} успешно подключена`,
            user: updatedUser
        });

    } catch (err) {
        console.error('❌ Ошибка подключения биржи:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * ПОЛУЧЕНИЕ СПИСКА БИРЖ
 * GET /api/exchange/list/:email
 */
app.get('/api/exchange/list/:email', async (req, res) => {
    const { email } = req.params;

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('connected_exchanges, exchange_credentials')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const exchanges = (user.connected_exchanges || []).map(exchange => ({
            exchange: exchange.trim(),
            enabled: user.exchange_credentials?.[exchange]?.enabled || false,
            last_checked: user.exchange_credentials?.[exchange]?.last_checked || null
        }));

        res.json({ exchanges });

    } catch (err) {
        console.error('❌ Ошибка получения списка бирж:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * ОТКЛЮЧЕНИЕ БИРЖИ
 * POST /api/exchange/disconnect
 */
app.post('/api/exchange/disconnect', async (req, res) => {
    const { email, exchange } = req.body;

    if (!email || !exchange) {
        return res.status(400).json({ error: 'Email и биржа обязательны' });
    }

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('exchange_credentials, connected_exchanges, bots')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Проверяем, есть ли боты на этой бирже
        const bots = user.bots || [];
        const hasBots = bots.some(bot => bot.exchange === exchange);
        if (hasBots) {
            return res.status(400).json({
                error: 'Невозможно отключить биржу: есть активные боты, привязанные к ней'
            });
        }

        // Удаляем биржу
        const credentials = user.exchange_credentials || {};
        delete credentials[exchange];

        const connectedExchanges = (user.connected_exchanges || []).filter(e => e !== exchange);

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({
                exchange_credentials: credentials,
                connected_exchanges: connectedExchanges
            })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({
            success: true,
            message: `Биржа ${exchange} отключена`,
            user: updatedUser
        });

    } catch (err) {
        console.error('❌ Ошибка отключения биржи:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * ПОЛУЧЕНИЕ БАЛАНСА
 * GET /api/exchange/balance/:email/:exchange
 */
app.get('/api/exchange/balance/:email/:exchange', async (req, res) => {
    const { email, exchange } = req.params;

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('exchange_credentials')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const credentials = user.exchange_credentials?.[exchange];
        if (!credentials || !credentials.api_key) {
            return res.status(404).json({ error: 'Ключи не найдены' });
        }

        // Пока возвращаем заглушку (баланс 0), так как мы ещё не перенесли логику получения баланса
        res.json({
            exchange,
            balance: 0,
            currency: 'USDT',
            updated_at: new Date().toISOString()
        });

    } catch (err) {
        console.error(`❌ Ошибка получения баланса ${exchange}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================

app.listen(port, '0.0.0.0', () => {
    console.log(`🔑 Exchange Connector запущен на порту ${port}`);
});