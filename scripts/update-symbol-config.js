#!/usr/bin/env node

/**
 * Скрипт для автоматического обновления symbol-config.js
 * Запуск: node scripts/update-symbol-config.js
 * 
 * Что делает:
 * 1. Запрашивает все контракты с BingX
 * 2. Сравнивает с текущим symbol-config.js
 * 3. Добавляет недостающие символы
 * 4. Сохраняет обновлённый файл
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getExchange } = require('../shared/exchanges');

// Путь к файлу конфига
const CONFIG_PATH = path.join(__dirname, '../shared/symbol-config.js');

// Функция для парсинга существующего конфига
function parseExistingConfig() {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    
    // Ищем объект FALLBACK_CONFIG
    const match = content.match(/const FALLBACK_CONFIG = ({[\s\S]*?});/);
    if (!match) {
      console.log('❌ Не удалось найти FALLBACK_CONFIG в файле');
      return {};
    }
    
    // Парсим объект (безопасно)
    const configStr = match[1];
    // Убираем комментарии и лишние пробелы
    const cleaned = configStr.replace(/\/\/.*$/gm, '').trim();
    
    try {
      // Пробуем распарсить
      const config = eval('(' + cleaned + ')');
      return config;
    } catch (e) {
      console.error('❌ Ошибка парсинга конфига:', e.message);
      return {};
    }
  } catch (error) {
    console.error('❌ Ошибка чтения файла:', error.message);
    return {};
  }
}

// Функция для генерации строки объекта
function generateConfigString(config) {
  const entries = Object.entries(config);
  const lines = entries.map(([symbol, params]) => {
    return `  "${symbol}": {\n    "precision": ${params.precision},\n    "minQty": ${params.minQty}\n  }`;
  });
  return `{\n${lines.join(',\n')}\n}`;
}

// Функция для обновления файла
function updateConfigFile(config) {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    
    // Находим FALLBACK_CONFIG и заменяем его содержимое
    const newConfigStr = generateConfigString(config);
    const updated = content.replace(
      /const FALLBACK_CONFIG = {[\s\S]*?};/,
      `const FALLBACK_CONFIG = ${newConfigStr};`
    );
    
    fs.writeFileSync(CONFIG_PATH, updated, 'utf8');
    console.log(`✅ Конфиг обновлён: ${Object.keys(config).length} символов`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка сохранения файла:', error.message);
    return false;
  }
}

async function main() {
  console.log('📡 Запрос контрактов с BingX...');
  
  const client = getExchange(
    'bingx',
    process.env.BINGX_API_KEY,
    process.env.BINGX_SECRET_KEY
  );

  const contracts = await client.getContracts();
  if (!contracts || !Array.isArray(contracts)) {
    console.error('❌ Не удалось получить контракты');
    process.exit(1);
  }

  console.log(`✅ Получено ${contracts.length} контрактов`);

  // Фильтруем только активные USDT-контракты
  const bingxConfig = {};
  for (const c of contracts) {
    if (c.currency === 'USDT' && c.status === 1 && c.apiStateOpen === 'true') {
      bingxConfig[c.symbol] = {
        precision: c.quantityPrecision !== undefined ? c.quantityPrecision : 3,
        minQty: c.tradeMinQuantity !== undefined ? c.tradeMinQuantity : 0.01,
      };
    }
  }

  console.log(`📊 Активных USDT-контрактов: ${Object.keys(bingxConfig).length}`);

  // Читаем существующий конфиг
  const existingConfig = parseExistingConfig();
  const existingSymbols = Object.keys(existingConfig);
  console.log(`📊 Существующих символов в конфиге: ${existingSymbols.length}`);

  // Находим недостающие символы
  const newSymbols = Object.keys(bingxConfig).filter(s => !existingConfig[s]);
  
  if (newSymbols.length === 0) {
    console.log('✅ Все символы уже есть в конфиге');
    process.exit(0);
  }

  console.log(`📊 Новых символов для добавления: ${newSymbols.length}`);
  console.log('📝 Список новых символов:');
  newSymbols.slice(0, 10).forEach(s => console.log(`  - ${s}`));
  if (newSymbols.length > 10) {
    console.log(`  ... и ещё ${newSymbols.length - 10} символов`);
  }

  // Добавляем недостающие символы
  const updatedConfig = { ...existingConfig };
  for (const symbol of newSymbols) {
    updatedConfig[symbol] = bingxConfig[symbol];
  }

  // Сохраняем обновлённый конфиг
  const success = updateConfigFile(updatedConfig);
  
  if (success) {
    console.log(`✅ Добавлено ${newSymbols.length} символов`);
    console.log(`📊 Всего символов в конфиге: ${Object.keys(updatedConfig).length}`);
    
    // Показываем первые 10 добавленных символов
    console.log('📝 Добавленные символы (первые 10):');
    newSymbols.slice(0, 10).forEach(s => {
      const p = updatedConfig[s];
      console.log(`  - ${s}: precision=${p.precision}, minQty=${p.minQty}`);
    });
  } else {
    console.error('❌ Ошибка при сохранении файла');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});