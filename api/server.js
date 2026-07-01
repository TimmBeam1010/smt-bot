const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET (Node.js 20) ===
const WebSocket = require('ws');
global.WebSocket = WebSocket;
// =============================================

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY не заданы");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Подключение к Supabase установлено");

// ============================================
//  БАЗОВЫЕ МАРШРУТЫ
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SMT Bot API работает!' });
});

// ============================================
//  МАРШРУТЫ АВТОРИЗАЦИИ
// ============================================

app.post('/api/register', async (req, res) => {
    const { email, password, username } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }

    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (existingUser) {
            const isPasswordValid = await bcrypt.compare(password, existingUser.password);
            if (!isPasswordValid) {
                const hashedPassword = await bcrypt.hash(password, 10);
                await supabase
                    .from('users')
                    .update({ password: hashedPassword, updated_at: new Date() })
                    .eq('email', email);
            }
            delete existingUser.password;
            return res.status(200).json({ user: existingUser, message: 'Пользователь уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email,
                password: hashedPassword,
                telegram_username: username || null,
                auth_provider: 'email',
                is_verified: true,
                is_active: true
            })
            .select()
            .single();

        if (createError) {
            console.error('Ошибка создания:', createError);
            return res.status(500).json({ error: 'Ошибка создания пользователя' });
        }

        delete newUser.password;
        res.status(201).json({ user: newUser });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error || !user) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  МАРШРУТЫ ДЛЯ НОВОСТЕЙ И РЫНКА
// ============================================

app.get('/api/news', async (req, res) => {
    try {
        const apiKey = process.env.NEWS_API_KEY || 'demo';
        const url = `https://newsapi.org/v2/everything?q=crypto OR bitcoin OR trading&language=en&sortBy=publishedAt&apiKey=${apiKey}`;
        const response = await axios.get(url, { timeout: 10000 });
        const articles = response.data.articles?.slice(0, 6) || [];
        res.json({ news: articles });
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error.message);
        res.json({ news: [] });
    }
});

app.get('/api/market-data', async (req, res) => {
    try {
        const fgRes = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 });
        const fearGreed = parseInt(fgRes.data.data[0].value) || 50;

        const btcRes = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { timeout: 8000 });
        const btcPrice = btcRes.data.bitcoin?.usd || null;

        const capRes = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8000 });
        const totalCap = capRes.data.data?.total_market_cap?.usd || null;
        const totalCapStr = totalCap ? '$' + (totalCap / 1e12).toFixed(2) + 'T' : '--';

        res.json({
            fearGreed,
            btcPrice: btcPrice ? btcPrice.toLocaleString() : '--',
            totalCap: totalCapStr
        });
    } catch (error) {
        console.error('❌ Ошибка получения рыночных данных:', error.message);
        res.json({ fearGreed: 50, btcPrice: '--', totalCap: '--' });
    }
});

// ============================================
//  МАРШРУТЫ ДЛЯ СИГНАЛОВ И БОТОВ (ПРОКСИ)
// ============================================

app.get('/api/signals/user/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.json({ signals: [] });
        }

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ signals });
    } catch (err) {
        console.error('Ошибка получения сигналов:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/bot/list/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('bots')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({ bots: user.bots || [] });
    } catch (err) {
        console.error('❌ Ошибка получения списка ботов:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ПРОКСИ ДЛЯ EXCHANGE CONNECTOR
// ============================================

const EXCHANGE_CONNECTOR_URL = 'http://localhost:5001';

// Прокси для подключения биржи
app.post('/api/exchange/connect', async (req, res) => {
    try {
        const response = await axios.post(`${EXCHANGE_CONNECTOR_URL}/api/exchange/connect`, req.body);
        res.json(response.data);
    } catch (error) {
        console.error('❌ Ошибка прокси exchange/connect:', error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Ошибка подключения биржи' });
    }
});

// Прокси для списка бирж
app.get('/api/exchange/list/:email', async (req, res) => {
    try {
        const response = await axios.get(`${EXCHANGE_CONNECTOR_URL}/api/exchange/list/${req.params.email}`);
        res.json(response.data);
    } catch (error) {
        console.error('❌ Ошибка прокси exchange/list:', error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Ошибка получения списка бирж' });
    }
});

// Прокси для отключения биржи
app.post('/api/exchange/disconnect', async (req, res) => {
    try {
        const response = await axios.post(`${EXCHANGE_CONNECTOR_URL}/api/exchange/disconnect`, req.body);
        res.json(response.data);
    } catch (error) {
        console.error('❌ Ошибка прокси exchange/disconnect:', error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Ошибка отключения биржи' });
    }
});

// Прокси для баланса
app.get('/api/exchange/balance/:email/:exchange', async (req, res) => {
    try {
        const response = await axios.get(`${EXCHANGE_CONNECTOR_URL}/api/exchange/balance/${req.params.email}/${req.params.exchange}`);
        res.json(response.data);
    } catch (error) {
        console.error('❌ Ошибка прокси exchange/balance:', error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Ошибка получения баланса' });
    }
});

// ============================================
//  МАРШРУТЫ ДЛЯ СОЗДАНИЯ БОТА
// ============================================

app.post('/api/bot/create', async (req, res) => {
    try {
        const { email, config } = req.body;

        if (!email || !config) {
            return res.status(400).json({ error: 'Email и конфигурация бота обязательны' });
        }

        // Получаем пользователя
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, connected_exchanges, bots')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Проверяем, что биржа подключена
        const connectedExchanges = (user.connected_exchanges || []).map(e => e.trim());
        if (connectedExchanges.length === 0) {
            return res.status(400).json({ error: 'Необходимо подключить хотя бы одну биржу' });
        }

        if (!connectedExchanges.includes(config.exchange)) {
            return res.status(400).json({
                error: `Биржа ${config.exchange} не подключена. Доступны: ${connectedExchanges.join(', ')}`
            });
        }

        // Создаём нового бота
        const newBot = {
            id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: config.name.trim(),
            exchange: config.exchange,
            mode: config.mode,
            active: true,
            paused: false,
            strategies: config.strategies.map(s => ({
                id: s,
                enabled: true,
                params: {}
            })),
            symbols: config.symbols || [],
            risk: {
                max_positions: config.risk?.max_positions || 3,
                risk_percent: config.risk?.risk_percent || 2.0,
                stop_loss_percent: config.risk?.stop_loss_percent || 1.5,
                take_profit_percent: config.risk?.take_profit_percent || 3.0,
                trailing_stop: config.risk?.trailing_stop || false,
                signal_levels: config.risk?.signal_levels || ['low', 'medium', 'high']
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            stats: {
                total_signals: 0,
                total_trades: 0,
                win_rate: 0,
                pnl: 0
            }
        };

        const bots = [...(user.bots || []), newBot];

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ bots, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({
            success: true,
            message: `Бот "${newBot.name}" успешно создан`,
            bot: newBot,
            user: updatedUser
        });

    } catch (err) {
        console.error('❌ Ошибка создания бота:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 API Server запущен на порту ${port}`);
    console.log(`🌐 Открой: http://localhost:${port}/`);
});