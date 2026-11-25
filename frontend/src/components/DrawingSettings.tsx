import { useEffect, useRef, useState } from "react";
import {
  AlarmClockPlus,
  Check,
  ChevronDown,
  Copy,
  GripVertical,
  Lock,
  MoreHorizontal,
  Settings2,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";
import {
  COLOR_SWATCHES,
  LINE_WIDTHS,
  TEXT_SIZES,
  alertForDrawing,
  drawToolDef,
  useDrawings,
  type DrawStyle,
} from "../lib/drawings";
import { useTerminal } from "../store";

type MenuKind = "width" | "color" | "settings" | "more" | null;

const STYLES: { id: DrawStyle; label: string; dash: string }[] = [
  { id: "solid", label: "Tekis", dash: "" },
  { id: "dashed", label: "Shtrix", dash: "5 3" },
  { id: "dotted", label: "Nuqtali", dash: "1 3" },
];

export default function DrawingSettings() {
  const drawing = useDrawings((state) => (state.selectedId ? state.drawings.find((item) => item.id === state.selectedId) || null : null));
  const [menu, setMenu] = useState<MenuKind>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu]);

  useEffect(() => {
    setMenu(null);
  }, [drawing ? drawing.id : ""]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing) return;
      const state = useDrawings.getState();
      const current = state.selectedId ? state.drawings.find((item) => item.id === state.selectedId) : null;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && current) {
        event.preventDefault();
        state.duplicate(current.id);
        return;
      }
      if (!current) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.remove(current.id);
        return;
      }
      if (event.key === "Escape") {
        state.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!drawing) return null;

  const locked = drawing.locked;
  const supportsFill = drawing.type === "rect" || drawing.type === "channel" || drawing.type === "long" || drawing.type === "short";
  const isText = drawing.type === "text";

  const setColor = (color: string) => {
    useDrawings.getState().update(drawing.id, { color });
    useDrawings.getState().setDefaults({ color });
    setMenu(null);
  };

  const setWidth = (width: number) => {
    useDrawings.getState().update(drawing.id, { width });
    useDrawings.getState().setDefaults({ width });
    setMenu(null);
  };

  const setStyle = (style: DrawStyle) => {
    useDrawings.getState().update(drawing.id, { style });
    useDrawings.getState().setDefaults({ style });
  };

  const editText = () => {
    if (!isText) return;
    const value = window.prompt("Matn:", drawing.text || "Matn");
    if (value === null) return;
    useDrawings.getState().update(drawing.id, { text: value.trim() || "Matn" });
  };

  const makeAlert = () => {
    const message = alertForDrawing(drawing);
    useTerminal.getState().pushToast(message);
    setMenu(null);
  };

  const saveDefaults = () => {
    useDrawings.getState().setDefaults({
      color: drawing.color,
      width: drawing.width,
      style: drawing.style,
      fill: drawing.fill,
      fontSize: drawing.fontSize,
    });
    useTerminal.getState().pushToast("Chizma standart sozlamalari saqlandi");
    setMenu(null);
  };

  return (
    <div
      className="draw-settings"
      data-testid="draw-settings"
      ref={rootRef}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="dsettings-grip" title="Tanlangan chizma">
        <GripVertical size={14} />
      </div>
      <span className="dsettings-type">{drawToolDef(drawing.type).label}</span>
      <span className="dsettings-divider" />

      <button type="button" className="dsettings-btn" data-action="duplicate" title="Nusxa olish (Ctrl+D)" aria-label="Nusxa olish" onClick={() => useDrawings.getState().duplicate(drawing.id)}>
        <Copy size={16} />
      </button>

      {isText ? (
        <button type="button" className="dsettings-btn" data-action="text" title="Matnni tahrirlash" aria-label="Matn" onClick={editText}>
          <Type size={16} />
        </button>
      ) : null}

      <div className="dsettings-anchor">
        <button
          type="button"
          className={menu === "width" ? "dsettings-btn wide active" : "dsettings-btn wide"}
          data-action="width"
          title="Chiziq qalinligi"
          aria-label="Chiziq qalinligi"
          onClick={() => setMenu(menu === "width" ? null : "width")}
        >
          <span className="dsettings-width-preview" style={{ height: drawing.width }} />
          <span className="dsettings-width-label">{drawing.width}px</span>
          <ChevronDown size={12} />
        </button>
        {menu === "width" ? (
          <div className="dsettings-menu" role="menu">
            {LINE_WIDTHS.map((width) => (
              <button
                key={width}
                type="button"
                className={drawing.width === width ? "dsettings-item active" : "dsettings-item"}
                data-width={width}
                onClick={() => setWidth(width)}
              >
                <span className="dsettings-width-preview" style={{ height: width }} />
                <span>{width}px</span>
                {drawing.width === width ? <Check size={12} className="dsettings-check" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="dsettings-anchor">
        <button
          type="button"
          className={menu === "color" ? "dsettings-btn active" : "dsettings-btn"}
          data-action="color"
          title="Rang"
          aria-label="Rang"
          onClick={() => setMenu(menu === "color" ? null : "color")}
        >
          <span className="dsettings-color" style={{ background: drawing.color }} />
        </button>
        {menu === "color" ? (
          <div className="dsettings-swatches">
            {COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className={drawing.color === color ? "dsettings-swatch active" : "dsettings-swatch"}
                data-color={color}
                title={color}
                aria-label={color}
                style={{ background: color }}
                onClick={() => setColor(color)}
              >
                {drawing.color === color ? <Check size={12} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="dsettings-anchor">
        <button
          type="button"
          className={menu === "settings" ? "dsettings-btn active" : "dsettings-btn"}
          data-action="settings"
          title="Sozlamalar"
          aria-label="Sozlamalar"
          onClick={() => setMenu(menu === "settings" ? null : "settings")}
        >
          <Settings2 size={16} />
        </button>
        {menu === "settings" ? (
          <div className="dsettings-panel">
            <div className="dsettings-row-title">Chiziq uslubi</div>
            <div className="dsettings-styles">
              {STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={drawing.style === item.id ? "dsettings-style active" : "dsettings-style"}
                  data-style={item.id}
                  title={item.label}
                  onClick={() => setStyle(item.id)}
                >
                  <svg width="30" height="10" viewBox="0 0 30 10">
                    <line x1="1" y1="5" x2="29" y2="5" stroke="currentColor" strokeWidth={Math.max(1, drawing.width)} strokeDasharray={item.dash || undefined} strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>

            {supportsFill ? (
              <label className="dsettings-check-row">
                <input
                  type="checkbox"
                  checked={drawing.fill}
                  onChange={(event) => useDrawings.getState().update(drawing.id, { fill: event.target.checked })}
                />
                <span>To'ldirish</span>
              </label>
            ) : null}

            {isText ? (
              <>
                <div className="dsettings-row-title">Matn o'lchami</div>
                <div className="dsettings-sizes">
                  {TEXT_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={drawing.fontSize === size ? "dsettings-size active" : "dsettings-size"}
                      data-size={size}
                      onClick={() => useDrawings.getState().update(drawing.id, { fontSize: size })}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <button type="button" className="dsettings-save" onClick={saveDefaults}>
              Standart sifatida saqlash
            </button>
          </div>
        ) : null}
      </div>

      <button type="button" className="dsettings-btn" data-action="alert" title="Shu narxga alert qo'shish" aria-label="Alert" onClick={makeAlert}>
        <AlarmClockPlus size={16} />
      </button>

      <button
        type="button"
        className={locked ? "dsettings-btn active" : "dsettings-btn"}
        data-action="lock"
        title={locked ? "Qulfni ochish" : "Qulflash"}
        aria-label={locked ? "Qulfni ochish" : "Qulflash"}
        onClick={() => useDrawings.getState().toggleLock(drawing.id)}
      >
        {locked ? <Lock size={16} /> : <Unlock size={16} />}
      </button>

      <button type="button" className="dsettings-btn danger" data-action="delete" title="O'chirish (Delete)" aria-label="O'chirish" onClick={() => useDrawings.getState().remove(drawing.id)}>
        <Trash2 size={16} />
      </button>

      <div className="dsettings-anchor">
        <button
          type="button"
          className={menu === "more" ? "dsettings-btn active" : "dsettings-btn"}
          data-action="more"
          title="Boshqa amallar"
          aria-label="Boshqa amallar"
          onClick={() => setMenu(menu === "more" ? null : "more")}
        >
          <MoreHorizontal size={16} />
        </button>
        {menu === "more" ? (
          <div className="dsettings-menu right" role="menu">
            <button type="button" className="dsettings-item" onClick={() => { useDrawings.getState().bringToFront(drawing.id); setMenu(null); }}>
              Oldinga chiqarish
            </button>
            <button type="button" className="dsettings-item" onClick={() => { useDrawings.getState().duplicate(drawing.id); setMenu(null); }}>
              Nusxa olish
            </button>
            <button type="button" className="dsettings-item" onClick={() => { useDrawings.getState().setHidden(true); setMenu(null); }}>
              Barchasini yashirish
            </button>
            <span className="dsettings-sep" />
            <button type="button" className="dsettings-item danger" onClick={() => useDrawings.getState().remove(drawing.id)}>
              O'chirish
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
