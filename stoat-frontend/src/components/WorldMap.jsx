import { useState, useRef, useCallback } from 'react';

const MAP_W = 800;
const MAP_H = 400;

function latLngToXY(lat, lng) {
  const x = ((lng + 180) / 360) * MAP_W;
  const y = ((90 - lat) / 180) * MAP_H;
  return { x, y };
}

function xyToLatLng(x, y) {
  const lng = (x / MAP_W) * 360 - 180;
  const lat = 90 - (y / MAP_H) * 180;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

const LAND_PATH = `M122,82L124,80L127,79L131,80L133,82L131,85L128,86L125,85Z
M155,56L159,54L165,54L170,56L174,60L176,65L174,70L170,74L165,78L160,80L155,82L150,82L145,80L141,76L140,72L141,68L143,64L146,60Z
M262,86L265,83L270,80L275,78L280,78L285,80L288,83L290,87L288,92L285,95L280,97L275,98L270,97L266,94L263,90Z
M340,50L345,48L350,48L356,50L360,54L362,58L360,63L356,67L350,70L345,72L340,72L336,70L333,66L332,62L333,58L336,54Z
M460,78L465,75L470,74L476,75L480,78L482,82L480,87L476,90L470,92L465,92L461,90L458,86L458,82Z
M395,55L400,52L408,50L415,50L420,52L424,56L425,60L424,65L420,68L415,70L408,72L400,72L395,70L392,66L390,62L392,58Z
M530,90L535,88L540,88L546,90L550,94L552,100L550,106L546,110L540,114L535,115L530,114L526,110L524,105L525,100L527,95Z
M580,70L585,68L590,68L596,70L600,74L602,78L600,83L596,86L590,88L585,88L580,86L577,82L576,78L577,74Z
M645,95L650,92L657,90L665,90L670,92L674,96L676,102L674,108L670,113L664,116L657,118L650,117L646,114L643,110L642,104L643,99Z
M176,120L180,116L186,114L192,114L198,116L202,120L204,126L202,132L198,137L192,140L186,142L180,140L176,136L174,130L174,125Z
M200,130L210,125L220,122L232,122L242,126L248,132L250,140L248,148L242,155L232,160L220,162L210,160L202,155L198,148L196,140Z
M290,115L298,110L308,108L318,108L326,112L332,118L334,126L332,134L326,140L318,144L308,146L298,144L292,140L288,134L286,126L288,120Z
M360,100L370,96L380,94L392,94L400,98L406,104L408,112L406,120L400,126L392,130L380,132L370,130L362,126L358,120L356,112L358,106Z
M430,140L440,135L452,132L464,132L474,136L480,142L482,150L480,158L474,164L464,168L452,170L440,168L432,164L428,158L426,150L428,145Z
M520,135L530,130L542,128L554,128L564,132L570,138L572,146L570,154L564,160L554,164L542,166L530,164L522,160L518,154L516,146L518,140Z
M600,130L610,126L622,124L634,124L643,128L648,134L650,142L648,150L643,155L634,160L622,162L610,160L603,156L598,150L596,142L598,136Z
M150,180L160,175L172,172L185,172L196,176L204,182L208,190L206,200L200,208L190,214L178,218L166,216L156,210L150,204L148,196L148,188Z
M250,180L262,175L276,172L290,174L300,178L308,186L310,196L308,206L300,214L290,220L276,222L262,220L252,214L248,206L246,196L248,188Z
M400,180L412,176L426,174L438,176L448,180L454,188L456,196L454,204L448,210L438,214L426,216L412,214L404,210L398,204L396,196L398,188Z
M500,200L510,195L522,192L534,194L542,198L548,204L550,212L548,220L542,226L534,230L522,232L510,230L502,226L498,220L496,212L498,206Z
M560,240L572,235L586,232L598,234L608,240L614,248L616,258L612,268L606,276L596,280L584,282L572,280L564,274L558,266L556,258L558,248Z
M160,260L174,254L190,252L206,254L218,260L226,268L228,280L226,290L218,298L206,304L190,306L174,304L164,298L158,290L156,280L158,268Z
M310,260L322,255L336,252L350,254L360,258L366,264L368,274L366,282L360,288L350,292L336,294L322,292L314,288L308,282L306,274L308,266Z
M640,180L652,176L666,174L678,176L688,180L694,188L696,196L694,204L688,210L678,214L666,216L652,214L644,210L638,204L636,196L638,188Z
M680,240L690,236L702,234L714,236L722,240L726,248L728,256L726,264L722,268L714,272L702,274L690,272L682,268L678,262L676,254L678,246Z
M80,150L90,146L102,144L114,146L122,150L128,156L130,164L128,172L122,178L114,182L102,184L90,182L82,178L78,172L76,164L78,156Z`;

function Pin({ x, y, color = '#ef4444', size = 8, label, pulsate }) {
  return (
    <g>
      {pulsate && (
        <circle cx={x} cy={y} r={size + 4} fill="none" stroke={color} strokeWidth="2" opacity="0.5">
          <animate attributeName="r" from={String(size + 2)} to={String(size + 12)} dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.6" to="0" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={x} cy={y} r={size} fill={color} stroke="#fff" strokeWidth="2" />
      {label && (
        <text x={x} y={y - size - 4} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
          {label}
        </text>
      )}
    </g>
  );
}

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function WorldMap({ onClick, myPin, markers = [], correctPin, disabled, className = '' }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const handleClick = useCallback((e) => {
    if (disabled || !onClick) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = MAP_W / rect.width;
    const scaleY = MAP_H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const { lat, lng } = xyToLatLng(x, y);
    onClick({ lat, lng });
  }, [onClick, disabled]);

  const handleMouseMove = useCallback((e) => {
    if (disabled) { setHover(null); return; }
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = MAP_W / rect.width;
    const scaleY = MAP_H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setHover({ x, y });
  }, [disabled]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className={`world-map-svg ${className}`}
      style={{ width: '100%', cursor: disabled ? 'default' : 'crosshair', userSelect: 'none' }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <rect width={MAP_W} height={MAP_H} fill="#1a2332" rx="6" />

      {/* Grid lines */}
      {[-60, -30, 0, 30, 60].map((lat) => {
        const y = ((90 - lat) / 180) * MAP_H;
        return <line key={`lat${lat}`} x1="0" y1={y} x2={MAP_W} y2={y} stroke="#2a3a4e" strokeWidth="0.5" />;
      })}
      {[-120, -60, 0, 60, 120].map((lng) => {
        const x = ((lng + 180) / 360) * MAP_W;
        return <line key={`lng${lng}`} x1={x} y1="0" x2={x} y2={MAP_H} stroke="#2a3a4e" strokeWidth="0.5" />;
      })}

      {/* Equator */}
      <line x1="0" y1={MAP_H / 2} x2={MAP_W} y2={MAP_H / 2} stroke="#3a4a5e" strokeWidth="1" strokeDasharray="4 4" />

      {/* Land masses */}
      <path d={LAND_PATH} fill="#2d4a3e" stroke="#3d6a5e" strokeWidth="0.8" opacity="0.8" />

      {/* Hover crosshair */}
      {hover && !disabled && (
        <g opacity="0.4">
          <line x1={hover.x} y1="0" x2={hover.x} y2={MAP_H} stroke="#fff" strokeWidth="0.5" strokeDasharray="3 3" />
          <line x1="0" y1={hover.y} x2={MAP_W} y2={hover.y} stroke="#fff" strokeWidth="0.5" strokeDasharray="3 3" />
        </g>
      )}

      {/* Correct answer pin */}
      {correctPin && (() => {
        const { x, y } = latLngToXY(correctPin.lat, correctPin.lng);
        return <Pin x={x} y={y} color="#10b981" size={10} label={correctPin.label || 'Answer'} pulsate />;
      })()}

      {/* Other player markers */}
      {markers.map((m, i) => {
        const { x, y } = latLngToXY(m.lat, m.lng);
        return <Pin key={m.user || i} x={x} y={y} color={PLAYER_COLORS[i % PLAYER_COLORS.length]} size={6} label={m.label} />;
      })}

      {/* My pin */}
      {myPin && (() => {
        const { x, y } = latLngToXY(myPin.lat, myPin.lng);
        return <Pin x={x} y={y} color="#f59e0b" size={8} label="You" pulsate />;
      })()}
    </svg>
  );
}

export { latLngToXY, xyToLatLng, PLAYER_COLORS };
