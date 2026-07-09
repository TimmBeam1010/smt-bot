#!/usr/bin/env node

/**
 * Генерация конфига символов ТОЛЬКО для монет из signal-generator
 * Запуск: node scripts/generate-symbol-config.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getExchange } = require('../shared/exchanges');

// Список монет из signal-generator
const NEEDED_SYMBOLS = [
  'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
  'ADA-USDT', 'DOGE-USDT', 'DOT-USDT', 'LTC-USDT', 'LINK-USDT',
  'BCH-USDT', 'AVAX-USDT', 'MATIC-USDT', 'UNI-USDT', 'ATOM-USDT',
  'ETC-USDT', 'FIL-USDT', 'AAVE-USDT', 'NEAR-USDT', 'VET-USDT',
  'ALGO-USDT', 'TRX-USDT', 'XLM-USDT', 'ICP-USDT', 'EGLD-USDT',
  'HBAR-USDT', 'KAVA-USDT', 'KSM-USDT', 'MKR-USDT', 'ZEC-USDT',
  'XMR-USDT', 'DASH-USDT', 'YFI-USDT', 'COMP-USDT', 'GRT-USDT',
  'SNX-USDT', 'CRV-USDT', '1INCH-USDT', 'ENJ-USDT', 'MANA-USDT',
  'SAND-USDT', 'CHZ-USDT', 'AXS-USDT', 'DYDX-USDT', 'GALA-USDT',
  'APE-USDT', 'OP-USDT', 'ARB-USDT', 'INJ-USDT', 'SEI-USDT',
  'SUI-USDT', 'APT-USDT', 'LDO-USDT', 'RUNE-USDT', 'FLOW-USDT',
  'STX-USDT', 'AR-USDT', 'ENS-USDT', 'BAT-USDT', 'STORJ-USDT',
  'IMX-USDT', 'ZRX-USDT', 'SKL-USDT', 'SUSHI-USDT', 'YGG-USDT',
  'RSR-USDT', 'KNC-USDT', 'GMT-USDT', 'ROSE-USDT', 'MINA-USDT',
  'CFX-USDT', 'API3-USDT', 'AGLD-USDT', 'SLP-USDT', 'JASMY-USDT',
  'CTK-USDT', 'MTL-USDT', 'PEOPLE-USDT', 'ANKR-USDT', 'WOO-USDT',
  'CRO-USDT', 'LUNC-USDT', 'LUNA-USDT', 'QNT-USDT', 'ARPA-USDT',
  'SFP-USDT', 'MAGIC-USDT', 'FET-USDT', 'GMX-USDT', 'COTI-USDT',
  'METIS-USDT', 'ASTR-USDT', 'DUSK-USDT', 'BLUR-USDT', 'ACH-USDT',
  'TRB-USDT', 'FLOKI-USDT', 'ILV-USDT', 'ZEN-USDT', 'SCRT-USDT',
  'RLC-USDT', 'LPT-USDT', 'CKB-USDT', 'QTUM-USDT', 'SUN-USDT',
  'IOTA-USDT', 'SSV-USDT', 'BICO-USDT', 'TLM-USDT', 'XCN-USDT',
  'TWT-USDT', 'LQTY-USDT', 'ID-USDT', 'EDU-USDT', 'TURBO-USDT',
  'ORDI-USDT', 'UMA-USDT', 'OKB-USDT', 'NMR-USDT', 'MAV-USDT',
  'WLD-USDT', 'PENDLE-USDT', 'ARKM-USDT', 'CYBER-USDT',
  '1000PEPE-USDT', 'ARK-USDT', 'KAS-USDT', 'BIGTIME-USDT',
  'RIF-USDT', 'POLYX-USDT', 'GAS-USDT', 'THETA-USDT',
  'NEO-USDT', 'IOST-USDT', 'WAVES-USDT', 'ONT-USDT',
  'ONE-USDT', 'CELO-USDT', 'CHR-USDT', 'ALICE-USDT',
  'RVN-USDT', 'FLUX-USDT', 'SYN-USDT', 'WIF-USDT',
  'PI-USDT', 'FLOCK-USDT'
];

async function generateConfig() {
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

  const contractIndex = {};
  for (const c of contracts) {
    contractIndex[c.symbol] = c;
  }

  const config = {};
  let found = 0;
  let notFound = [];

  for (const symbol of NEEDED_SYMBOLS) {
    const c = contractIndex[symbol];
    if (c && c.currency === 'USDT' && c.status === 1) {
      const precision = c.quantityPrecision !== undefined ? c.quantityPrecision : 3;
      const minQty = c.tradeMinQuantity !== undefined ? c.tradeMinQuantity : 0.01;
      
      config[symbol] = {
        precision: precision,
        minQty: minQty,
        pricePrecision: c.pricePrecision || 4,
        size: c.size || 1,
      };
      found++;
    } else {
      notFound.push(symbol);
    }
  }

  console.log(`✅ Найдено ${found} символов из ${NEEDED_SYMBOLS.length}`);
  if (notFound.length > 0) {
    console.warn(`⚠️ Не найдены: ${notFound.join(', ')}`);
  }

  const fileContent = `// ============================================
//  АВТОМАТИЧЕСКИ СГЕНЕРИРОВАННЫЙ КОНФИГ СИМВОЛОВ
//  Сгенерирован: ${new Date().toISOString()}
//  Всего символов: ${found}
// ============================================

const SYMBOL_CONFIG = ${JSON.stringify(config, null, 2)};

module.exports = { SYMBOL_CONFIG };
`;

  const outputPath = path.join(__dirname, '../shared/symbol-config-generated.js');
  fs.writeFileSync(outputPath, fileContent, 'utf8');
  console.log(`✅ Конфиг сохранён в ${outputPath}`);
  console.log(`📊 Всего символов: ${found}`);
}

generateConfig().catch((error) => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});