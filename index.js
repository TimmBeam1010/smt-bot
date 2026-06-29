const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const trading = require('./trading');
require('dotenv').config();

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET (Node.js 20) ===
const WebSocket = require('ws');
global.WebSocket = WebSocket;
// =============================================

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY должны быть указаны в .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Подключение к Supabase установлено");

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
            await supabase
                .from('signals')
                .update({ email: email })
                .eq('user_id', existingUser.id);

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

        await supabase
            .from('signals')
            .update({ email: email })
            .eq('email', email);

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
//  АДМИН-МАРШРУТЫ
// ============================================

app.post('/api/admin/create-user', async (req, res) => {
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
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
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

app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Ошибка получения пользователей:', error);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        const safeUsers = users.map(u => {
            delete u.password;
            return u;
        });

        res.json({ users: safeUsers });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.put('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active должен быть boolean' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ is_active, updated_at: new Date() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления:', error);
            return res.status(500).json({ error: 'Ошибка обновления статуса' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  НОВОСТИ
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

// ============================================
//  РЫНОЧНЫЕ ДАННЫЕ (ДАШБОРД)
// ============================================

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
//  СИГНАЛЫ ПОЛЬЗОВАТЕЛЯ (ПО EMAIL)
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

// ============================================
//  ПРОВЕРКА СИГНАЛА
// ============================================

app.post('/api/signals/check/:id', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    try {
        const { data: signal, error } = await supabase
            .from('signals')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !signal) {
            return res.status(404).json({ error: 'Сигнал не найден' });
        }

        const currentPrice = await trading.getPrice(signal.symbol);
        if (!currentPrice) {
            return res.status(500).json({ error: 'Не удалось получить текущую цену' });
        }

        const entryPrice = parseFloat(signal.entry_price);
        const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;

        let status, message;

        if (signal.side === 'LONG') {
            if (priceChange > 0.5) {
                status = 'profit';
                message = `✅ Прибыль: +${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else if (priceChange < -0.5) {
                status = 'loss';
                message = `❌ Убыток: ${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else {
                status = 'active';
                message = `🟡 Актуально (изменение ${priceChange.toFixed(2)}%)`;
            }
        } else {
            if (priceChange < -0.5) {
                status = 'profit';
                message = `✅ Прибыль: ${Math.abs(priceChange).toFixed(2)}% (сейчас ${currentPrice})`;
            } else if (priceChange > 0.5) {
                status = 'loss';
                message = `❌ Убыток: -${priceChange.toFixed(2)}% (сейчас ${currentPrice})`;
            } else {
                status = 'active';
                message = `🟡 Актуально (изменение ${priceChange.toFixed(2)}%)`;
            }
        }

        await supabase
            .from('signals')
            .update({ checked: true, check_result: status, checked_at: new Date() })
            .eq('id', id);

        res.json({ status, message });

    } catch (err) {
        console.error('Ошибка проверки сигнала:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ОБНОВЛЕНИЕ БОТОВ ПОЛЬЗОВАТЕЛЯ
// ============================================

app.put('/api/user/:email/bots', async (req, res) => {
    const { email } = req.params;
    const { bots } = req.body;

    if (!bots || !Array.isArray(bots)) {
        return res.status(400).json({ error: 'bots должен быть массивом' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({ bots, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (error) {
            console.error('Ошибка обновления ботов:', error);
            return res.status(500).json({ error: 'Ошибка обновления ботов' });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        delete user.password;
        res.json({ user });

    } catch (err) {
        console.error('Непредвиденная ошибка:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  ПОДКЛЮЧЕНИЕ БИРЖИ
// ============================================

app.post('/api/exchange/connect', async (req, res) => {
    const { email, exchange, apiKey, secretKey } = req.body;
    if (!email || !exchange || !apiKey || !secretKey) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .update({
                exchange_connected: true,
                exchange_name: exchange,
                exchange_api_key: apiKey,
                exchange_secret_key: secretKey,
                updated_at: new Date()
            })
            .eq('email', email)
            .select()
            .single();

        if (error) throw error;
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const currentBots = user.bots || [];
        const newBot = {
            exchange: exchange,
            tariff: 'Пользовательский',
            services: ['Сигналы'],
            active: true,
            paused: false,
            tariffEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            deposit: 0,
            pnl: 0,
            openTrades: 0,
            closedTrades: 0,
            activatedAt: new Date().toISOString()
        };

        // Добавляем биржу в список connected_exchanges
        const currentExchanges = user.connected_exchanges || [];
        if (!currentExchanges.includes(exchange)) {
            currentExchanges.push(exchange);
        }

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ 
                bots: [...currentBots, newBot],
                connected_exchanges: currentExchanges
            })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({ success: true, user: updatedUser });

    } catch (err) {
        console.error('Ошибка подключения биржи:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ДЕМО-БОТ
// ============================================

async function getDemoBalance(userId) {
    const { data, error } = await supabase
        .from('demo_balance')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error && error.code === 'PGRST116') {
        const { data: newData, error: createError } = await supabase
            .from('demo_balance')
            .insert({ user_id: userId, balance: 1000 })
            .select()
            .single();
        if (createError) throw createError;
        return newData;
    }
    if (error) throw error;
    return data;
}

async function updateDemoBalance(userId, newBalance) {
    const { error } = await supabase
        .from('demo_balance')
        .update({ balance: newBalance, updated_at: new Date() })
        .eq('user_id', userId);
    if (error) throw error;
}

async function openDemoPosition(userId, symbol, side, entry, stopLoss, takeProfit, size) {
    const { data, error } = await supabase
        .from('demo_trades')
        .insert({
            user_id: userId,
            symbol,
            side,
            entry_price: entry,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            size,
            status: 'open',
            open_time: new Date()
        })
        .select()
        .single();

    if (error) throw error;

    const balance = await getDemoBalance(userId);
    await updateDemoBalance(userId, balance.balance - size);

    return data;
}

app.get('/api/demo/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', userId)
            .single();

        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        const balance = await getDemoBalance(user.id);
        const { data: positions, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        const { data: trades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .order('close_time', { ascending: false })
            .limit(20);

        if (posError || tradesError) throw posError || tradesError;

        const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

        res.json({
            ok: true,
            data: {
                balance: balance.balance,
                equity: balance.balance + positions.reduce((sum, p) => sum + (p.pnl || 0), 0),
                totalPnl: totalPnl,
                positions: positions,
                trades: trades
            }
        });
    } catch (err) {
        console.error('Ошибка демо-данных:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/demo/action', async (req, res) => {
    const { userId, action } = req.body;
    res.json({ ok: true });
});

// ============================================
//  РУЧНОЕ ОТКРЫТИЕ ПОЗИЦИИ
// ============================================

app.post('/api/trade/open-manual', async (req, res) => {
    const { userId, signalId, bots } = req.body;
    if (!userId || !signalId || !bots || bots.length === 0) {
        return res.status(400).json({ error: 'Недостаточно данных' });
    }

    try {
        const { data: signal, error: signalError } = await supabase
            .from('signals')
            .select('*')
            .eq('id', signalId)
            .single();

        if (signalError || !signal) {
            return res.status(404).json({ error: 'Сигнал не найден' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, bots')
            .eq('email', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const results = [];

        for (const bot of bots) {
            if (bot.exchange === 'demo') {
                const balance = await getDemoBalance(user.id);
                const size = Math.min(balance.balance * 0.05, 100);
                const position = await openDemoPosition(
                    user.id,
                    signal.symbol,
                    signal.side,
                    signal.entry_price,
                    signal.stop_loss || signal.entry_price * 0.97,
                    signal.take_profit || signal.entry_price * 1.05,
                    size
                );
                results.push({ bot: 'demo', position });
            } else {
                results.push({ bot: bot.exchange, status: 'real_trade_not_implemented' });
            }
        }

        res.json({ success: true, results });

    } catch (err) {
        console.error('Ошибка ручного открытия:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ПУБЛИЧНОЕ ДЕМО API (ДЛЯ ГЛАВНОЙ СТРАНИЦЫ)
// ============================================

async function getPublicDemoUserId() {
    const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('email', 'public_demo@smtbot.com')
        .single();
    if (error || !data) {
        console.error('❌ Публичный демо-пользователь не найден');
        return null;
    }
    return data.id;
}

app.get('/api/public/demo/status', async (req, res) => {
    try {
        const userId = await getPublicDemoUserId();
        if (!userId) {
            return res.status(404).json({ error: 'Публичный демо-пользователь не найден' });
        }

        const { data: balanceData, error: balanceError } = await supabase
            .from('demo_balance')
            .select('balance')
            .eq('user_id', userId)
            .single();

        if (balanceError) {
            console.error('Ошибка получения баланса:', balanceError);
        }

        const { data: positions, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'open')
            .order('open_time', { ascending: false });

        if (posError) {
            console.error('Ошибка получения позиций:', posError);
        }

        const { data: trades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'closed')
            .order('close_time', { ascending: false })
            .limit(5);

        if (tradesError) {
            console.error('Ошибка получения истории:', tradesError);
        }

        const balance = balanceData?.balance || 0;
        const totalPnl = trades?.reduce((sum, t) => sum + (t.pnl || 0), 0) || 0;

        res.json({
            status: 'ok',
            data: {
                balance: balance,
                totalPnl: totalPnl,
                equity: balance + (positions?.reduce((sum, p) => sum + (p.pnl || 0), 0) || 0),
                positions: positions || [],
                history: trades || []
            }
        });

    } catch (err) {
        console.error('❌ Ошибка публичного демо API:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  БЫСТРАЯ СТАТИСТИКА ДЛЯ ГЛАВНОЙ (PNL)
// ============================================

app.get('/api/user/quick-stats', async (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ error: 'Email обязателен' });
    }

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const { data: balanceData, error: balanceError } = await supabase
            .from('demo_balance')
            .select('balance')
            .eq('user_id', user.id)
            .single();

        if (balanceError) {
            console.error('Ошибка получения баланса:', balanceError);
        }

        const { data: positions, error: posError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'open');

        if (posError) {
            console.error('Ошибка получения позиций:', posError);
        }

        const { data: trades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'closed');

        if (tradesError) {
            console.error('Ошибка получения истории:', tradesError);
        }

        const balance = balanceData?.balance || 0;
        const totalPnl = trades?.reduce((sum, t) => sum + (t.pnl || 0), 0) || 0;
        const unrealizedPnl = positions?.reduce((sum, p) => sum + (p.pnl || 0), 0) || 0;
        const totalEquity = balance + unrealizedPnl;

        res.json({
            email: email,
            balance: balance,
            totalPnl: totalPnl,
            unrealizedPnl: unrealizedPnl,
            equity: totalEquity,
            pnlPercent: balance > 0 ? (totalPnl / balance * 100) : 0
        });

    } catch (err) {
        console.error('Ошибка получения статистики:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// ============================================
//  УПРАВЛЕНИЕ БОТАМИ (ОБНОВЛЕНИЕ И УДАЛЕНИЕ)
// ============================================

app.put('/api/user/bots/:email/:botIndex', async (req, res) => {
    const { email, botIndex } = req.params;
    const { active, paused } = req.body;
    
    if (botIndex === undefined || isNaN(botIndex)) {
        return res.status(400).json({ error: 'Неверный индекс бота' });
    }

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('bots')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const bots = user.bots || [];
        const index = parseInt(botIndex);
        
        if (index < 0 || index >= bots.length) {
            return res.status(404).json({ error: 'Бот не найден' });
        }

        if (active !== undefined) {
            bots[index].active = active;
        }
        if (paused !== undefined) {
            bots[index].paused = paused;
        }

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ bots, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({ success: true, user: updatedUser });

    } catch (err) {
        console.error('Ошибка обновления бота:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/user/bots/:email/:botIndex', async (req, res) => {
    const { email, botIndex } = req.params;

    if (botIndex === undefined || isNaN(botIndex)) {
        return res.status(400).json({ error: 'Неверный индекс бота' });
    }

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('bots')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const bots = user.bots || [];
        const index = parseInt(botIndex);

        if (index < 0 || index >= bots.length) {
            return res.status(404).json({ error: 'Бот не найден' });
        }

        bots.splice(index, 1);

        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ bots, updated_at: new Date() })
            .eq('email', email)
            .select()
            .single();

        if (updateError) throw updateError;

        delete updatedUser.password;
        res.json({ success: true, user: updatedUser });

    } catch (err) {
        console.error('Ошибка удаления бота:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ИСТОРИЯ PNL ДЛЯ ГРАФИКА
// ============================================

app.get('/api/user/pnl-history/:email', async (req, res) => {
    const { email } = req.params;
    const { days = 7 } = req.query;

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - parseInt(days));

        const { data: trades, error: tradesError } = await supabase
            .from('demo_trades')
            .select('close_time, pnl')
            .eq('user_id', user.id)
            .eq('status', 'closed')
            .gte('close_time', fromDate.toISOString())
            .order('close_time', { ascending: true });

        if (tradesError) {
            console.error('Ошибка получения истории PNL:', tradesError);
            return res.status(500).json({ error: 'Ошибка получения истории' });
        }

        const dailyPnl = {};
        trades.forEach(trade => {
            const day = new Date(trade.close_time).toISOString().slice(0, 10);
            const pnl = trade.pnl || 0;
            dailyPnl[day] = (dailyPnl[day] || 0) + pnl;
        });

        const labels = [];
        const pnlData = [];
        const balanceData = [];
        let cumulativePnl = 0;

        for (let i = parseInt(days) - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const key = date.toISOString().slice(0, 10);
            labels.push(key);
            const dayPnl = dailyPnl[key] || 0;
            cumulativePnl += dayPnl;
            pnlData.push(cumulativePnl);
            balanceData.push(1000 + cumulativePnl);
        }

        res.json({
            labels: labels,
            pnl: pnlData,
            balance: balanceData
        });

    } catch (err) {
        console.error('Ошибка получения истории PNL:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
//  ПЛАНИРОВЩИК ТОРГОВОГО БОТА (МНОГОПОЛЬЗОВАТЕЛЬСКИЙ)
// ============================================

const {
    SYMBOLS_HOT,
    getUserAggregatedPrice,
    getAllUserExchanges,
    generateSignal
} = require('./trading');

const userPriceHistory = {};

function getUserPriceHistory(userId, symbol) {
    if (!userPriceHistory[userId]) {
        userPriceHistory[userId] = {};
    }
    if (!userPriceHistory[userId][symbol]) {
        userPriceHistory[userId][symbol] = [];
    }
    return userPriceHistory[userId][symbol];
}

cron.schedule('*/1 * * * *', async () => {
    const startTime = Date.now();
    console.log('🔄 Запуск многопользовательского анализа...');

    try {
        const userExchangesMap = await getAllUserExchanges(supabase);
        const userIds = Array.from(userExchangesMap.keys());

        if (userIds.length === 0) {
            console.log('⚠️ Нет активных пользователей для анализа');
            return;
        }

        console.log(`👥 Обрабатываем ${userIds.length} пользователей`);

        for (const userId of userIds) {
            try {
                const exchanges = userExchangesMap.get(userId) || ['binance', 'bybit', 'okx'];
                
                const hotPrices = {};
                for (const symbol of SYMBOLS_HOT) {
                    const result = await getUserAggregatedPrice(userId, symbol, supabase);
                    if (result) {
                        hotPrices[symbol] = result.price;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                for (const symbol of SYMBOLS_HOT) {
                    if (hotPrices[symbol] !== undefined) {
                        const history = getUserPriceHistory(userId, symbol);
                        history.push(hotPrices[symbol]);
                        if (history.length > 60) {
                            history.shift();
                        }
                    }
                }

                for (const symbol of SYMBOLS_HOT) {
                    const history = getUserPriceHistory(userId, symbol);
                    if (history.length >= 20) {
                        const signal = generateSignal(symbol, history);
                        if (signal) {
                            console.log(`📈 СИГНАЛ для ${userId} (${symbol}): ${signal.side} (${signal.confidence})`);
                            
                            try {
                                const { error: insertError } = await supabase
                                    .from('signals')
                                    .insert({
                                        user_id: userId,
                                        symbol: signal.symbol,
                                        side: signal.side,
                                        entry_price: signal.entry,
                                        confidence: signal.confidence,
                                        reasons: signal.reasons,
                                        rsi: signal.rsi,
                                        macd: signal.macd,
                                        created_at: new Date()
                                    });

                                if (insertError) {
                                    console.error(`❌ Ошибка сохранения сигнала для ${userId}:`, insertError);
                                }
                            } catch (dbError) {
                                console.error(`❌ Ошибка БД для ${userId}:`, dbError.message);
                            }
                        }
                    }
                }

            } catch (userError) {
                console.error(`❌ Ошибка обработки пользователя ${userId}:`, userError.message);
            }
        }

        const duration = Date.now() - startTime;
        console.log(`✅ Многопользовательский анализ завершён за ${duration}мс`);

    } catch (error) {
        console.error('❌ Ошибка в планировщике:', error.message);
    }
}, {
    timezone: "Europe/Moscow"
});

console.log('⏰ Многопользовательский планировщик запущен (каждую минуту)');

// ============================================
//  API ДЛЯ РАБОТЫ С БИРЖАМИ (НОВЫЕ ЭНДПОИНТЫ)
// ============================================

const { encrypt, decrypt, testExchangeCredentials } = require('./exchange');

// 1. ПОДКЛЮЧЕНИЕ БИРЖИ
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

        // 2. Проверяем ключи тестовым запросом
        const isValid = await testExchangeCredentials(exchange, apiKey, secretKey);
        if (!isValid) {
            return res.status(400).json({ error: 'Неверные API ключи или недостаточно прав' });
        }

        // 3. Шифруем ключи
        const encryptedApi = encrypt(apiKey);
        const encryptedSecret = encrypt(secretKey);

        // 4. Сохраняем в БД
        const credentials = user.exchange_credentials || {};
        credentials[exchange] = {
            api_key_encrypted: encryptedApi.encrypted,
            secret_key_encrypted: encryptedSecret.encrypted,
            iv: encryptedApi.iv,
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

// 2. ПОЛУЧЕНИЕ СПИСКА ПОДКЛЮЧЕННЫХ БИРЖ
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

        // Возвращаем только названия бирж и статус, без ключей
        const exchanges = (user.connected_exchanges || []).map(exchange => ({
            exchange,
            enabled: user.exchange_credentials?.[exchange]?.enabled || false,
            last_checked: user.exchange_credentials?.[exchange]?.last_checked || null
        }));

        res.json({ exchanges });

    } catch (err) {
        console.error('❌ Ошибка получения списка бирж:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. ОТКЛЮЧЕНИЕ БИРЖИ
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

        // Проверяем, есть ли боты, привязанные к этой бирже
        const bots = user.bots || [];
        const hasBots = bots.some(bot => bot.exchange === exchange);
        if (hasBots) {
            return res.status(400).json({
                error: 'Невозможно отключить биржу: есть активные боты, привязанные к ней'
            });
        }

        // Удаляем биржу из списка
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

// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 SMT Bot запущен на порту ${port}`);
    console.log(`🌐 Открой: http://localhost:${port}/`);
    console.log(`📡 API: http://localhost:${port}/api/health`);
});