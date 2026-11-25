import { useTerminal } from "../store";

export default function Toast() {
  const toast = useTerminal((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" key={toast.id}>
      {toast.text}
    </div>
  );
}
