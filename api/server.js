// ============================================
//  API СЕРВЕР (SMT BOT)
// ============================================

const WebSocket = require('ws');
global.WebSocket = WebSocket;

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY не заданы");
    process.exit(1);
}

// 🔧 Исправлено: добавлен transport: WebSocket и timeout
const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket
    },
    db: {
        timeout: 60000
    }
});
console.log("✅ Подключение к Supabase установлено");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const exchanges = require('../shared/exchanges');

// ============================================
//  ЭНДПОИНТЫ
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SMT Bot API работает!' });
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        if (user.password.trim() !== password.trim()) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                bots: user.bots || [],
                exchange_credentials: user.exchange_credentials || {}
            }
        });
    } catch (error) {
        console.error('Ошибка логина:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        const { data: existing, error: checkError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (existing) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }

        const { data: user, error } = await supabase
            .from('users')
            .insert({
                email,
                password: password.trim(),
                name,
                bots: [],
                exchange_credentials: {}
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                bots: user.bots || [],
                exchange_credentials: user.exchange_credentials || {}
            }
        });
    } catch (error) {
        console.error('Ошибка регистрации:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/bot/list/:email', async (req, res) => {
    try {
        const { email } = req.params;

        const { data: user, error } = await supabase
            .from('users')
            .select('bots')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({ bots: user.bots || [] });
    } catch (error) {
        console.error('Ошибка получения списка ботов:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/bot/create', async (req, res) => {
    try {
        const { email, bot } = req.body;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const bots = user.bots || [];
        bots.push(bot);

        const { error: updateError } = await supabase
            .from('users')
            .update({ bots })
            .eq('id', user.id);

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        res.json({ success: true, bot });
    } catch (error) {
        console.error('Ошибка создания бота:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/bot/update', async (req, res) => {
    try {
        const { email, botId, updates } = req.body;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const bots = user.bots || [];
        const botIndex = bots.findIndex(b => b.id === botId);
        if (botIndex === -1) {
            return res.status(404).json({ error: 'Бот не найден' });
        }

        bots[botIndex] = { ...bots[botIndex], ...updates };

        const { error: updateError } = await supabase
            .from('users')
            .update({ bots })
            .eq('id', user.id);

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        res.json({ success: true, bot: bots[botIndex] });
    } catch (error) {
        console.error('Ошибка обновления бота:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/bot/delete', async (req, res) => {
    try {
        const { email, botId } = req.body;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const bots = (user.bots || []).filter(b => b.id !== botId);

        const { error: updateError } = await supabase
            .from('users')
            .update({ bots })
            .eq('id', user.id);

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка удаления бота:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/bot/dashboard/:email/:botId', async (req, res) => {
    try {
        const { email, botId } = req.params;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const bot = (user.bots || []).find(b => b.id === botId);
        if (!bot) {
            return res.status(404).json({ error: 'Бот не найден' });
        }

        const exchange = bot.exchange || 'bingx';
        const credentials = user.exchange_credentials?.[exchange];
        let balance = 0;
        let positions = [];
        let totalPnl = 0;

        if (credentials && credentials.api_key && credentials.secret_key) {
            try {
                const exchangeClient = exchanges.getExchange(
                    exchange,
                    credentials.api_key,
                    credentials.secret_key
                );

                if (exchangeClient) {
                    balance = await exchangeClient.getBalance() || 0;
                    const rawPositions = await exchangeClient.getPositions() || [];

                    positions = rawPositions.map(pos => {
                        const pnl = pos.unrealizedProfit || 0;
                        totalPnl += pnl;
                        return {
                            symbol: pos.symbol || '—',
                            side: pos.positionSide || '—',
                            leverage: pos.leverage || bot.risk?.leverage || 10,
                            margin: pos.initialMargin || pos.margin || 0,
                            pnl: pnl,
                            entryPrice: pos.entryPrice || 0,
                            markPrice: pos.markPrice || 0,
                            stopLoss: pos.stopLoss || null,
                            takeProfit: pos.takeProfit || null
                        };
                    });
                }
            } catch (error) {
                console.error(`Ошибка получения данных для ${exchange}:`, error.message);
            }
        }

        let status = 'active';
        if (bot.paused) status = 'paused';
        else if (!bot.active) status = 'stopped';

        res.json({
            success: true,
            data: {
                bot: {
                    id: bot.id,
                    name: bot.name,
                    mode: bot.mode || 'auto_trade'
                },
                status: status,
                balance: balance,
                totalPnl: totalPnl,
                positions: positions
            }
        });

    } catch (error) {
        console.error('Ошибка в /api/bot/dashboard:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API Server запущен на порту ${PORT}`);
    console.log(`🌐 Открой: http://localhost:${PORT}/`);
});

module.exports = app;