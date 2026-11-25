import { useTerminal, type ChartSettings, type ChartType, type IndicatorKey } from "../store";

const KEY = "fx.layout.v1";

type Layout = {
  symbol: string;
  tf: string;
  chartType: ChartType;
  indicators: Record<IndicatorKey, boolean>;
  settings: ChartSettings;
};

export function saveLayout(): void {
  try {
    const state = useTerminal.getState();
    const layout: Layout = {
      symbol: state.symbol,
      tf: state.tf,
      chartType: state.chartType,
      indicators: state.indicators,
      settings: state.settings,
    };
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch (err) {
    /* storage disabled */
  }
}

export function loadLayout(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (err) {
    return;
  }
  if (!raw) return;
  try {
    const layout = JSON.parse(raw) as Partial<Layout>;
    const state = useTerminal.getState();
    if (typeof layout.chartType === "string" && ["candles", "bars", "line", "area"].includes(layout.chartType)) {
      state.setChartType(layout.chartType);
    }
    if (layout.indicators && typeof layout.indicators === "object") {
      (Object.keys(layout.indicators) as IndicatorKey[]).forEach((key) => {
        if (typeof layout.indicators![key] === "boolean" && layout.indicators![key] !== state.indicators[key]) {
          state.toggleIndicator(key);
        }
      });
    }
    if (layout.settings && typeof layout.settings === "object") {
      (["grid", "crosshair", "countdown"] as (keyof ChartSettings)[]).forEach((key) => {
        if (typeof layout.settings![key] === "boolean") state.setSetting(key, layout.settings![key]);
      });
    }
    if (typeof layout.tf === "string") state.setTf(layout.tf);
    if (typeof layout.symbol === "string") state.setSymbol(layout.symbol);
  } catch (err) {
    /* ignore corrupt layout */
  }
}
