<h1 align="center">HFOTradeBot</h1>

<p align="center"><strong>Follow the candles. Understand the signal.</strong></p>
<p align="center">A Node.js experiment that turns closed Binance BTC/USDT candles into indicator-based Telegram alerts.</p>

<p align="center">
  <strong>English</strong> · <a href="README.tr.md">Türkçe</a><br />
  <a href="#run-locally"><strong>Run locally</strong></a> ·
  <a href="#how-signals-work">Signal logic</a> ·
  <a href="https://github.com/ArdaHFO/HFOTradeBot/issues">Report an issue</a>
</p>

---

HFOTradeBot listens for completed one-minute BTC/USDT candles, combines EMA, RSI and ATR conditions, and sends Turkish buy, exit and hold messages to configured Telegram chats. The default script also keeps an in-memory illustration of a long position, commissions and capital.

**This is an educational signal prototype.** It does not submit exchange orders. Its balance messages are simulated bookkeeping, not an exchange balance or evidence of profitable trading. English and Turkish documentation describe the same implementation.

## Run locally

| Requirement | Current source |
| --- | --- |
| Runtime | Node.js 22.9+ is a compatible choice for the checked-in dependency engine range |
| Package manager | npm and the supplied `package-lock.json` |
| Market connection | Public Binance REST and WebSocket market-data endpoints |
| Notifications | Your own Telegram bot token and one or more chat IDs |
| Default stream | `BTCUSDT`, one-minute candles |

The repository does not declare its own Node.js engine range. The locked `npm` dependency requires Node.js `^20.17.0 || >=22.9.0`, so the previous README's Node.js 14 requirement is insufficient for the current dependency set.

```bash
git clone https://github.com/ArdaHFO/HFOTradeBot.git
cd HFOTradeBot
npm ci
```

Create a local `.env` file in the repository root with your own values. The notification module expects the plural `TELEGRAM_CHAT_IDS` setting.

```dotenv
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_IDS=your_chat_id,another_chat_id
```

Use a bot and chats you control. `.env` is ignored by Git. The legacy `chatid.js` utility does not read this environment configuration and is not part of this setup flow.

Start the configured bot deliberately. This command connects to Binance and can immediately send a startup message, followed by signals and periodic hold messages to every configured chat.

```bash
npm start
```

Stop it with `Ctrl+C`. No Binance account key is needed because the application only reads public market data.

## Inside the bot

- **Closed-candle processing.** REST history seeds the indicators, then the WebSocket handler processes candles only when Binance marks them closed.
- **Three indicator families.** EMA 5/21 supplies trend direction, RSI 14 filters momentum, and ATR 7 scales movement and EMA-separation thresholds.
- **Stateful entry and exit alerts.** The default script follows a single simulated long position and reports why an exit condition was met.
- **Multiple Telegram recipients.** `notify.js` reads comma-separated chat IDs and sends each recipient the same message.
- **Hold updates.** A one-minute timer reports a held position or the wait for a new entry when no recent signal was sent.
- **Connection retry.** A closed WebSocket triggers another connection attempt after five seconds.

## How signals work

The default entry point is [`index.js`](index.js), selected by `npm start`. Strategy settings are constants near the top of that file, rather than `.env` options.

| Setting | Default behavior |
| --- | --- |
| Entry | No simulated position, fast EMA above slow EMA, RSI in the configured range, and ATR-based price/separation filters |
| Cooldown | 10 seconds between qualifying entry signals |
| Exit | Simulated stop loss, bearish EMA relationship, qualifying momentum reversal, or simulated profit target |
| Fee assumption | 0.1% per side in the illustrative capital calculation |
| Stop-loss threshold | 0.7% in the simulated net-return calculation |
| Profit target | 0.2% in the simulated net-return calculation |

The code compares the current EMA values. It does not require a newly observed crossover between two successive candles. The starting capital is an illustrative constant of 20,000. Messages label it `TL` although the feed is BTC/USDT and no foreign-exchange conversion is implemented.

[`BEST.js`](BEST.js) is an alternative strategy script with different position/status behavior. It is not the default launch target and should be reviewed separately before use.

## Development and validation

The source is a small CommonJS application. `ws` handles streaming, `axios` handles HTTP, `technicalindicators` supplies the indicators, and `dotenv` loads local notification configuration.

Syntax checks can inspect the scripts without starting a market connection or sending a Telegram message.

```bash
node --check index.js
node --check BEST.js
node --check notify.js
```

No automated test suite, backtest engine or CI workflow is included in the application source. This documentation update did not run the bot, contact Telegram, place orders or validate strategy performance.

Current limits include in-memory state that resets on restart, no recovery of candles missed during a disconnect, and no durable trade ledger. The simulated capital calculation has not been independently reconciled. These constraints matter when interpreting alerts or the displayed performance percentage.

## Repository map

| Path | Purpose |
| --- | --- |
| [`index.js`](index.js) | Default candle processing, strategy and simulated balance |
| [`notify.js`](notify.js) | Environment-configured Telegram delivery |
| [`BEST.js`](BEST.js) | Alternative strategy implementation |
| [`chatid.js`](chatid.js) | Legacy standalone chat lookup helper |
| [`package.json`](package.json) | Start command and declared dependencies |
| [`package-lock.json`](package-lock.json) | Locked dependency graph |

The repository also contains a tracked `node_modules` tree. Use the manifests and `npm ci` for your local dependency installation rather than treating those checked-in files as a portable environment.

## Contributing

Open an issue with the Node.js version, affected script, expected behavior and sanitized reproduction steps. For signal changes, include closed-candle examples and the expected state transition. Keep tokens and chat identifiers out of reports and commits. Proposals for multi-pair support, reproducible backtesting or a dashboard should include a defined scope and validation approach.

## License and credits

No project-level license file is present. This documentation does not assign a new license. Dependencies retain their own licenses. Binance provides the public market-data endpoints, Telegram provides notification delivery, and `technicalindicators` supplies the indicator calculations. No affiliation or endorsement is implied.
