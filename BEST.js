const WebSocket = require('ws');
const { EMA, RSI, ATR } = require('technicalindicators');
const { sendTelegramMessage } = require('./notify');
require('dotenv').config();
const axios = require('axios');

// --- Yapılandırma Parametreleri ---
const SYMBOL = 'btcusdt';
const TIMEFRAME = '1m';
const WS_URL = `wss://stream.binance.com:9443/ws/${SYMBOL}@kline_${TIMEFRAME}`;
const REST_API_URL = `https://api.binance.com/api/v3/klines`;

// EMA Periyotları: Daha az hassasiyet için uzun EMA periyodu artırıldı.
// EMA 5 ve 21, kısa ve orta vadeli trend takibi için popüler bir kombinasyondur.
const EMA_SHORT_PERIOD = 5;
const EMA_LONG_PERIOD = 21; // Hassasiyeti azaltmak için 10'dan 21'e yükseltildi

// RSI Periyodu: Hassasiyeti azaltmak için 7'den 14'e yükseltildi.
// 14, RSI için en yaygın ve genellikle daha güvenilir kabul edilen periyottur.
const RSI_PERIOD = 14; // Hassasiyeti azaltmak için 7'den 14'e yükseltildi

const ATR_PERIOD = 7; // Volatiliteyi ölçmek için kullanılır.

const COOLDOWN_MS = 10 * 1000; // Sinyaller arası bekleme süresi (10 saniye'ye çıkarıldı)

// Sinyal Filtreleri ve Eşikleri
// RSI seviyeleri mevcut halleriyle daha az hassas RSI periyodu ile dengelenecektir.
const RSI_BUY_LOWER = 40;
const RSI_BUY_UPPER = 75;
const RSI_SELL_LOWER = 25;
const RSI_SELL_UPPER = 80;

// Fiyat Değişim Çarpanları: Hassasiyeti azaltmak için değerler artırıldı.
// Daha büyük değerler, daha belirgin fiyat hareketlerini bekler.
const PRICE_CHANGE_MULTIPLIER_BUY = 0.5; // 0.3'ten 0.5'e artırıldı
const PRICE_CHANGE_MULTIPLIER_SELL = 0.5; // 0.3'ten 0.5'e artırıldı

// EMA Farkı Çarpanı: Hassasiyeti azaltmak için değer artırıldı.
// Daha büyük değerler, EMA'lar arasında daha güçlü bir ayrım (trend) gerektirir.
const EMA_DIFF_MULTIPLIER = 0.05; // 0.02'den 0.05'e artırıldı

// Zarar Kes (Stop-Loss) Yüzdesi
const STOP_LOSS_PERCENTAGE = 0.007; // %0.5'ten %0.7'ye çıkarıldı (biraz daha fazla tolerans)

// --- Dahili Değişkenler ---
let lastSignalTime = 0;
let lastBuyPrice = null;
let lastSellPrice = null;
let lastTradeType = null; // 'BUY', 'SELL' veya null (pozisyonda değil)

const priceHistory = [];
const highHistory = [];
const lowHistory = [];
const closeHistory = [];

const MIN_REQUIRED_HISTORY_LENGTH = Math.max(EMA_LONG_PERIOD, RSI_PERIOD, ATR_PERIOD) + 2;

let ws;
let lastCandleCloseTime = 0;

// --- Bot Durum ve "TUT" Mesajı Zamanlayıcısı ---
const BOT_STATUS_INTERVAL_MS = 30 * 1000; // 30 saniyede bir genel durum mesajı (fiyat dahil)
const HOLD_MESSAGE_INTERVAL_MS = 1 * 60 * 1000; // 1 dakikada bir "TUT" mesajı (eğer sinyal yoksa)
let lastTradeOrSignalTime = Date.now(); // En son işlem veya sinyal zamanı

async function fetchInitialKlineData() {
    try {
        console.log(`🚀 Geçmiş ${MIN_REQUIRED_HISTORY_LENGTH} adet ${TIMEFRAME} mum verisi çekiliyor...`);
        const response = await axios.get(REST_API_URL, {
            params: {
                symbol: SYMBOL.toUpperCase(),
                interval: TIMEFRAME,
                limit: MIN_REQUIRED_HISTORY_LENGTH + 1
            },
            timeout: 15000
        });

        if (response.data && Array.isArray(response.data)) {
            response.data.forEach(kline => {
                if (!Array.isArray(kline)) return;
                const closeTime = Number(kline[6]);
                const high = Number(kline[2]);
                const low = Number(kline[3]);
                const close = Number(kline[4]);
                if (![closeTime, high, low, close].every(Number.isFinite) ||
                    closeTime >= Date.now() || closeTime <= lastCandleCloseTime) return;
                highHistory.push(high);
                lowHistory.push(low);
                closeHistory.push(close);
                priceHistory.push(close);
                lastCandleCloseTime = closeTime;
            });
            while (priceHistory.length > MIN_REQUIRED_HISTORY_LENGTH) {
                priceHistory.shift();
                highHistory.shift();
                lowHistory.shift();
                closeHistory.shift();
            }
            console.log(`✅ ${priceHistory.length} adet geçmiş mum verisi yüklendi.`);
        } else {
            console.error("❌ Geçmiş veri çekilemedi veya formatı hatalı.");
        }
    } catch (error) {
        console.error("❌ Geçmiş mum verisi çekilirken hata oluştu:", error.message);
        process.exit(1);
    }
}

function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`📡 Binance WebSocket bağlantısı kuruldu: ${SYMBOL}@${TIMEFRAME}`);
    if (closeHistory.length > 0) {
        sendTelegramMessage(`🤖 Bot çalışıyor! Anlık Fiyat: ${closeHistory.at(-1).toFixed(2)}`);
    } else {
        sendTelegramMessage(`🤖 Bot çalışıyor! (Fiyat bekleniyor)`);
    }
    lastTradeOrSignalTime = Date.now(); // Bot başladığında zamanı sıfırla
  });

  ws.on('message', (data) => {
    let parsed;
    try {
        parsed = JSON.parse(data.toString());
    } catch {
        console.warn('Malformed WebSocket message ignored.');
        return;
    }
    const candle = parsed && parsed.k;
    if (!candle || candle.x !== true) return;
    const closeTime = Number(candle.T);
    if (!Number.isFinite(closeTime) || closeTime <= lastCandleCloseTime) return;

    const open = parseFloat(candle.o);
    const high = parseFloat(candle.h);
    const low = parseFloat(candle.l);
    const close = parseFloat(candle.c);

    if (![close, high, low, open].every(Number.isFinite)) return;
    lastCandleCloseTime = closeTime;

    if (priceHistory.length >= MIN_REQUIRED_HISTORY_LENGTH) {
        priceHistory.shift();
        highHistory.shift();
        lowHistory.shift();
        closeHistory.shift();
    }
    priceHistory.push(close);
    highHistory.push(high);
    lowHistory.push(low);
    closeHistory.push(close);


    if (priceHistory.length < MIN_REQUIRED_HISTORY_LENGTH) {
        console.log(`⏳ Veri toplanıyor... (${priceHistory.length}/${MIN_REQUIRED_HISTORY_LENGTH})`);
        return;
    }

    const emaShort = EMA.calculate({ period: EMA_SHORT_PERIOD, values: priceHistory });
    const emaLong = EMA.calculate({ period: EMA_LONG_PERIOD, values: priceHistory });
    const rsi = RSI.calculate({ period: RSI_PERIOD, values: priceHistory });
    const atr = ATR.calculate({ high: highHistory, low: lowHistory, close: closeHistory, period: ATR_PERIOD });

    const currentEMAShort = emaShort.at(-1);
    const currentEMALong = emaLong.at(-1);
    const currentRSI = rsi.at(-1);
    const currentATR = atr.at(-1);
    const previousClose = closeHistory.at(-2);

    const now = Date.now();

    if (![currentEMAShort, currentEMALong, currentRSI, currentATR, previousClose].every(Number.isFinite)) {
        console.log("⚠️ Gösterge hesaplamaları tamamlanmadı veya yeterli geçmiş veri yok, bekliyor...");
        return;
    }

    const emaDiff = Math.abs(currentEMAShort - currentEMALong);
    const atrEmaDiffThreshold = currentATR * EMA_DIFF_MULTIPLIER;

    let signalSentThisTick = false; // Bu mumda sinyal gönderilip gönderilmediğini takip et

    // --- AL Sinyali Mantığı ---
    if (
      (lastTradeType === null || lastTradeType === 'SELL') && // Yalnızca pozisyonda değilken veya SHORT pozisyondayken
      (now - lastSignalTime >= COOLDOWN_MS) && // Cooldown süresi bitmişse (sadece giriş sinyalleri için)
      currentEMAShort > currentEMALong && // Hızlı EMA yavaş EMA üzerinde
      currentRSI >= RSI_BUY_LOWER && currentRSI <= RSI_BUY_UPPER && // RSI alım momentumunda
      close > previousClose + (currentATR * PRICE_CHANGE_MULTIPLIER_BUY) && // Fiyat, önceki mum kapanışından ATR * çarpan kadar artmalı
      emaDiff > atrEmaDiffThreshold // EMA'lar yeterince ayrılmış (trend gücü)
    ) {
      sendTelegramMessage(
        `📈 AGRESİF AL SİNYALİ!\nFiyat: ${close.toFixed(2)}\nEMA${EMA_SHORT_PERIOD}: ${currentEMAShort.toFixed(2)} | EMA${EMA_LONG_PERIOD}: ${currentEMALong.toFixed(2)}\nRSI(${RSI_PERIOD}): ${currentRSI.toFixed(1)}\nATR(${ATR_PERIOD}): ${currentATR.toFixed(2)}`
      );
      lastBuyPrice = close;
      lastSignalTime = now;
      lastTradeType = 'BUY';
      lastTradeOrSignalTime = now; // Yeni bir sinyal geldiğinde zamanı güncelle
      signalSentThisTick = true;
      console.log('✅ AGRESİF AL sinyali gönderildi');
    }

    // --- SAT Sinyali Mantığı ---
    // 1. Mevcut AL pozisyonunu kapatma (Take Profit / Stop Loss)
    if (lastTradeType === 'BUY') {
        let shouldCloseLongPosition = false;
        let reason = "Bilinmiyor";

        // Zarar Kes (Stop-Loss)
        if (lastBuyPrice && close < lastBuyPrice * (1 - STOP_LOSS_PERCENTAGE)) {
            shouldCloseLongPosition = true;
            reason = `Zarar Kes (${(STOP_LOSS_PERCENTAGE * 100).toFixed(1)}%)`;
        }
        // Kar Al veya Trend Dönüşü
        else if (currentEMAShort < currentEMALong) { // EMA ölüm kesişimi (bearish crossover)
            shouldCloseLongPosition = true;
            reason = "EMA bearish crossover";
        } else if (currentRSI > RSI_SELL_UPPER && close < previousClose) { // RSI aşırı alım bölgesinde ve fiyat düşüşe geçmişse
            shouldCloseLongPosition = true;
            reason = "RSI aşırı alım dönüşü";
        } else if (close < previousClose - (currentATR * PRICE_CHANGE_MULTIPLIER_SELL)) { // Fiyat ATR bazında düşüş yaşamışsa (momentum kaybı)
             shouldCloseLongPosition = true;
             reason = "Fiyat ATR bazında düşüş (momentum kaybı)";
        }

        if (shouldCloseLongPosition) {
            sendTelegramMessage(
              `📉 AGRESİF SAT SİNYALİ (Long Pozisyon Kapatma)!\nSebep: ${reason}\nFiyat: ${close.toFixed(2)}\nEMA${EMA_SHORT_PERIOD}: ${currentEMAShort.toFixed(2)} | EMA${EMA_LONG_PERIOD}: ${currentEMALong.toFixed(2)}\nRSI(${RSI_PERIOD}): ${currentRSI.toFixed(1)}\nATR(${ATR_PERIOD}): ${currentATR.toFixed(2)}`
            );
            lastSellPrice = close;
            lastSignalTime = now;
            lastTradeType = 'SELL'; // Pozisyonu 'SELL' (kapalı) olarak işaretle
            lastTradeOrSignalTime = now; // Yeni bir sinyal geldiğinde zamanı güncelle
            signalSentThisTick = true;
            console.log('✅ AGRESİF SAT sinyali gönderildi (Long Pozisyon Kapatma)');
        }
    }
    // 2. Short Pozisyon Girişi (Eğer hiçbir pozisyonda değilsek veya long pozisyondan çıkmışsak)
    else if (lastTradeType === null || lastTradeType === 'BUY') {
        if (
            (now - lastSignalTime >= COOLDOWN_MS) && // Cooldown süresi bitmişse (sadece giriş sinyalleri için)
            currentEMAShort < currentEMALong && // Hızlı EMA yavaş EMA altında
            currentRSI < RSI_SELL_UPPER && currentRSI > RSI_SELL_LOWER && // RSI satış momentumunda (25-80 arası normal bölge)
            close < previousClose - (currentATR * PRICE_CHANGE_MULTIPLIER_SELL) && // Fiyat ATR bazında düşmüş (güçlü düşüş)
            emaDiff > atrEmaDiffThreshold // EMA'lar yeterince ayrılmış (trend gücü)
        ) {
            sendTelegramMessage(
              `🔴 AGRESİF SHORT GİRİŞ SİNYALİ!\nFiyat: ${close.toFixed(2)}\nEMA${EMA_SHORT_PERIOD}: ${currentEMAShort.toFixed(2)} | EMA${EMA_LONG_PERIOD}: ${currentEMALong.toFixed(2)}\nRSI(${RSI_PERIOD}): ${currentRSI.toFixed(1)}\nATR(${ATR_PERIOD}): ${currentATR.toFixed(2)}`
            );
            lastSellPrice = close;
            lastSignalTime = now;
            lastTradeType = 'SELL'; // Pozisyonu 'SELL' (short) olarak işaretle
            lastTradeOrSignalTime = now; // Yeni bir sinyal geldiğinde zamanı güncelle
            signalSentThisTick = true;
            console.log('✅ AGRESİF SHORT GİRİŞ sinyali gönderildi');
        }
    }

    console.log(
      `📊 ${new Date().toLocaleTimeString()} | Fiyat: ${close.toFixed(2)} | EMA${EMA_SHORT_PERIOD}: ${currentEMAShort.toFixed(2)} | EMA${EMA_LONG_PERIOD}: ${currentEMALong.toFixed(2)} | RSI(${RSI_PERIOD}): ${currentRSI.toFixed(1)} | ATR(${ATR_PERIOD}): ${currentATR.toFixed(2)} | EMA Diff: ${emaDiff.toFixed(2)} | Eşik: ${atrEmaDiffThreshold.toFixed(2)} | Son Sinyal: ${lastTradeType || 'Yok'}`
    );
  });

  ws.on('error', (error) => {
      console.error('❌ WebSocket hatası:', error);
  });

  ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket bağlantısı kapatıldı. Kod: ${code}, Neden: ${reason}`);
      console.log("🔄 WebSocket yeniden bağlanmaya çalışıyor...");
      setTimeout(connectWebSocket, 5000);
  });
}

// Botu başlat
async function startBot() {
    await fetchInitialKlineData(); // Önce geçmiş veriyi çek
    connectWebSocket(); // Sonra WebSocket bağlantısını kur

    // --- Durum mesajı gönderme zamanlayıcısını başlat ---
    setInterval(() => {
        if (closeHistory.length > 0) {
            // Periyodik fiyat mesajı, 30 saniyede bir sinyal gelse de gelmese de
            sendTelegramMessage(`🤖 Bot çalışıyor! Anlık Fiyat: ${closeHistory.at(-1).toFixed(2)}`);
        } else {
            sendTelegramMessage(`🤖 Bot çalışıyor! (Fiyat bekleniyor)`);
        }
    }, BOT_STATUS_INTERVAL_MS);

    // --- "TUT" mesajı zamanlayıcısını başlat ---
    setInterval(() => {
        // Eğer son sinyal veya işlemden bu yana yeterli süre geçtiyse ve pozisyonda değilsek
        if (Date.now() - lastTradeOrSignalTime >= HOLD_MESSAGE_INTERVAL_MS) {
            if (lastTradeType === null) { // Sadece pozisyonda değilken TUT mesajı at
                sendTelegramMessage(`🧘 TUT (Pozisyonda Değil)! Yeni sinyal bekleniyor...`);
                lastTradeOrSignalTime = Date.now(); // TUT mesajı gönderildiğinde zamanlayıcıyı sıfırla
            }
        }
    }, HOLD_MESSAGE_INTERVAL_MS); // Her 5 dakikada bir kontrol et
}

startBot();
