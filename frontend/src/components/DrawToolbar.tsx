import { useEffect, useRef, useState } from "react";
import { Eraser, Eye, EyeOff, GripVertical } from "lucide-react";
import { DRAW_TOOLS, useDrawings, type DrawTool } from "../lib/drawings";
import { useTerminal } from "../store";

const POS_KEY = "fx.drawwin.v1";

type Pos = { x: number; y: number };

function loadPos(): Pos {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
      const x = Number(parsed.x);
      const y = Number(parsed.y);
      if (isFinite(x) && isFinite(y)) return { x, y };
    }
  } catch (err) {
    /* localStorage yo'q */
  }
  return { x: 10, y: 68 };
}

function savePos(pos: Pos): void {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch (err) {
    /* ignore */
  }
}

/** 12 ta chizma asbobi uchun nozik chiziqli (TradingView uslubidagi) ikonkalar. */
function ToolIcon({ id }: { id: DrawTool }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 18 18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "trendline":
      return (
        <svg {...common}>
          <circle cx="3.5" cy="14.5" r="1.4" />
          <circle cx="14.5" cy="3.5" r="1.4" />
          <line x1="4.6" y1="13.4" x2="13.4" y2="4.6" />
        </svg>
      );
    case "ray":
      return (
        <svg {...common}>
          <circle cx="3" cy="9" r="1.4" />
          <line x1="4.4" y1="9" x2="14" y2="9" />
          <path d="M12 6.5 L15 9 L12 11.5" />
        </svg>
      );
    case "hline":
      return (
        <svg {...common}>
          <line x1="2" y1="9" x2="16" y2="9" />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "vline":
      return (
        <svg {...common}>
          <line x1="9" y1="2" x2="9" y2="16" />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "channel":
      return (
        <svg {...common}>
          <line x1="2.5" y1="13.5" x2="12" y2="4" />
          <line x1="6" y1="16" x2="15.5" y2="6.5" />
        </svg>
      );
    case "rect":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="12" height="9" rx="0.6" />
          <circle cx="3" cy="4.5" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <line x1="3" y1="15" x2="14" y2="4" />
          <path d="M9 3.6 L14.4 3.6 L14.4 9" />
        </svg>
      );
    case "brush":
      return (
        <svg {...common}>
          <path d="M3 14.5 C5.5 8 8 8 9.5 11 C11 14 13 12.5 15 6.5" />
          <circle cx="3" cy="14.5" r="1.2" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          <path d="M4 3.5 H14" />
          <line x1="9" y1="3.5" x2="9" y2="14.5" />
          <line x1="6.5" y1="14.5" x2="11.5" y2="14.5" />
        </svg>
      );
    case "long":
      return (
        <svg {...common}>
          <path d="M9 15 V5" />
          <path d="M4.8 9 L9 4.6 L13.2 9" />
          <line x1="6" y1="15" x2="12" y2="15" />
        </svg>
      );
    case "short":
      return (
        <svg {...common}>
          <path d="M9 3 V13" />
          <path d="M4.8 9 L9 13.4 L13.2 9" />
          <line x1="6" y1="3" x2="12" y2="3" />
        </svg>
      );
    case "polyline":
      return (
        <svg {...common}>
          <path d="M3 13 L7 6 L11 11 L15 4.5" />
          <circle cx="3" cy="13" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

export default function DrawToolbar() {
  const tool = useDrawings((s) => s.tool);
  const hidden = useDrawings((s) => s.hidden);
  const hasDrawings = useDrawings((s) => s.drawings.length > 0);
  const [pos, setPos] = useState<Pos>(() => loadPos());
  const posRef = useRef(pos);
  posRef.current = pos;

  const selectTool = (id: DrawTool) => {
    const drawings = useDrawings.getState();
    const terminal = useTerminal.getState();
    // O'lchash rejimini o'chirib, oddiy kursorga qaytamiz — chizish paytida chart surilmaydi.
    terminal.setTool("cursor");
    drawings.setTool(drawings.tool === id ? null : id);
  };

  const toggleHidden = () => {
    const state = useDrawings.getState();
    state.setHidden(!state.hidden);
  };

  const clearDrawings = () => {
    const state = useDrawings.getState();
    const terminal = useTerminal.getState();
    const symbol = terminal.symbol;
    const count = state.drawings.filter((item) => item.symbol === symbol).length;
    if (!count) {
      terminal.pushToast("Bu instrumentda chizmalar yo'q");
      return;
    }
    state.clearSymbol(symbol);
    terminal.pushToast(count + " ta chizma o'chirildi");
  };

  const onGripDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = (event.currentTarget.closest(".chart-panel") || document.body) as HTMLElement;
    const board = document.querySelector(".draw-toolbar") as HTMLElement | null;
    const panelRect = panel.getBoundingClientRect();
    const selfRect = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...posRef.current };
    const maxX = Math.max(0, panelRect.width - selfRect.width - 4);
    const maxY = Math.max(0, panelRect.height - 44);
    const onMove = (moveEvent: PointerEvent) => {
      const next = {
        x: Math.min(maxX, Math.max(0, origin.x + moveEvent.clientX - startX)),
        y: Math.min(maxY, Math.max(0, origin.y + moveEvent.clientY - startY)),
      };
      setPos(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      savePos(posRef.current);
      if (board) board.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (event.key === "Escape") {
        useDrawings.getState().setTool(null);
        return;
      }
      const found = DRAW_TOOLS.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
      if (!found) return;
      event.preventDefault();
      const drawings = useDrawings.getState();
      useTerminal.getState().setTool("cursor");
      drawings.setTool(drawings.tool === found.id ? null : found.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="draw-toolbar"
      data-testid="draw-toolbar"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="draw-toolbar-grip" title="Panelni sudrab ko'chirish" onPointerDown={onGripDown}>
        <GripVertical size={14} />
      </div>
      <div className="draw-toolbar-items">
        {DRAW_TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tool === item.id ? "draw-tool-btn active" : "draw-tool-btn"}
            data-tool={item.id}
            title={item.label + " — " + item.hint + " (" + item.key + ")"}
            aria-label={item.label}
            onClick={() => selectTool(item.id)}
          >
            <ToolIcon id={item.id} />
          </button>
        ))}
        <span className="draw-sep" />
        <button
          type="button"
          className={hidden ? "draw-tool-btn active" : "draw-tool-btn"}
          data-action="hide"
          title={hidden ? "Chizmalarni ko'rsatish" : "Chizmalarni yashirish"}
          aria-label="Chizmalarni yashirish"
          disabled={!hasDrawings}
          onClick={toggleHidden}
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          className="draw-tool-btn"
          data-action="clear"
          title="Instrumentdagi barcha chizmalarni o'chirish"
          aria-label="Chizmalarni tozalash"
          disabled={!hasDrawings}
          onClick={clearDrawings}
        >
          <Eraser size={16} />
        </button>
      </div>
    </div>
  );
}
