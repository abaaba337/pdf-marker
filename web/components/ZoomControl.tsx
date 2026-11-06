import { stepZoom } from "@/lib/store";

export function ZoomControl({ zoom }: { zoom: number }) {
  return (
    <div id="zoom">
      <button title="缩小" aria-label="缩小" onClick={() => stepZoom(1 / 1.2)}>
        −
      </button>
      <span id="zoomLabel">{Math.round(zoom * 100)}%</span>
      <button title="放大" aria-label="放大" onClick={() => stepZoom(1.2)}>
        +
      </button>
    </div>
  );
}
