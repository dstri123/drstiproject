export function viridisColor(t) {
  const stops = [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.15],
    [0.993, 0.906, 0.144],
  ];
  const clamped = Math.min(1, Math.max(0, t));
  const idx = clamped * (stops.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(stops.length - 1, i0 + 1);
  const f = idx - i0;
  const c0 = stops[i0],
    c1 = stops[i1];
  const r = c0[0] + (c1[0] - c0[0]) * f;
  const g = c0[1] + (c1[1] - c0[1]) * f;
  const b = c0[2] + (c1[2] - c0[2]) * f;
  return `#${[r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Same as df_filtered[selected_param].notna() + min/max normalize in the Python script
export function buildColorMap(cameraTableData, columnKey) {
  const entries = Object.entries(cameraTableData)
    .map(([camId, row]) => [camId, parseFloat(row?.[columnKey])])
    .filter(([, v]) => Number.isFinite(v));

  if (!entries.length) return { colors: {}, min: null, max: null };

  const values = entries.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const colors = {};
  entries.forEach(([camId, v]) => {
    colors[camId] = viridisColor((v - min) / range);
  });

  return { colors, min, max };
}