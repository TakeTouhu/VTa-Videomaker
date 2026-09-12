import type { CurveSettings } from "@/types/color";
import { LINEAR_CURVE, hasCurveAdjustment } from "@/types/color";
import { CURVE_TABLE_SIZE, curveFilterId, curveTableValues } from "@/features/color/preview";

interface CurveFilterDefsProps {
  curves: CurveSettings | undefined;
}

/**
 * Emits the SVG filter that approximates tone curves in the preview.
 *
 * CSS has no curve primitive, so the curve is sampled into an SVG
 * feComponentTransfer table. Export uses FFmpeg's own `curves` filter.
 */
export function CurveFilterDefs({ curves }: CurveFilterDefsProps) {
  if (!hasCurveAdjustment(curves)) return null;

  const rgb = curves?.rgb ?? LINEAR_CURVE;
  const red = curves?.red ?? LINEAR_CURVE;
  const green = curves?.green ?? LINEAR_CURVE;
  const blue = curves?.blue ?? LINEAR_CURVE;

  // The master curve is applied first, then the per-channel curves, matching
  // the order FFmpeg's curves filter uses.
  return (
    <svg className="absolute h-0 w-0" aria-hidden focusable="false">
      <defs>
        <filter id={curveFilterId(curves)} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={curveTableValues(rgb)} />
            <feFuncG type="table" tableValues={curveTableValues(rgb)} />
            <feFuncB type="table" tableValues={curveTableValues(rgb)} />
          </feComponentTransfer>
          <feComponentTransfer>
            <feFuncR type="table" tableValues={curveTableValues(red)} />
            <feFuncG type="table" tableValues={curveTableValues(green)} />
            <feFuncB type="table" tableValues={curveTableValues(blue)} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export { CURVE_TABLE_SIZE };
