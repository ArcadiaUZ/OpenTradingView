import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type UTCTimestamp,
} from "lightweight-charts";
import { TF_SECONDS, barDirection, fmtChangePct, fmtPrice, makeTickMarkFormatter, pad2 } from "../lib/format";
import { bollinger, ema, sma, type Point } from "../lib/indicators";
import type { Bar } from "../lib/types";
import { openTrade, usePaper } from "../lib/paper";
import { useTerminal, type ChartType } from "../store";
import { drawToolDef, useDrawings, type DrawPoint, type DrawTool, type Drawing } from "../lib/drawings";
import { useReplay } from "../lib/replay";
import { dashFor, fmtDuration, hitTest, makeViewport, measureStats, resolveDrawing, type Prim, type Viewport, type XY } from "../lib/drawGeometry";
import { autoPositionPoints, computePositionInfo, positionHandles, positionSide, type PositionInfo, type PositionRole } from "../lib/positionTool";
import DrawToolbar from "./DrawToolbar";
import DrawingSettings from "./DrawingSettings";

type BaseSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Bar"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;

type MeasureState = { a: DrawPoint; b: DrawPoint | null };

function toOhlc(bar: Bar) {
  return {
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

function toClose(bar: Bar) {
  return { time: bar.time as UTCTimestamp, value: bar.close };
}

function seriesData(bars: Bar[], type: ChartType) {
  return type === "line" || type === "area" ? bars.map(toClose) : bars.map(toOhlc);
}

function seriesPoint(bar: Bar, type: ChartType) {
  return type === "line" || type === "area" ? toClose(bar) : toOhlc(bar);
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = (hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
  const num = parseInt(full, 16);
  if (!isFinite(num)) return "rgba(30,144,255," + alpha + ")";
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

const PRICE_LINE = {
  priceLineVisible: true,
  priceLineColor: "#1e90ff",
  priceLineWidth: 1 as const,
  priceLineStyle: LineStyle.Dotted,
  lastValueVisible: false,
};

export default function ChartPanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const baseRef = useRef<BaseSeries | null>(null);
  const overlaysRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const barMapRef = useRef<Map<number, Bar>>(new Map());
  const digitsRef = useRef(5);

  const symbol = useTerminal((s) => s.symbol);
  const tf = useTerminal((s) => s.tf);
  const data = useTerminal((s) => s.data);
  const meta = useTerminal((s) => s.meta);
  const quote = useTerminal((s) => s.quotes[s.symbol]);
  const hover = useTerminal((s) => s.hover);
  const clockTs = useTerminal((s) => s.clockTs);
  const status = useTerminal((s) => s.status);
  const setHover = useTerminal((s) => s.setHover);
  const chartType = useTerminal((s) => s.chartType);
  const indicators = useTerminal((s) => s.indicators);
  const settings = useTerminal((s) => s.settings);
  const tool = useTerminal((s) => s.tool);
  const viewRequest = useTerminal((s) => s.viewRequest);
  const chartCmd = useTerminal((s) => s.chartCmd);

  // ------------------------------------------------------- chizmalar (store)
  const drawings = useDrawings((s) => s.drawings);
  const drawingTool = useDrawings((s) => s.tool);
  const draft = useDrawings((s) => s.draft);
  const selectedId = useDrawings((s) => s.selectedId);
  const drawingDefaults = useDrawings((s) => s.defaults);
  const hiddenDrawings = useDrawings((s) => s.hidden);

  const [pillTop, setPillTop] = useState<number | null>(null);
  const [atLive, setAtLive] = useState(true);
  const [priceAuto, setPriceAuto] = useState(true);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const [measureDone, setMeasureDone] = useState(false);
  const [preview, setPreview] = useState<DrawPoint | null>(null);
  const [vpVersion, setVpVersion] = useState(0);
  /** Kursorni tutqich/obyekt ustiga qo'yganda vizual javob (TradingView kabi). */
  const [hoverHandle, setHoverHandle] = useState<{ id: string; index: number } | null>(null);
  /** Kursor Long/Short pozitsiya ustida bo'lsa — shundagina ma'lumot yorliqlari ko'rinadi. */
  const [hoverPosId, setHoverPosId] = useState<string | null>(null);
  /** TradingView kabi: Ctrl bosib turilganda crosshair narxni OHLC (wick) qiymatiga yopishadi. */
  const [magnetHeld, setMagnetHeld] = useState(false);

  const measureRef = useRef<MeasureState | null>(null);
  const measureDoneRef = useRef(false);
  const vpRef = useRef<Viewport | null>(null);
  const rafRef = useRef(0);
  const barsRef = useRef<Bar[]>([]);
  const tfSecRef = useRef(60);
  const symbolRef = useRef(symbol);
  const drawingsRef = useRef<Drawing[]>([]);
  /** Oxirgi hover qilingan sham — bir xil shamda qayta render qilmaslik uchun. */
  const hoverRef = useRef<Bar | null>(null);
  /** Sichqonchaning oxirgi holati (Ctrl bosilganda crosshair'ni darhol yangilash uchun). */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Magnit rejimi (Ctrl) — chizma nuqtalari ham OHLC'ga yopishishi uchun ref. */
  const magnetRef = useRef(false);

  // ---------------------------------------------------------- replay holati
  const replayActive = useReplay((s) => s.active);
  const replayTf = useReplay((s) => s.tf);
  const replayCursor = useReplay((s) => s.cursor);
  const replayBars = useReplay((s) => s.bars);

  // Long/Short asbobidagi lot va $ hisoblari paper hisobning lot sozlamasidan olinadi.
  const toolLots = usePaper((s) => s.lots);

  const digits = meta ? meta.digits : symbol === "XAUUSD" ? 2 : 5;
  const name = meta ? meta.name : symbol;
  const bars = data ? data.bars : [];

  // Replay paytida chart faqat kursor vaqtigacha bo'lgan shammlarni ko'rsatadi.
  const viewBars = useMemo(() => {
    if (!replayActive) return bars;
    if (replayCursor === null) return [];
    const revealed: Bar[] = [];
    for (const bar of replayBars) {
      if (bar.time > replayCursor) break;
      revealed.push(bar);
    }
    return revealed;
  }, [replayActive, replayBars, replayCursor, bars]);

  const lastBar = viewBars.length ? viewBars[viewBars.length - 1] : null;
  const price = replayActive ? (lastBar ? lastBar.close : null) : quote ? quote.mid : lastBar ? lastBar.close : null;
  const seconds = TF_SECONDS[tf] || 60;
  const point = meta ? meta.point : 0.00001;

  const liveSpread = quote ? Math.max(0, Number(quote.ask) - Number(quote.bid)) : 0;
  const replayClose = replayActive && lastBar ? lastBar.close : null;
  const bidValue = replayActive
    ? replayClose !== null
      ? replayClose - liveSpread / 2
      : undefined
    : quote
      ? quote.bid
      : undefined;
  const askValue = replayActive
    ? replayClose !== null
      ? replayClose + liveSpread / 2
      : undefined
    : quote
      ? quote.ask
      : undefined;

  useEffect(() => {
    digitsRef.current = digits;
  }, [digits]);

  useEffect(() => {
    barsRef.current = viewBars;
    tfSecRef.current = TF_SECONDS[tf] || 60;
  }, [viewBars, tf]);

  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  // ------------------------------------------------------------------ viewport
  const computeViewport = useCallback((): Viewport | null => {
    const chart = chartRef.current;
    const series = baseRef.current;
    const host = hostRef.current;
    if (!chart || !series || !host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    const ts = chart.timeScale();
    let axisW = 74;
    let paneH = rect.height - 30;
    try {
      axisW = chart.priceScale("right").width();
      paneH = chart.paneSize().height;
    } catch (err) {
      /* chart hali tayyor emas */
    }
    if (!paneH || paneH < 4) paneH = Math.max(40, rect.height - 30);
    const priceRange = series.priceScale().getVisibleRange();
    const viewport = makeViewport({
      bars: barsRef.current,
      tfSec: tfSecRef.current,
      width: Math.max(10, rect.width - axisW),
      height: paneH,
      barSpacing: Number(ts.options().barSpacing) || 7,
      logicalToX: (logical: number) => {
        const x = ts.logicalToCoordinate(logical as unknown as Logical);
        return x === null ? null : Number(x);
      },
      priceToY: (value: number) => {
        const y = series.priceToCoordinate(value);
        return y === null ? null : Number(y);
      },
      priceRange: priceRange ? { from: Number(priceRange.from), to: Number(priceRange.to) } : null,
      paneHeight: paneH,
    });
    vpRef.current = viewport;
    return viewport;
  }, []);

  /** Oxirgi hisoblangan koordinata holati — o'zgarmagan bo'lsa render qilmaymiz. */
  const lastViewportRef = useRef<{
    width: number;
    height: number;
    barSpacing: number;
    priceFrom: number;
    priceTo: number;
    logicalFrom: number;
    logicalTo: number;
    bars: number;
    lastTime: number;
  } | null>(null);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const viewport = computeViewport();
      if (!viewport) return;
      const chart = chartRef.current;
      const series = baseRef.current;
      const range = series ? series.priceScale().getVisibleRange() : null;
      const logical = chart ? chart.timeScale().getVisibleLogicalRange() : null;
      const bars = barsRef.current;
      const round = (value: number, digits: number) => Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits);
      const stamp = {
        width: round(viewport.width, 1),
        height: round(viewport.height, 1),
        barSpacing: round(viewport.barSpacing || 0, 2),
        priceFrom: range ? round(Number(range.from), 6) : 0,
        priceTo: range ? round(Number(range.to), 6) : 0,
        logicalFrom: logical ? round(Number(logical.from), 3) : 0,
        logicalTo: logical ? round(Number(logical.to), 3) : 0,
        bars: bars.length,
        lastTime: bars.length ? bars[bars.length - 1].time : 0,
      };
      const prev = lastViewportRef.current;
      lastViewportRef.current = stamp;
      const same =
        prev !== null &&
        prev.width === stamp.width &&
        prev.height === stamp.height &&
        prev.barSpacing === stamp.barSpacing &&
        prev.priceFrom === stamp.priceFrom &&
        prev.priceTo === stamp.priceTo &&
        prev.logicalFrom === stamp.logicalFrom &&
        prev.logicalTo === stamp.logicalTo &&
        prev.bars === stamp.bars &&
        prev.lastTime === stamp.lastTime;
      // Koordinatalar o'zgarmagan (masalan crosshair shunchaki siljigan) — ortiqcha
      // React render qilmaymiz; shu tufayli sichqoncha harakatida chart qotmaydi.
      if (same) return;
      setVpVersion((value) => value + 1);
    });
  }, [computeViewport]);

  useEffect(() => {
    scheduleDraw();
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [scheduleDraw]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => scheduleDraw());
    observer.observe(host);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  useEffect(() => {
    drawingsRef.current = drawings.filter((item) => item.symbol === symbol && !hiddenDrawings);
    scheduleDraw();
  }, [drawings, symbol, hiddenDrawings, scheduleDraw]);

  // ---------------------------------------------------------------- chart setup
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#b8b8b8",
        fontFamily: "'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif",
        fontSize: 11,
        // TradingView logotipi o'chirilgan — brending yo'q (Apache-2.0 ruxsat beradi).
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#0d0f13" },
        horzLines: { color: "#0d0f13" },
      },
      rightPriceScale: {
        borderColor: "#22252c",
        minimumWidth: 74,
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#22252c",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7,
        tickMarkFormatter: makeTickMarkFormatter(),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#5d6a7a", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#363a45" },
        horzLine: { color: "#5d6a7a", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#363a45" },
      },
      localization: {
        locale: "en-US",
        priceFormatter: (value: number) => value.toFixed(digitsRef.current),
        timeFormatter: (time: unknown) => {
          const date = new Date(Number(time) * 1000);
          return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
        },
      },
    });

    chartRef.current = chart;
    (window as any).__chart = chart;

    chart.subscribeCrosshairMove((param) => {
      scheduleDraw();
      const pushHover = (next: Bar | null) => {
        const prev = hoverRef.current;
        if (
          prev === next ||
          (prev !== null &&
            next !== null &&
            prev.time === next.time &&
            prev.open === next.open &&
            prev.high === next.high &&
            prev.low === next.low &&
            prev.close === next.close)
        ) {
          return;
        }
        hoverRef.current = next;
        setHover(next);
      };
      if (!param.time || !param.seriesData) {
        pushHover(null);
        return;
      }
      const base = baseRef.current;
      const raw = base ? (param.seriesData.get(base as any) as any) : null;
      if (raw && raw.open !== undefined) {
        pushHover({ time: Number(param.time), open: raw.open, high: raw.high, low: raw.low, close: raw.close });
        return;
      }
      const bar = barMapRef.current.get(Number(param.time));
      pushHover(bar || null);
    });

    const onRange = (range: { from: number; to: number } | null) => {
      scheduleDraw();
      if (useReplay.getState().active) {
        setAtLive(false);
        return;
      }
      const state = useTerminal.getState();
      const current = state.data ? state.data.bars : [];
      if (!current.length) return;
      setAtLive(range ? range.to >= current.length - 2 : true);
      if (!range) return;
      if (range.from < 12) state.requestMore();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    scheduleDraw();

    return () => {
      overlaysRef.current.clear();
      chart.remove();
      chartRef.current = null;
      baseRef.current = null;
      vpRef.current = null;
      if ((window as any).__chart === chart) (window as any).__chart = null;
    };
  }, [setHover, scheduleDraw]);

  // ------------------------------------------------------- base series per chart type
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const prev = baseRef.current;
    if (prev) {
      try {
        chart.removeSeries(prev as any);
      } catch (err) {
        /* chart gone */
      }
      baseRef.current = null;
    }

    let series: BaseSeries;
    if (chartType === "candles") {
      series = chart.addSeries(CandlestickSeries, {
        upColor: "#1e90ff",
        downColor: "#b0e0e6",
        borderUpColor: "#1e90ff",
        borderDownColor: "#b0e0e6",
        wickUpColor: "#1e90ff",
        wickDownColor: "#b0e0e6",
        ...PRICE_LINE,
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    } else if (chartType === "bars") {
      series = chart.addSeries(BarSeries, {
        upColor: "#1e90ff",
        downColor: "#b0e0e6",
        ...PRICE_LINE,
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    } else if (chartType === "line") {
      series = chart.addSeries(LineSeries, {
        color: "#1e90ff",
        lineWidth: 2,
        ...PRICE_LINE,
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    } else {
      series = chart.addSeries(AreaSeries, {
        lineColor: "#1e90ff",
        topColor: "rgba(30, 144, 255, 0.30)",
        bottomColor: "rgba(30, 144, 255, 0.02)",
        lineWidth: 2,
        ...PRICE_LINE,
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    }
    baseRef.current = series;
    (window as any).__series = series;

    // Replay paytida seriyani replay effekti to'ldiradi (jonli ma'lumot bilan aralashtirmaymiz).
    if (useReplay.getState().active) {
      scheduleDraw();
      return;
    }

    const currentBars = useTerminal.getState().data ? useTerminal.getState().data!.bars : [];
    if (currentBars.length) {
      try {
        (series as any).setData(seriesData(currentBars, chartType));
        if (prevRange) chart.timeScale().setVisibleLogicalRange(prevRange);
      } catch (err) {
        /* ignore */
      }
    }
    scheduleDraw();
  }, [chartType, scheduleDraw]);

  // price precision follows the instrument
  useEffect(() => {
    const series = baseRef.current;
    if (!series) return;
    series.applyOptions({
      priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) },
    });
  }, [digits, chartType]);

  // --------------------------------------------------- vertical drag / price pan
  useEffect(() => {
    const host = hostRef.current;
    const chart = chartRef.current;
    if (!host || !chart) return;

    let gesture: { x0: number; y0: number; lo: number; hi: number; paneH: number; auto: boolean; tookOver: boolean } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const state = useTerminal.getState();
      if (state.tool === "measure") return;
      if (useDrawings.getState().tool) return;
      const series = baseRef.current;
      if (!series) return;
      const rect = host.getBoundingClientRect();
      const axisW = chart.priceScale("right").width();
      const tsH = chart.timeScale().height();
      if (e.clientX > rect.right - axisW) return;
      if (e.clientY > rect.bottom - tsH) return;
      const viewport = vpRef.current;
      if (viewport) {
        const hit = hitTest(drawingsRef.current, viewport, e.clientX - rect.left, e.clientY - rect.top);
        if (hit) return;
      }
      const range = series.priceScale().getVisibleRange();
      if (!range) return;
      gesture = {
        x0: e.clientX,
        y0: e.clientY,
        lo: Number(range.from),
        hi: Number(range.to),
        paneH: Math.max(50, rect.height - tsH),
        auto: Boolean(chart.options().rightPriceScale.autoScale),
        tookOver: false,
      };
    };

    const onMove = (e: PointerEvent) => {
      const g = gesture;
      const series = baseRef.current;
      if (!g || !series) return;
      const dy = e.clientY - g.y0;
      const dx = e.clientX - g.x0;
      if (!g.auto) return;
      if (!g.tookOver) {
        if (Math.abs(dy) < 5 || Math.abs(dy) < Math.abs(dx) * 1.15) return;
        try {
          series.priceScale().applyOptions({ autoScale: false });
        } catch (err) {
          return;
        }
        g.tookOver = true;
        setPriceAuto(false);
      }
      const shift = (dy * (g.hi - g.lo)) / g.paneH;
      try {
        series.priceScale().setVisibleRange({ from: g.lo + shift, to: g.hi + shift });
      } catch (err) {
        /* ignore */
      }
      scheduleDraw();
    };

    const onUp = () => {
      gesture = null;
    };

    const onDblClick = (e: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      const axisW = chart.priceScale("right").width();
      if (e.clientX <= rect.right - axisW) return;
      const series = baseRef.current;
      if (!series) return;
      series.priceScale().applyOptions({ autoScale: true });
      setPriceAuto(true);
      scheduleDraw();
    };

    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    host.addEventListener("dblclick", onDblClick, true);
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      host.removeEventListener("dblclick", onDblClick, true);
    };
  }, [scheduleDraw]);

  // ------------------------------------------------------------ drawing / measure
  useEffect(() => {
    const host = hostRef.current;
    const chart = chartRef.current;
    if (!host || !chart) return;

    let drag: {
      id: string;
      type: DrawTool;
      part: "point" | "body" | "position";
      /** Long/Short pozitsiyasida qaysi tutqich ushlangani. */
      role: PositionRole | null;
      index: number;
      startLogical: number;
      startPrice: number;
      orig: DrawPoint[];
    } | null = null;
    let brush: DrawPoint[] | null = null;
    let downAt: { x: number; y: number } | null = null;
    let lastHoverCheck = 0;

    const plotBox = () => {
      const rect = host.getBoundingClientRect();
      let axisW = 74;
      let tsH = 28;
      try {
        axisW = chart.priceScale("right").width();
        tsH = chart.timeScale().height();
      } catch (err) {
        /* ignore */
      }
      return { rect, w: rect.width - axisW, h: rect.height - tsH };
    };

    const localPoint = (event: PointerEvent | MouseEvent) => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const priceAt = (y: number): number | null => {
      const series = baseRef.current;
      if (!series) return null;
      const value = series.coordinateToPrice(y);
      if (value === null) return null;
      const num = Number(value);
      return isFinite(num) ? num : null;
    };

    const timeAt = (x: number): number => {
      const ts = chart.timeScale();
      const step = tfSecRef.current || 60;
      const raw = ts.coordinateToTime(x);
      if (raw !== null && raw !== undefined) {
        const num = typeof raw === "number" ? raw : raw instanceof Date ? Math.floor(raw.getTime() / 1000) : null;
        if (num !== null && isFinite(num)) return Math.round(num / step) * step;
      }
      const logical = ts.coordinateToLogical(x);
      const list = barsRef.current;
      if (list.length) {
        const index = logical === null ? list.length - 1 : Number(logical);
        const last = list[list.length - 1].time;
        return Math.round((last + (index - (list.length - 1)) * step) / step) * step;
      }
      return Math.round(Date.now() / 1000 / step) * step;
    };

    /**
     * x -> uzluksiz logical indeks. `timeScale().coordinateToLogical` butun indeksga
     * yaxlitlaydi (Math.ceil), shu sababli chizma sudralganda vaqt sakrab-sakrab
     * siljirdi. Bu yerda indeks orasidagi masofani hisoblab uzluksiz qiymat olamiz.
     */
    const logicalAt = (x: number): number => {
      const ts = chart.timeScale();
      const index = ts.coordinateToLogical(x);
      if (index === null) return 0;
      const base = Number(index);
      const first = ts.logicalToCoordinate(base as unknown as Logical);
      const second = ts.logicalToCoordinate((base + 1) as unknown as Logical);
      if (first === null || second === null) return base;
      const span = Number(second) - Number(first);
      if (!isFinite(span) || Math.abs(span) < 0.0001) return base;
      return base + (x - Number(first)) / span;
    };

    /** Ctrl (magnit) yoqilganda narxni kursordagi shamning eng yaqin OHLC qiymatiga tortadi. */
    const snapToOhlc = (x: number, price: number): number => {
      const series = baseRef.current;
      const list = barsRef.current;
      if (!series || !list.length) return price;
      const index = Math.round(logicalAt(x));
      const bar = list[index];
      if (!bar) return price;
      const y = series.priceToCoordinate(price);
      if (y === null) return price;
      let best = price;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const value of [bar.open, bar.high, bar.low, bar.close]) {
        const candidate = series.priceToCoordinate(value);
        if (candidate === null) continue;
        const distance = Math.abs(Number(candidate) - Number(y));
        if (distance < bestDist) {
          bestDist = distance;
          best = value;
        }
      }
      return best;
    };

    const dataPoint = (x: number, y: number): DrawPoint | null => {
      const raw = priceAt(y);
      if (raw === null || raw <= 0) return null;
      const priceValue = magnetRef.current ? snapToOhlc(x, raw) : raw;
      const timeValue = timeAt(x);
      if (!isFinite(timeValue)) return null;
      return { time: timeValue, price: Number(priceValue.toPrecision(10)) };
    };

    /** Burchakni qulflash mumkin bo'lgan asboblar (Shift bosilganda 45° qadamlar). */
    const angleLockTool = (id: DrawTool | null): boolean =>
      id === "trendline" || id === "ray" || id === "arrow";

    /**
     * Shift bosilganda kursorni langar nuqtadan chiqqan 45° (gorizontal/vertikal/
     * diagonal) yo'nalishga proyeksiya qiladi — TradingView'dagi kabi chiziq
     * "tekis" gorizontal yoki aniq 45° bo'lib chiziladi.
     */
    const angleLockedPoint = (anchor: DrawPoint, x: number, y: number): DrawPoint | null => {
      const viewport = vpRef.current;
      if (!viewport) return null;
      const ax = viewport.timeToX(anchor.time);
      const ay = viewport.priceToY(anchor.price);
      const dx = x - ax;
      const dy = y - ay;
      const length = Math.hypot(dx, dy);
      if (length < 4) return null;
      const quarter = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / quarter) * quarter;
      const priceValue = priceAt(ay + Math.sin(angle) * length);
      if (priceValue === null || priceValue <= 0) return null;
      const timeValue = timeAt(ax + Math.cos(angle) * length);
      if (!isFinite(timeValue)) return null;
      return { time: timeValue, price: Number(priceValue.toPrecision(10)) };
    };

    /** Nuqta qo'shish/sudrash paytida Shift qulfini qo'llaydi. */
    const draftPoint = (x: number, y: number, event: PointerEvent, anchor: DrawPoint | null): DrawPoint | null => {
      const base = dataPoint(x, y);
      if (!base || !event.shiftKey || !anchor) return base;
      return angleLockedPoint(anchor, x, y) || base;
    };

    const finishMulti = (type: "polyline" | "brush") => {
      const store = useDrawings.getState();
      const points = store.draft || [];
      if (points.length < 2) {
        store.setDraft(null);
        return;
      }
      const id = store.commit({ type, symbol: symbolRef.current, points });
      store.setDraft(null);
      store.setTool(null);
      if (id) store.select(id);
      setPreview(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const pos = localPoint(event);
      const box = plotBox();
      if (pos.x < 0 || pos.y < 0 || pos.x > box.w || pos.y > box.h) return;
      const store = useDrawings.getState();

      if (store.tool) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const value = dataPoint(pos.x, pos.y);
        if (!value) return;

        if (store.tool === "long" || store.tool === "short") {
          // TradingView kabi: bitta bosish — kirish nuqtasi, TP/SL avtomatik 1:1.
          const side = store.tool === "long" ? "long" : "short";
          const points = autoPositionPoints({
            side,
            entry: value,
            bars: barsRef.current,
            tfSec: tfSecRef.current || 60,
          });
          const id = store.commit({ type: store.tool, symbol: symbolRef.current, points });
          store.setTool(null);
          if (id) store.select(id);
          return;
        }

        const toolDef = drawToolDef(store.tool);

        if (store.tool === "brush") {
          brush = [value];
          store.setDraft([value]);
          return;
        }

        if (store.tool === "polyline") {
          const points = (store.draft || []).concat(value);
          // Oxirgi nuqta ustiga qayta bosish — chizishni tugatadi.
          const viewport = vpRef.current;
          const previous = store.draft && store.draft.length ? store.draft[store.draft.length - 1] : null;
          if (previous && viewport) {
            const dx = viewport.timeToX(previous.time) - viewport.timeToX(value.time);
            const dy = viewport.priceToY(previous.price) - viewport.priceToY(value.price);
            if (Math.hypot(dx, dy) < 5 && points.length > 2) {
              finishMulti("polyline");
              return;
            }
          }
          store.setDraft(points);
          return;
        }

        if (toolDef.points === 1) {
          if (store.tool === "text") {
            const text = window.prompt("Matn:", "Matn");
            if (text === null) return;
            const id = store.commit({ type: "text", symbol: symbolRef.current, points: [value], text: text.trim() || "Matn" });
            store.setTool(null);
            if (id) store.select(id);
          } else {
            const id = store.commit({ type: store.tool, symbol: symbolRef.current, points: [value] });
            store.setTool(null);
            if (id) store.select(id);
          }
          return;
        }

        const draftSoFar = store.draft || [];
        const locked =
          angleLockTool(store.tool) && draftSoFar.length ? draftPoint(pos.x, pos.y, event, draftSoFar[0]) : null;
        const points = draftSoFar.concat(locked || value);
        store.setDraft(points);
        if (points.length >= toolDef.points) {
          const id = store.commit({ type: store.tool, symbol: symbolRef.current, points });
          store.setDraft(null);
          store.setTool(null);
          if (id) store.select(id);
        }
        return;
      }

      if (useTerminal.getState().tool === "measure") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const value = dataPoint(pos.x, pos.y);
        if (!value) return;
        const current = measureRef.current;
        if (!current || measureDoneRef.current) {
          const next = { a: value, b: value };
          measureRef.current = next;
          measureDoneRef.current = false;
          setMeasure(next);
          setMeasureDone(false);
        } else {
          const next = { a: current.a, b: value };
          measureRef.current = next;
          measureDoneRef.current = true;
          setMeasure(next);
          setMeasureDone(true);
        }
        return;
      }

      // Cursor: chizmani tanlash yoki sudrash.
      const viewport = computeViewport();
      if (!viewport) return;
      const hit = hitTest(drawingsRef.current, viewport, pos.x, pos.y, 6, store.selectedId);
      if (hit) {
        event.preventDefault();
        event.stopImmediatePropagation();
        store.select(hit.drawing.id);
        host.style.cursor = "grabbing";
        if (hit.drawing.locked) {
          host.style.cursor = "";
          return;
        }
        const logical = logicalAt(pos.x);
        let part: "point" | "body" | "position" = hit.part;
        let role: PositionRole | null = null;
        if (positionSide(hit.drawing) !== null) {
          const handles = positionHandles(hit.drawing, viewport);
          let best: { role: PositionRole; dist: number } | null = null;
          for (const handle of handles) {
            const dist = Math.hypot(handle.x - pos.x, handle.y - pos.y);
            if (dist <= 14 && (!best || dist < best.dist)) best = { role: handle.role, dist };
          }
          if (best) {
            part = "position";
            role = best.role;
          }
        }
        drag = {
          id: hit.drawing.id,
          type: hit.drawing.type,
          part,
          role,
          index: hit.index,
          startLogical: logical === null ? 0 : Number(logical),
          startPrice: priceAt(pos.y) || 0,
          orig: hit.drawing.points.map((item) => ({ ...item })),
        };
        setPreview(null);
        return;
      }
      downAt = { x: pos.x, y: pos.y };
    };

    // Sichqoncha 125–1000 Hz da harakatlanganda har bir hodisada React render qilish
    // chartni qotirardi. Shuning uchun pointermove'ni kadrga (rAF) birlashtiramiz:
    // har kadrda faqat oxirgi holat qo'llanadi.
    let pendingMove: PointerEvent | null = null;
    let moveFrame = 0;

    const handleMove = (event: PointerEvent) => {
      const store = useDrawings.getState();
      if (store.tool) {
        const pos = localPoint(event);
        const box = plotBox();
        const clampX = Math.max(0, Math.min(pos.x, box.w));
        const clampY = Math.max(0, Math.min(pos.y, box.h));
        const value = dataPoint(clampX, clampY);
        if (!value) return;
        if (brush) {
          const viewport = vpRef.current;
          const last = brush[brush.length - 1];
          if (viewport) {
            const dx = viewport.timeToX(last.time) - viewport.timeToX(value.time);
            const dy = viewport.priceToY(last.price) - viewport.priceToY(value.price);
            if (Math.hypot(dx, dy) < 3) return;
          }
          brush = brush.concat(value);
          store.setDraft(brush);
          return;
        }
        if (store.tool === "brush") return;
        const draftSoFar = store.draft || [];
        const locked =
          angleLockTool(store.tool) && draftSoFar.length ? draftPoint(clampX, clampY, event, draftSoFar[0]) : null;
        setPreview(locked || value);
        return;
      }

      if (useTerminal.getState().tool === "measure") {
        const current = measureRef.current;
        if (!current || measureDoneRef.current) return;
        const pos = localPoint(event);
        const box = plotBox();
        const value = dataPoint(Math.max(0, Math.min(pos.x, box.w)), Math.max(0, Math.min(pos.y, box.h)));
        if (!value) return;
        const next = { a: current.a, b: value };
        measureRef.current = next;
        setMeasure(next);
        return;
      }

      if (!drag) {
        // Hech narsa sudralmayapti — kursor chizma ustida ekanini ko'rsatamiz.
        // Og'ir chizmalarda (qalam, ko'p nuqtali) har pikselda hisoblamaymiz.
        const stamp = Date.now();
        if (stamp - lastHoverCheck < 45) return;
        lastHoverCheck = stamp;
        const viewport = vpRef.current;
        if (!viewport) return;
        const pos = localPoint(event);
        const box = plotBox();
        if (pos.x < 0 || pos.y < 0 || pos.x > box.w || pos.y > box.h) {
          setHoverHandle((prev) => (prev ? null : prev));
          setHoverPosId((prev) => (prev ? null : prev));
          if (host.style.cursor) host.style.cursor = "";
          return;
        }
        // Long/Short tutqichlari (TP/SL/kirish/kenglik) ustuvor: kursor turi role bo'yicha.
        let next: { id: string; index: number } | null = null;
        let cursor = "";
        let hoveredPos: string | null = null;
        for (const item of drawingsRef.current) {
          if (positionSide(item) === null || item.locked) continue;
          const handles = positionHandles(item, viewport);
          for (let index = 0; index < handles.length; index += 1) {
            const handle = handles[index];
            if (Math.hypot(handle.x - pos.x, handle.y - pos.y) <= 13) {
              next = { id: item.id, index };
              hoveredPos = item.id;
              cursor =
                handle.role === "target" || handle.role === "stop"
                  ? "ns-resize"
                  : handle.role === "width"
                    ? "ew-resize"
                    : "grab";
              break;
            }
          }
          if (next) break;
        }
        if (!next) {
          const hit = hitTest(drawingsRef.current, viewport, pos.x, pos.y, 6, useDrawings.getState().selectedId);
          next = hit && hit.part === "point" ? { id: hit.drawing.id, index: hit.index } : null;
          cursor = hit ? (hit.part === "point" ? "grab" : "move") : "";
          if (hit && positionSide(hit.drawing) !== null) hoveredPos = hit.drawing.id;
        }
        setHoverHandle((prev) => {
          if (!prev && !next) return prev;
          if (prev && next && prev.id === next.id && prev.index === next.index) return prev;
          return next;
        });
        setHoverPosId((prev) => (prev === hoveredPos ? prev : hoveredPos));
        host.style.cursor = cursor;
        return;
      }
      event.preventDefault();
      const pos = localPoint(event);
      const priceValue = priceAt(pos.y);
      if (priceValue === null) return;
      const logical = logicalAt(pos.x);
      const dLogical = logical - drag.startLogical;
      const step = tfSecRef.current || 60;
      const dTime = Math.round(dLogical * step);
      const dPrice = priceValue - drag.startPrice;
      const moving = drag;

      // Long/Short: har bir tutqich o'z ishini qiladi (TradingView kabi).
      if (moving.part === "position" && moving.role) {
        const drawing = useDrawings.getState().drawings.find((item) => item.id === moving.id);
        if (!drawing) return;
        const side = positionSide(drawing);
        const points = moving.orig.map((item) => ({ ...item }));
        const minDistance = Math.max(Math.pow(10, -digitsRef.current) * 3, points[0].price * 0.00002);
        if (moving.role === "target" || moving.role === "stop") {
          const dir = side === "short" ? -1 : 1;
          if (moving.role === "target") {
            points[1].price = dir > 0 ? Math.max(points[0].price + minDistance, priceValue) : Math.min(points[0].price - minDistance, priceValue);
          } else {
            points[2].price = dir > 0 ? Math.min(points[0].price - minDistance, priceValue) : Math.max(points[0].price + minDistance, priceValue);
          }
        } else if (moving.role === "entry") {
          for (const point of points) {
            // Vaqtni bar chegarasiga yaxlitlamaymiz — pozitsiya kursorni uzluksiz
            // kuzatadi (avval sakrab-sakrab siljirdi).
            point.time = Math.round(point.time + dLogical * step);
            point.price += dPrice;
          }
        } else {
          const maxTime = Math.max(points[0].time + step, Math.round(points[1].time + dLogical * step));
          points[1].time = maxTime;
          points[2].time = maxTime;
        }
        useDrawings.getState().update(moving.id, { points });
        return;
      }
      // Tutqich (nuqta) sudralganda faqat shu nuqta siljiydi — qolgan nuqtalar joyida qoladi.
      // Aks holda chizma butunlay ko'chib ketadi (uzun/qisqartirish imkoni bo'lmaydi).
      const points = moving.orig.map((item, index) => {
        if (moving.part === "point") {
          if (index !== moving.index) return item;
          // Shift bosilganda tutqich ham 45° chiziqlarga qulflanadi.
          if (event.shiftKey && angleLockTool(moving.type)) {
            const anchor = moving.orig[moving.index === 0 ? 1 : 0];
            const locked = anchor ? angleLockedPoint(anchor, pos.x, pos.y) : null;
            if (locked) return { time: Math.round(locked.time), price: locked.price };
          }
          // Vaqt uzluksiz (sekund aniqligida) — chiziq silliq siljiydi.
          return {
            time: Math.round(item.time + dLogical * step),
            price: priceValue,
          };
        }
        return { time: item.time + dTime, price: item.price + dPrice };
      });
      useDrawings.getState().update(moving.id, { points });
    };

    const flushMove = () => {
      moveFrame = 0;
      const event = pendingMove;
      pendingMove = null;
      if (event) handleMove(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (drag) event.preventDefault();
      pendingMove = event;
      if (!moveFrame) moveFrame = window.requestAnimationFrame(flushMove);
    };

    const onPointerUp = (event: PointerEvent) => {
      // Oxirgi harakatni ham qo'llaymiz (aks holda chizma bir kadr orqada qoladi).
      if (moveFrame) {
        window.cancelAnimationFrame(moveFrame);
        moveFrame = 0;
      }
      const pending = pendingMove;
      pendingMove = null;
      if (pending) handleMove(pending);
      if (drag) {
        drag = null;
        host.style.cursor = "";
        return;
      }
      if (brush) {
        const points = brush;
        brush = null;
        const store = useDrawings.getState();
        if (points && points.length >= 2) {
          const id = store.commit({ type: "brush", symbol: symbolRef.current, points });
          store.setDraft(null);
          store.setTool(null);
          if (id) store.select(id);
        } else {
          store.setDraft(null);
        }
        return;
      }
      if (downAt) {
        const pos = localPoint(event);
        const moved = Math.hypot(pos.x - downAt.x, pos.y - downAt.y);
        downAt = null;
        if (moved < 4) useDrawings.getState().select(null);
      }
    };

    const onDoubleClick = (event: MouseEvent) => {
      const store = useDrawings.getState();
      if (store.tool === "polyline" || store.tool === "brush") {
        event.preventDefault();
        finishMulti(store.tool);
        return;
      }
      const viewport = vpRef.current;
      if (!viewport) return;
      const pos = localPoint(event);
      const hit = hitTest(drawingsRef.current, viewport, pos.x, pos.y);
      if (hit && hit.drawing.type === "text") {
        const value = window.prompt("Matn:", hit.drawing.text || "Matn");
        if (value !== null) useDrawings.getState().update(hit.drawing.id, { text: value.trim() || "Matn" });
      }
    };

    const onContextMenu = (event: MouseEvent) => {
      const store = useDrawings.getState();
      if (store.tool || store.draft) {
        event.preventDefault();
        store.setDraft(null);
        store.setTool(null);
        setPreview(null);
        return;
      }
      if (store.selectedId) {
        event.preventDefault();
        store.select(null);
      }
    };

    host.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    host.addEventListener("dblclick", onDoubleClick, true);
    host.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      host.removeEventListener("dblclick", onDoubleClick, true);
      host.removeEventListener("contextmenu", onContextMenu, true);
      if (moveFrame) window.cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pendingMove = null;
    };
  }, [computeViewport, drawingTool, tool]);

  // Chizish/o'lchash rejimida chart sudralishini o'chirib turamiz (TradingView kabi).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const active = Boolean(drawingTool) || tool === "measure";
    try {
      chart.applyOptions({
        handleScroll: active
          ? { pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false }
          : { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      });
    } catch (err) {
      /* ignore */
    }
  }, [drawingTool, tool]);

  // Enter — ko'p nuqtali chizmani tugatish.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const store = useDrawings.getState();
      if (store.tool !== "polyline" && store.tool !== "brush") return;
      const points = store.draft || [];
      if (points.length < 2) return;
      event.preventDefault();
      const type = store.tool;
      const id = store.commit({ type, symbol: symbolRef.current, points });
      store.setDraft(null);
      store.setTool(null);
      if (id) store.select(id);
      setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // O'lchash asbobi tanlansa — chizma asbobini o'chiramiz.
  useEffect(() => {
    if (tool === "measure" && useDrawings.getState().tool) useDrawings.getState().setTool(null);
  }, [tool]);

  // Chizma asbobi tanlansa — eski o'lchovni tozalaymiz.
  useEffect(() => {
    if (!drawingTool) return;
    if (measureRef.current) {
      measureRef.current = null;
      measureDoneRef.current = false;
      setMeasure(null);
      setMeasureDone(false);
    }
  }, [drawingTool]);

  // Barcha chizmalar yashirilsa tanlov ham bekor bo'ladi.
  useEffect(() => {
    if (hiddenDrawings) useDrawings.getState().select(null);
  }, [hiddenDrawings]);

  // Symbol/timeframe almashganda vaqtinchalik chizmalarni tozalaymiz.
  useEffect(() => {
    useDrawings.getState().setTool(null);
    useDrawings.getState().select(null);
    setHoverPosId(null);
    setHoverHandle(null);
    hoverRef.current = null;
    measureRef.current = null;
    measureDoneRef.current = false;
    setMeasure(null);
    setMeasureDone(false);
    setPreview(null);
  }, [symbol, tf]);

  // infinite scroll: walk further into the past when the user drags to the left edge
  // (subscription yuqorida, chart setup ichida)

  useEffect(() => {
    magnetRef.current = magnetHeld;
  }, [magnetHeld]);

  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", track, true);
    return () => window.removeEventListener("pointermove", track, true);
  }, []);

  // TradingView'dagi kabi: Ctrl bosib turilganda crosshair OHLC (open/high/low/close)
  // qiymatlariga — ya'ni wick uchlariga ham — "magnit" kabi yopishadi. Qo'yib yuborilsa
  // crosshair yana erkin harakatlanadi.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.key !== "Control" || isTyping(event.target)) return;
      setMagnetHeld(true);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key !== "Control") return;
      setMagnetHeld(false);
    };
    const release = () => setMagnetHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  // ------------------------------------------------------------- chart settings
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let mode = CrosshairMode.Normal;
    if (tool === "crosshair" || magnetHeld) mode = CrosshairMode.MagnetOHLC;
    if (!settings.crosshair) mode = CrosshairMode.Hidden;
    try {
      chart.applyOptions({
        grid: {
          vertLines: { visible: settings.grid },
          horzLines: { visible: settings.grid },
        },
        crosshair: { mode },
      });
    } catch (err) {
      /* chart hali tayyor emas */
    }
    // Sichqoncha qimirlamasa ham Ctrl bosilishi/qo'yib yuborilishi bilan crosshair
    // darhol qayta hisoblanadi (TradingView kabi).
    const point = pointerRef.current;
    const host = hostRef.current;
    if (point && host) {
      const rect = host.getBoundingClientRect();
      const inside = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      if (inside) {
        const target = document.elementFromPoint(point.x, point.y);
        if (target && host.contains(target)) {
          target.dispatchEvent(
            new MouseEvent("mousemove", { bubbles: true, clientX: point.x, clientY: point.y })
          );
        }
      }
    }
  }, [settings, tool, magnetHeld]);

  // ---------------------------------------------------------------- data feed
  useEffect(() => {
    const chart = chartRef.current;
    const series = baseRef.current;
    if (!chart || !series || !data) return;
    if (useReplay.getState().active) return;
    const currentBars = data.bars;
    barMapRef.current = new Map(currentBars.map((bar) => [bar.time, bar]));
    const api = series as any;

    if (data.mode === "init") {
      series.priceScale().applyOptions({ autoScale: true });
      setPriceAuto(true);
      api.setData(seriesData(currentBars, chartType));
      document.documentElement.dataset.chartReady = "1";
      (window as any).__bars = currentBars;
      const size = currentBars.length;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, size - 160), to: size + 7 });
    } else if (data.mode === "bar" && currentBars.length) {
      (window as any).__bars = currentBars;
      try {
        api.update(seriesPoint(currentBars[currentBars.length - 1], chartType));
      } catch (err) {
        /* ignore out-of-order updates */
      }
    } else if (data.mode === "prepend") {
      const added = data.added || 0;
      const range = chart.timeScale().getVisibleLogicalRange();
      (window as any).__bars = currentBars;
      api.setData(seriesData(currentBars, chartType));
      if (range) {
        chart.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });
      }
    } else if (data.mode === "tail" && data.tail) {
      (window as any).__bars = currentBars;
      data.tail.forEach((bar) => {
        try {
          api.update(seriesPoint(bar, chartType));
        } catch (err) {
          /* ignore */
        }
      });
    }
    scheduleDraw();
  }, [data, chartType, scheduleDraw]);

  // ------------------------------------------------------------------ replay
  const replayRenderRef = useRef<{ tf: string; index: number; chartType: ChartType } | null>(null);
  const replayWasActive = useRef(false);

  useEffect(() => {
    const chart = chartRef.current;
    const series = baseRef.current;
    if (!chart || !series) return;
    const api = series as any;

    if (!replayActive) {
      if (!replayWasActive.current) return;
      replayWasActive.current = false;
      replayRenderRef.current = null;
      (window as any).__replay = { active: false };
      const live = useTerminal.getState().data ? useTerminal.getState().data!.bars : [];
      if (live.length) {
        api.setData(seriesData(live, chartType));
        series.priceScale().applyOptions({ autoScale: true });
        setPriceAuto(true);
        const size = live.length;
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, size - 160), to: size + 7 });
        chart.timeScale().scrollToRealTime();
      }
      scheduleDraw();
      return;
    }

    replayWasActive.current = true;
    const markReplay = () => {
      (window as any).__replay = {
        active: true,
        symbol: symbolRef.current,
        tf: replayTf,
        cursor: replayCursor,
        bars: viewBars.length,
        last: viewBars.length ? viewBars[viewBars.length - 1].close : null,
        loading: useReplay.getState().loading,
      };
    };
    markReplay();
    barMapRef.current = new Map(viewBars.map((bar) => [bar.time, bar]));
    if (!viewBars.length) {
      scheduleDraw();
      return;
    }

    const index = viewBars.length - 1;
    const prev = replayRenderRef.current;
    const same = !!prev && prev.tf === replayTf && prev.chartType === chartType;
    if (same && index === prev.index) {
      scheduleDraw();
      return;
    }
    if (same && index === prev.index + 1) {
      try {
        api.update(seriesPoint(viewBars[index], chartType));
      } catch (err) {
        api.setData(seriesData(viewBars, chartType));
      }
    } else {
      api.setData(seriesData(viewBars, chartType));
      series.priceScale().applyOptions({ autoScale: true });
      setPriceAuto(true);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, index - 160), to: index + 20 });
    }
    replayRenderRef.current = { tf: replayTf, index, chartType };
    markReplay();
    scheduleDraw();
  }, [replayActive, replayTf, replayCursor, viewBars, chartType, scheduleDraw]);

  // ----------------------------------------------------------------- indicators
  useEffect(() => {
    const chart = chartRef.current;
    const currentBars = viewBars;
    if (!chart || !currentBars.length) return;
    const full = replayActive || !data || data.mode !== "bar";

    const sync = (key: string, enabled: boolean, points: Point[], options: any) => {
      const map = overlaysRef.current;
      let series = map.get(key);
      if (!enabled || !points.length) {
        if (series) {
          try {
            chart.removeSeries(series as any);
          } catch (err) {
            /* ignore */
          }
          map.delete(key);
        }
        return;
      }
      if (!series) {
        series = chart.addSeries(LineSeries, options);
        map.set(key, series);
        series.setData(points);
        return;
      }
      if (full) series.setData(points);
      else {
        try {
          series.update(points[points.length - 1]);
        } catch (err) {
          series.setData(points);
        }
      }
    };

    sync("ema20", indicators.ema20, ema(currentBars, 20), {
      color: "#f0b90b", lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    sync("ema50", indicators.ema50, ema(currentBars, 50), {
      color: "#4dd0e1", lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    sync("sma200", indicators.sma200, sma(currentBars, 200), {
      color: "#e06666", lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    const bb = bollinger(currentBars, 20, 2);
    sync("bbUpper", indicators.bb, bb.upper, {
      color: "#7e57c2", lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: LineStyle.Dashed,
    });
    sync("bbMid", indicators.bb, bb.mid, {
      color: "#5c6bc0", lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    sync("bbLower", indicators.bb, bb.lower, {
      color: "#7e57c2", lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: LineStyle.Dashed,
    });
    (window as any).__overlays = overlaysRef.current.size;
    scheduleDraw();
  }, [viewBars, indicators, chartType, scheduleDraw, replayActive, data]);

  // -------------------------------------------------------------- range / view
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !viewRequest) return;
    try {
      chart.timeScale().setVisibleLogicalRange({ from: viewRequest.from, to: viewRequest.to });
    } catch (err) {
      /* ignore */
    }
    scheduleDraw();
  }, [viewRequest, scheduleDraw]);

  // ---------------------------------------------------------- chart commands
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartCmd) return;
    const timeScale = chart.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (chartCmd.kind === "realtime") {
      timeScale.scrollToRealTime();
      return;
    }
    if (!range) return;
    const width = range.to - range.from;
    if (chartCmd.kind === "panLeft") {
      timeScale.setVisibleLogicalRange({ from: range.from - width * 0.75, to: range.to - width * 0.75 });
    } else if (chartCmd.kind === "panRight") {
      timeScale.setVisibleLogicalRange({ from: range.from + width * 0.75, to: range.to + width * 0.75 });
    } else if (chartCmd.kind === "zoomIn" || chartCmd.kind === "zoomOut") {
      const factor = chartCmd.kind === "zoomIn" ? 0.75 : 1.3;
      const center = (range.from + range.to) / 2;
      const half = (width * factor) / 2;
      timeScale.setVisibleLogicalRange({ from: Math.max(0, center - half), to: center + half });
    } else if (chartCmd.kind === "resetPrice") {
      const series = baseRef.current;
      if (series) {
        series.priceScale().applyOptions({ autoScale: true });
        setPriceAuto(true);
      }
    }
  }, [chartCmd]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const store = useDrawings.getState();
      if (store.draft) store.setDraft(null);
      if (store.tool) store.setTool(null);
      if (measureRef.current) {
        measureRef.current = null;
        measureDoneRef.current = false;
        setMeasure(null);
        setMeasureDone(false);
      }
      if (useTerminal.getState().tool === "measure") useTerminal.getState().setTool("cursor");
      setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------------------------------------------------------------- price tag
  useEffect(() => {
    const series = baseRef.current;
    if (!series || price === null) {
      setPillTop(null);
      return;
    }
    const y = series.priceToCoordinate(price);
    setPillTop(y === null || y === undefined ? null : Math.round(y));
  }, [price, data]);

  // --------------------------------------------------------------- render data
  const viewport = vpRef.current;
  const visibleDrawings = useMemo(
    () => drawings.filter((item) => item.symbol === symbol && !hiddenDrawings),
    [drawings, symbol, hiddenDrawings]
  );

  /** Long/Short tool uchun pip/%/R/R/lot/$ yorliqlari. */
  const positionInfoFor = useCallback(
    (drawing: Drawing): PositionInfo | null =>
      positionSide(drawing) === null ? null : computePositionInfo(drawing, { price, lots: toolLots, digits }),
    [price, toolLots, digits]
  );

  /** Chizmalarning ekran shakllari — ortiqcha render'larda qayta hisoblanmaydi. */
  const shapes = useMemo(
    () =>
      viewport
        ? visibleDrawings.map((item) => {
            // Long/Short yorliqlari faqat tanlangan yoki hover qilingan pozitsiyada ko'rinadi
            // va faqat shu holatda hisoblanadi (pip/%/R/R/lot/$).
            const showLabels = selectedId === item.id || hoverPosId === item.id;
            return {
              drawing: item,
              shape: resolveDrawing(item, viewport, showLabels ? positionInfoFor(item) : null, showLabels),
            };
          })
        : [],
    [viewport, vpVersion, visibleDrawings, selectedId, hoverPosId, positionInfoFor]
  );

  const draftDrawing = useMemo((): Drawing | null => {
    const activeViewport = vpRef.current;
    if (!activeViewport || !drawingTool || !draft || !draft.length) return null;
    const points = preview && drawingTool !== "brush" ? draft.concat(preview) : draft;
    return {
      id: "__draft",
      type: drawingTool,
      symbol,
      points,
      color: drawingDefaults.color,
      width: drawingDefaults.width,
      style: drawingDefaults.style === "solid" ? "dashed" : drawingDefaults.style,
      fill: drawingDefaults.fill,
      text: "",
      fontSize: drawingDefaults.fontSize,
      locked: false,
      createdAt: 0,
    };
  }, [draft, preview, drawingTool, symbol, drawingDefaults]);

  const draftShape = draftDrawing && viewport ? resolveDrawing(draftDrawing, viewport) : null;

  const measureView = useMemo(() => {
    const activeViewport = vpRef.current;
    if (!activeViewport || !measure) return null;
    const a = { x: activeViewport.timeToX(measure.a.time), y: activeViewport.priceToY(measure.a.price) };
    const b = measure.b
      ? { x: activeViewport.timeToX(measure.b.time), y: activeViewport.priceToY(measure.b.price) }
      : a;
    const stats = measure.b ? measureStats(measure.a, measure.b, bars, tfSecRef.current || 60, point) : null;
    return { a, b, stats };
  }, [measure, vpVersion, bars, point]);

  const shown = hover || lastBar;
  const dir = barDirection(shown);
  const change = shown ? ((shown.close - shown.open) / shown.open) * 100 : 0;

  const remaining = seconds - (clockTs % seconds);
  const countdown = pad2(Math.floor(remaining / 60)) + ":" + pad2(remaining % 60);

  const digitsFmt = (value: number | undefined) => (value === undefined ? "-" : fmtPrice(value, digits));

  const axisW = chartRef.current ? chartRef.current.priceScale("right").width() : 0;
  const tsH = chartRef.current ? chartRef.current.timeScale().height() : 30;
  const hostWidth = hostRef.current ? hostRef.current.getBoundingClientRect().width : 0;

  const measureBadge = (() => {
    if (!measureView || !measureView.stats || !hostWidth) return null;
    const { a, b, stats } = measureView;
    const flip = b.x + 210 > hostWidth;
    const left = flip ? Math.max(6, b.x - 206) : Math.min(hostWidth - 190, b.x + 14);
    const top = Math.max(8, Math.min(a.y, b.y) + Math.abs(b.y - a.y) / 2 - 28);
    return { left, top, stats, a, b };
  })();

  function renderPrim(prim: Prim, drawing: Drawing, index: number, rectIndex: number) {
    const dash = dashFor(drawing.style);
    if (prim.kind === "line") {
      return (
        <line
          key={index}
          className="draw-line"
          x1={prim.x1}
          y1={prim.y1}
          x2={prim.x2}
          y2={prim.y2}
          stroke={drawing.color}
          strokeWidth={drawing.width}
          strokeDasharray={dash}
        />
      );
    }
    if (prim.kind === "rect") {
      let fill = drawing.fill ? hexAlpha(drawing.color, 0.14) : "none";
      if (drawing.type === "long" || drawing.type === "short") {
        fill = rectIndex === 0 ? "rgba(38,166,154,0.18)" : "rgba(239,83,80,0.18)";
      }
      return (
        <rect
          key={index}
          className="draw-rect"
          x={prim.x}
          y={prim.y}
          width={Math.max(0, prim.w)}
          height={Math.max(0, prim.h)}
          fill={fill}
          stroke={drawing.color}
          strokeWidth={drawing.width}
          strokeDasharray={dash}
        />
      );
    }
    if (prim.kind === "poly") {
      return (
        <polygon
          key={index}
          className="draw-poly"
          points={prim.points.map((item) => item.x + "," + item.y).join(" ")}
          fill={hexAlpha(drawing.color, 0.12)}
          stroke="none"
        />
      );
    }
    if (prim.kind === "pill") {
      return (
        <g key={index} className="draw-pill">
          <rect className="draw-pill-bg" x={prim.x} y={prim.y} width={prim.w} height={prim.h} rx={3} fill={prim.bg} />
          <text className="draw-pill-text" x={prim.x + 6} y={prim.y + prim.h / 2} dominantBaseline="middle" fill={prim.color}>
            {prim.text}
          </text>
        </g>
      );
    }
    return (
      <text
        key={index}
        className={drawing.type === "text" ? "draw-text-label" : "draw-label"}
        fontSize={drawing.type === "text" ? drawing.fontSize : 10}
        x={prim.x}
        y={prim.y}
        textAnchor={prim.anchor}
        dominantBaseline={prim.baseline === "middle" ? "middle" : prim.baseline === "bottom" ? "auto" : "hanging"}
      >
        {prim.text}
      </text>
    );
  }

  const drawingActive = Boolean(drawingTool) || tool === "measure";

  return (
    <div className="chart-panel">
      <div className={drawingActive ? (tool === "measure" ? "chart-host measuring" : "chart-host drawing") : "chart-host"} ref={hostRef} />

      <svg
        className="draw-layer"
        style={{ clipPath: "inset(0 " + Math.max(0, axisW) + "px " + Math.max(0, tsH) + "px 0)" }}
      >
        {shapes.map(({ drawing, shape }) => {
          let rectCount = 0;
          return (
            <g
              key={drawing.id}
              className={selectedId === drawing.id ? "draw-item selected" : "draw-item"}
              data-id={drawing.id}
              data-type={drawing.type}
            >
              {shape.prims.map((prim, index) => {
                const rectIndex = prim.kind === "rect" ? rectCount : -1;
                if (prim.kind === "rect") rectCount += 1;
                return renderPrim(prim, drawing, index, rectIndex);
              })}
              {selectedId === drawing.id && !drawing.locked && viewport
                ? positionSide(drawing) !== null
                  ? positionHandles(drawing, viewport).map((handle, index) => {
                      const active = hoverHandle && hoverHandle.id === drawing.id && hoverHandle.index === index;
                      if (handle.role === "target" || handle.role === "stop") {
                        return (
                          <rect
                            key={"ph" + index}
                            data-role={handle.role}
                            className={active ? "draw-handle sq active" : "draw-handle sq"}
                            x={handle.x - 4}
                            y={handle.y - 4}
                            width={8}
                            height={8}
                            rx={1.5}
                          />
                        );
                      }
                      return (
                        <circle
                          key={"ph" + index}
                          data-role={handle.role}
                          className={active ? "draw-handle active" : "draw-handle"}
                          cx={handle.x}
                          cy={handle.y}
                          r={4}
                        />
                      );
                    })
                  : shape.points.slice(0, 12).map((item: XY, index: number) => (
                      <circle
                        key={"h" + index}
                        className={hoverHandle && hoverHandle.id === drawing.id && hoverHandle.index === index ? "draw-handle active" : "draw-handle"}
                        cx={item.x}
                        cy={item.y}
                        r={4}
                      />
                    ))
                : null}
            </g>
          );
        })}

        {draftShape && draftDrawing ? (
          <g className="draw-item draft">
            {draftShape.prims.map((prim, index) => renderPrim(prim, draftDrawing, index, 0))}
            {draftShape.points.map((item, index) => (
              <circle key={"d" + index} className="draw-handle" cx={item.x} cy={item.y} r={3.5} />
            ))}
          </g>
        ) : null}

        {measureView ? (
          <g className="measure-group">
            <line className="measure-line" x1={measureView.a.x} y1={measureView.a.y} x2={measureView.b.x} y2={measureView.b.y} />
            <line className="measure-guide" x1={measureView.a.x} y1={measureView.a.y} x2={measureView.b.x} y2={measureView.a.y} />
            <line className="measure-guide" x1={measureView.b.x} y1={measureView.a.y} x2={measureView.b.x} y2={measureView.b.y} />
            <circle className="measure-dot" cx={measureView.a.x} cy={measureView.a.y} r={3} />
            <circle className="measure-dot" cx={measureView.b.x} cy={measureView.b.y} r={3} />
          </g>
        ) : null}
      </svg>

      <div className="chart-overlay">
        <div className="chart-title-row">
          <span className="chart-title">{name}</span>
          <span className="chart-dot">·</span>
          <span className="chart-title-small">{tf}</span>
          <span className="chart-dot">·</span>
          <span className="chart-title-small">EXNESS</span>
          <span className={status && status.live ? "market-open" : "market-closed"}>
            <span className={status && status.live ? "dot live" : "dot"} />
            {status && status.live ? "Open" : "Closed"}
          </span>
          {replayActive ? (
            <span className="chart-replay-tag" title="Bar replay faol — narx kursor vaqtidan">
              REPLAY
            </span>
          ) : null}
        </div>

        <div className="chart-quote-row">
          <div className="ticket">
            <button className="ticket-btn sell" type="button" onClick={() => openTrade("sell")}>
              <span className="ticket-price">{digitsFmt(bidValue)}</span>
              <span className="ticket-label">SELL</span>
            </button>
            <div className="ticket-lot">
              <span className="lot-label">lot</span>
              <span className="lot-value">{toolLots.toFixed(2)}</span>
            </div>
            <button className="ticket-btn buy" type="button" onClick={() => openTrade("buy")}>
              <span className="ticket-price">{digitsFmt(askValue)}</span>
              <span className="ticket-label">BUY</span>
            </button>
          </div>

          <div className="legend">
            <span className="legend-ohlc">
              <span className="lbl">O</span>
              <span className={dir === "up" ? "val up" : dir === "down" ? "val down" : "val"}>{digitsFmt(shown ? shown.open : undefined)}</span>
              <span className="lbl">H</span>
              <span className={dir === "up" ? "val up" : dir === "down" ? "val down" : "val"}>{digitsFmt(shown ? shown.high : undefined)}</span>
              <span className="lbl">L</span>
              <span className={dir === "up" ? "val up" : dir === "down" ? "val down" : "val"}>{digitsFmt(shown ? shown.low : undefined)}</span>
              <span className="lbl">C</span>
              <span className={dir === "up" ? "val up" : dir === "down" ? "val down" : "val"}>{digitsFmt(shown ? shown.close : undefined)}</span>
              <span className={dir === "up" ? "val up" : dir === "down" ? "val down" : "val"}>{fmtChangePct(change)}</span>
            </span>
          </div>
        </div>

        <div className="watermark">
          <span className="watermark-sym">{symbol}</span>
          <span className="watermark-tf">{tf}</span>
        </div>

        {priceAuto ? null : (
          <button
            className="auto-chip"
            type="button"
            title="Narx shkalasini avtomatik rejimga qaytarish"
            onClick={() => {
              const series = baseRef.current;
              if (!series) return;
              series.priceScale().applyOptions({ autoScale: true });
              setPriceAuto(true);
            }}
          >
            <span className="auto-chip-icon">&#8617;</span>
            <span className="auto-chip-text">auto</span>
          </button>
        )}

        {atLive || replayActive ? null : (
          <button
            className="jump-live"
            type="button"
            title="Go to realtime"
            onClick={() => {
              const chart = chartRef.current;
              if (!chart) return;
              chart.timeScale().scrollToRealTime();
            }}
          >
            <span className="jump-live-arrow">&#9654;</span>
            <span className="jump-live-text">LIVE</span>
          </button>
        )}

        {price !== null && pillTop !== null ? (
          <div className="last-price-tag" style={{ top: pillTop }}>
            <span className="last-price-value">{fmtPrice(price, digits)}</span>
            {settings.countdown && !replayActive ? <span className="last-price-countdown">{countdown}</span> : null}
          </div>
        ) : null}
      </div>

      {drawingTool ? <div className="measure-hint">{drawToolDef(drawingTool).label + " — " + drawToolDef(drawingTool).hint}</div> : null}
      {tool === "measure" && !measure ? <div className="measure-hint">O'lchash: birinchi nuqtani bosing, keyin ikkinchisini. Esc — bekor qilish.</div> : null}

      {measureBadge ? (
        <div className="measure-badge" style={{ left: measureBadge.left, top: measureBadge.top }}>
          <div className="measure-badge-row">
            <span className={measureBadge.stats.up ? "val up" : "val down"}>
              {measureBadge.stats.up ? "+" : ""}
              {measureBadge.stats.deltaPrice.toFixed(digits)}
            </span>
            <span className={measureBadge.stats.up ? "val up" : "val down"}>
              ({measureBadge.stats.up ? "+" : "-"}
              {measureBadge.stats.pips.toFixed(1)} pip)
            </span>
          </div>
          <div className="measure-badge-row">
            <span className={measureBadge.stats.up ? "val up" : "val down"}>
              {measureBadge.stats.up ? "+" : ""}
              {measureBadge.stats.pct.toFixed(2)}%
            </span>
            <span className="muted">{measureBadge.stats.bars} sham</span>
          </div>
          <div className="measure-badge-row muted">
            <span>{fmtDuration(measureBadge.stats.seconds)}</span>
            <span>
              {measureBadge.stats.from.toFixed(digits)} → {measureBadge.stats.to.toFixed(digits)}
            </span>
          </div>
        </div>
      ) : null}

      <DrawToolbar />
      <DrawingSettings />
    </div>
  );
}
