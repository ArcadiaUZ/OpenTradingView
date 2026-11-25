import { X } from "lucide-react";
import { useTerminal } from "../store";

export default function SettingsDialog() {
  const open = useTerminal((s) => s.settingsOpen);
  const setOpen = useTerminal((s) => s.setSettingsOpen);
  const settings = useTerminal((s) => s.settings);
  const setSetting = useTerminal((s) => s.setSetting);

  if (!open) return null;

  const rows: { key: "grid" | "crosshair" | "countdown"; label: string; hint: string }[] = [
    { key: "grid", label: "To'r chiziqlar", hint: "Gorizontal va vertikal grid" },
    { key: "crosshair", label: "Crosshair", hint: "Sichqoncha kesishmasi" },
    { key: "countdown", label: "Sham taymeri", hint: "Narx yonidagi qolgan vaqt" },
  ];

  return (
    <div className="settings-backdrop" onClick={() => setOpen(false)}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <span>Sozlamalar</span>
          <button className="icon-btn tiny" title="Yopish" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        </div>
        <div className="settings-body">
          {rows.map((row) => (
            <div className="settings-row" key={row.key}>
              <div>
                <div className="settings-label">{row.label}</div>
                <div className="settings-hint">{row.hint}</div>
              </div>
              <button
                className={settings[row.key] ? "switch on" : "switch"}
                onClick={() => setSetting(row.key, !settings[row.key])}
                aria-label={row.label}
              >
                <span className="switch-knob" />
              </button>
            </div>
          ))}
        </div>
        <div className="settings-foot">Ctrl+K — instrument qidirish · Esc — yopish</div>
      </div>
    </div>
  );
}
