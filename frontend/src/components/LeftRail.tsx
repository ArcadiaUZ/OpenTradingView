import { Crosshair, MousePointer2, Ruler, ZoomIn, ZoomOut } from "lucide-react";
import { useTerminal, type ToolId } from "../store";

const TOOLS: { id: ToolId; icon: typeof MousePointer2; title: string }[] = [
  { id: "cursor", icon: MousePointer2, title: "Kursor" },
  { id: "crosshair", icon: Crosshair, title: "Crosshair (shamga yopishadi)" },
  { id: "measure", icon: Ruler, title: "O'lchash — birinchi nuqtani bosing, keyin ikkinchisini" },
];

export default function LeftRail() {
  const tool = useTerminal((s) => s.tool);
  const setTool = useTerminal((s) => s.setTool);
  const sendChartCmd = useTerminal((s) => s.sendChartCmd);

  return (
    <nav className="left-rail">
      {TOOLS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={tool === item.id ? "rail-btn active" : "rail-btn"}
            title={item.title}
            onClick={() => setTool(item.id)}
          >
            <Icon size={17} />
          </button>
        );
      })}
      <div className="rail-sep" />
      <button className="rail-btn" title="Yaqinlashtirish" onClick={() => sendChartCmd("zoomIn")}>
        <ZoomIn size={17} />
      </button>
      <button className="rail-btn" title="Uzoqlashtirish" onClick={() => sendChartCmd("zoomOut")}>
        <ZoomOut size={17} />
      </button>
    </nav>
  );
}
