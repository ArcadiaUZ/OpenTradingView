export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Quote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  time: number;
  msc: number;
};

export type SymbolMeta = {
  symbol: string;
  name: string;
  kind: string;
  digits: number;
  point: number;
  spread: number;
  description?: string;
};

export type FeedStatus = {
  ready: boolean;
  connected: boolean;
  live: boolean;
  serverOffset: number;
  symbols: number;
  uptime: number;
  error?: string | null;
};
