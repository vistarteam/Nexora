/**
 * Public exchange WebSocket streams.
 *
 * Only public market data is used; no API key or private channel is involved.
 * Both adapters share one reconnecting socket implementation with:
 *
 *  - exponential backoff (0.5s to 30s) and automatic resubscription,
 *  - a 45-second message watchdog that forces a reconnect,
 *  - payload validation through `sanitizeCandles`, so a malformed exchange row
 *    can never reach the chart,
 *  - explicit connection-state callbacks; a stream is never silently treated as
 *    live once it has dropped.
 *
 * The wire formats are documented at:
 *  - Nobitex: https://apidocs.nobitex.ir/websocket/websocket-public-trades-channel
 *  - Nobitex candles: https://apidocs.nobitex.ir/websocket/websocket-candle-channel
 *  - Binance: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
 */

import WebSocket from 'ws';
import { config } from '../../config/env.js';
import type { Candle, Timeframe } from '../../types/domain.js';
import { createLogger } from '../../lib/logger.js';
import { sanitizeCandles, type TickerStreamHandlers, type TickerTick } from './types.js';

const log = createLogger('market-data:stream');

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;
const MESSAGE_WATCHDOG_MS = 45_000;

const BINANCE_INTERVALS: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

/** Nobitex's candle channel uses numeric resolutions, not NEXORA labels. */
export const NOBITEX_STREAM_RESOLUTION: Partial<Record<Timeframe, string>> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  // The documented channel has no weekly resolution. 1w deliberately falls
  // back to REST polling rather than aggregating an undocumented stream.
};

interface SocketOptions {
  label: string;
  url: string;
  onOpen: (send: (payload: unknown) => void) => void;
  onMessage: (payload: unknown, send: (payload: unknown) => void) => void;
  onStatus: (status: 'connecting' | 'connected' | 'disconnected', detail?: string) => void;
}

/**
 * One reconnecting socket.
 *
 * Resubscription is expressed by `onOpen`, which is invoked on every successful
 * connection (including reconnects). That keeps the "resubscribe after a drop"
 * rule in one place instead of scattering it across adapters.
 */
class ManagedSocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempts = 0;
  private lastMessageAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: SocketOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.stopped || !this.socket) return;
      if (this.lastMessageAt > 0 && Date.now() - this.lastMessageAt > MESSAGE_WATCHDOG_MS) {
        log.warn('WebSocket watchdog expired; reconnecting', { stream: this.options.label });
        this.options.onStatus('disconnected', 'watchdog: no message in 45s');
        this.socket.terminate();
      }
    }, 5_000);
    this.watchdog.unref?.();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.reconnectTimer = null;
    this.watchdog = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.close();
    }
    this.options.onStatus('disconnected');
  }

  private connect(): void {
    if (this.stopped) return;
    this.options.onStatus('connecting');

    let socket: WebSocket;
    try {
      // ws accepts a URL string. The server URL is configuration, never user
      // input, and is validated below before a connection is attempted.
      if (!/^wss?:\/\//i.test(this.options.url)) {
        throw new Error(`invalid WebSocket URL: ${this.options.url}`);
      }
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.options.onStatus('disconnected', (error as Error).message);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      if (this.stopped) return;
      this.attempts = 0;
      this.lastMessageAt = Date.now();
      this.options.onOpen((payload) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
      });
    });

    socket.on('message', (data) => {
      this.lastMessageAt = Date.now();
      try {
        const text = typeof data === 'string' ? data : data.toString();
        this.options.onMessage(JSON.parse(text) as unknown, (payload) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
        });
      } catch (error) {
        // A malformed message is dropped, not allowed to crash the stream.
        log.debug('ignoring malformed WebSocket message', {
          stream: this.options.label,
          reason: (error as Error).message,
        });
      }
    });

    socket.on('error', (error) => {
      log.warn('WebSocket error', { stream: this.options.label, reason: error.message });
      this.options.onStatus('disconnected', error.message);
      // `close` follows, which schedules the reconnect.
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.options.onStatus('disconnected');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

/* ------------------------------------------------------------------ *
 * Pure parsers (unit-tested without a socket)
 * ------------------------------------------------------------------ */

export interface ParsedTick {
  candle: Candle | null;
  price: number;
  eventTime: number | null;
  priceDefinition: 'last_trade' | 'forming_candle_close';
  /** Size of this single trade, for accumulation into a trade-built bar. */
  tradeVolume?: number;
  channel?: string;
}

function usableCandle(candle: Candle): Candle | null {
  const clean = sanitizeCandles([candle]);
  return clean[0] ?? null;
}

/** Parse a Binance `<symbol>@kline_<interval>` event. */
export function parseBinanceKline(raw: unknown): ParsedTick | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const kline = record.k;
  if (typeof kline !== 'object' || kline === null) return null;
  const k = kline as Record<string, unknown>;
  const time = Number(k.t);
  const candle = usableCandle({
    time,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v ?? 0),
  });
  if (!candle) return null;
  return {
    candle,
    price: candle.close,
    eventTime: Number.isFinite(Number(record.E)) ? Number(record.E) : null,
    priceDefinition: 'forming_candle_close',
  };
}

export interface NobitexParsedMessage {
  ping: boolean;
  tick: ParsedTick | null;
  status: 'connected' | 'error' | null;
  detail?: string;
}

/**
 * Parse a Nobitex Centrifugo frame.
 *
 * Trade messages carry price/time/volume; candle messages carry OHLC. The
 * trade frame is mapped to a price-only tick (`candle: null`) and the service
 * folds it into the candle it already holds, preserving OHLC invariants.
 */
export function parseNobitexMessage(raw: unknown): NobitexParsedMessage {
  if (typeof raw !== 'object' || raw === null) {
    return { ping: false, tick: null, status: null };
  }
  const record = raw as Record<string, unknown>;

  // Centrifugo sends an empty object as a ping; the documented reply is also {}.
  if (Object.keys(record).length === 0) {
    return { ping: true, tick: null, status: null };
  }

  if (record.connect !== undefined && record.error === undefined) {
    return { ping: false, tick: null, status: 'connected' };
  }
  if (record.error !== undefined) {
    return {
      ping: false,
      tick: null,
      status: 'error',
      detail: String((record.error as Record<string, unknown> | undefined)?.message ?? record.error),
    };
  }

  const push = record.push as Record<string, unknown> | undefined;
  const channel = typeof push?.channel === 'string' ? push.channel : undefined;
  const publication = push?.pub as Record<string, unknown> | undefined;
  const data = publication?.data;
  if (!channel || typeof data !== 'object' || data === null) {
    return { ping: false, tick: null, status: null };
  }
  const payload = data as Record<string, unknown>;

  if (channel.startsWith('public:trades-')) {
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { ping: false, tick: null, status: null };
    }
    const time = Number(payload.time);
    const volume = Number(payload.volume);
    return {
      ping: false,
      status: null,
      tick: {
        candle: null,
        price,
        eventTime: Number.isFinite(time) && time > 0 ? time : null,
        priceDefinition: 'last_trade',
        tradeVolume: Number.isFinite(volume) && volume > 0 ? volume : undefined,
        channel,
      },
    };
  }

  if (channel.startsWith('public:candle-')) {
    const candle = usableCandle({
      time: Number(payload.t) * 1_000,
      open: Number(payload.o),
      high: Number(payload.h),
      low: Number(payload.l),
      close: Number(payload.c),
      volume: Number(payload.v ?? 0),
    });
    if (!candle) return { ping: false, tick: null, status: null };
    return {
      ping: false,
      status: null,
      tick: {
        candle,
        price: candle.close,
        // The candle frame has no trade timestamp; receipt time is the only
        // honest event evidence available.
        eventTime: null,
        priceDefinition: 'forming_candle_close',
        channel,
      },
    };
  }

  return { ping: false, tick: null, status: null };
}

/* ------------------------------------------------------------------ *
 * Binance
 * ------------------------------------------------------------------ */

export interface StreamRequest {
  symbol: string;
  timeframe: Timeframe;
  nativeTicker: string;
  handlers: TickerStreamHandlers;
}

export class BinanceTickerStream {
  private readonly socket: ManagedSocket;

  constructor(options: StreamRequest & { url?: string }) {
    const interval = BINANCE_INTERVALS[options.timeframe];
    const base = (options.url || config.marketData.binanceWsUrl).replace(/\/+$/, '');
    const url = `${base}/${options.nativeTicker}@kline_${interval}`;
    this.socket = new ManagedSocket({
      label: `binance:${options.nativeTicker}@kline_${interval}`,
      url,
      onOpen: (send) => {
        send({ method: 'SUBSCRIBE', params: [`${options.nativeTicker}@kline_${interval}`], id: 1 });
        options.handlers.onStatus('connected');
      },
      onMessage: (payload) => {
        const parsed = parseBinanceKline(payload);
        if (!parsed || parsed.candle === null) return;
        const tick: TickerTick = {
          symbol: options.symbol,
          timeframe: options.timeframe,
          candle: parsed.candle,
          price: parsed.price,
          priceDefinition: parsed.priceDefinition,
          eventTime: parsed.eventTime,
          receivedAt: Date.now(),
          streamId: `binance:${options.nativeTicker}@kline_${interval}`,
          venue: 'binance',
        };
        options.handlers.onTick(tick);
      },
      onStatus: options.handlers.onStatus,
    });
  }

  start(): void {
    this.socket.start();
  }

  close(): void {
    this.socket.close();
  }
}

/* ------------------------------------------------------------------ *
 * Nobitex (Centrifugo raw protocol)
 * ------------------------------------------------------------------ */

export class NobitexTickerStream {
  private readonly socket: ManagedSocket;

  constructor(options: StreamRequest & { url?: string }) {
    const resolution = NOBITEX_STREAM_RESOLUTION[options.timeframe];
    const base = (options.url || config.marketData.nobitexWsUrl).replace(/\/+$/, '');
    const tradeChannel = `public:trades-${options.nativeTicker}`;
    const candleChannel = resolution
      ? `public:candle-${options.nativeTicker}-${resolution}`
      : null;
    let connected = false;

    this.socket = new ManagedSocket({
      label: `nobitex:${options.nativeTicker}:${options.timeframe}`,
      url: base,
      onOpen: (send) => {
        connected = false;
        send({ id: 1, connect: {} });
        send({ id: 2, subscribe: { channel: tradeChannel } });
        if (candleChannel) send({ id: 3, subscribe: { channel: candleChannel } });
      },
      onMessage: (payload, send) => {
        if (typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0) {
          // Centrifugo requires a pong within 20 seconds.
          send({});
        }
        const parsed = parseNobitexMessage(payload);
        if (parsed.ping) return;
        if (parsed.status === 'connected' && !connected) {
          connected = true;
          options.handlers.onStatus('connected');
        }
        if (parsed.status === 'error') {
          options.handlers.onStatus('disconnected', parsed.detail ?? 'nobitex stream error');
        }
        if (!parsed.tick) return;

        const tick: TickerTick = {
          symbol: options.symbol,
          timeframe: options.timeframe,
          candle: parsed.tick.candle,
          price: parsed.tick.price,
          priceDefinition: parsed.tick.priceDefinition,
          eventTime: parsed.tick.eventTime,
          tradeVolume: parsed.tick.tradeVolume,
          receivedAt: Date.now(),
          streamId: `nobitex:${parsed.tick.channel ?? tradeChannel}`,
          venue: 'nobitex',
        };
        options.handlers.onTick(tick);
      },
      onStatus: options.handlers.onStatus,
    });
  }

  start(): void {
    this.socket.start();
  }

  close(): void {
    this.socket.close();
  }
}
