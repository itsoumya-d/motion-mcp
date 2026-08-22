export const HUMAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">
  <g id="shadow"><ellipse cx="100" cy="248" rx="52" ry="8" fill="#000" opacity="0.15"/></g>
  <g id="leg-left"><rect x="84" y="190" width="14" height="58" rx="6"/></g>
  <g id="leg-right"><rect x="102" y="190" width="14" height="58" rx="6"/></g>
  <g id="body"><rect x="72" y="120" width="56" height="78" rx="18"/></g>
  <g id="arm-left"><rect x="50" y="126" width="16" height="62" rx="8"/></g>
  <g id="arm-right"><rect x="134" y="126" width="16" height="62" rx="8"/></g>
  <g id="head">
    <circle cx="100" cy="76" r="38"/>
    <g id="eye-left"><circle cx="86" cy="70" r="6"/></g>
    <g id="eye-right"><circle cx="114" cy="70" r="6"/></g>
    <path id="mouth-smile" d="M88 92 Q100 102 112 92"/>
  </g>
</svg>`;

export const CROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <g id="tail"><path d="M60 150 L20 178 L64 168 Z"/></g>
  <g id="leg-left"><rect x="96" y="158" width="7" height="34"/></g>
  <g id="leg-right"><rect x="116" y="158" width="7" height="34"/></g>
  <g id="body"><ellipse cx="110" cy="118" rx="52" ry="42"/></g>
  <g id="wing-left"><path d="M74 96 Q40 104 46 132 Q66 140 88 124 Z"/></g>
  <g id="wing-right"><path d="M146 96 Q180 104 174 132 Q154 140 132 124 Z"/></g>
  <g id="head">
    <circle cx="152" cy="62" r="26"/>
    <g id="eye-left"><circle cx="146" cy="56" r="4.5"/></g>
    <g id="eye-right"><circle cx="160" cy="56" r="4.5"/></g>
  </g>
  <polygon id="beak" points="176,58 206,66 176,74"/>
</svg>`;

export const UNNAMED_BIRD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">
  <circle cx="103" cy="48" r="5"/>
  <circle cx="121" cy="48" r="5"/>
  <ellipse cx="112" cy="105" rx="54" ry="44"/>
  <rect x="36" y="86" width="66" height="22" rx="10"/>
  <rect x="122" y="86" width="66" height="22" rx="10"/>
  <path d="M104 148 L98 186 L110 186 Z"/>
  <rect x="106" y="160" width="5" height="30"/>
  <rect x="114" y="160" width="5" height="30"/>
</svg>`;

export const DEMO_EVENT_STREAM: Array<{ action: string; atMs: number }> = [
  { action: "blink", atMs: 0 },
  { action: "wave", atMs: 400 },
  { action: "flap", atMs: 900 },
  { action: "caw", atMs: 1300 }
];
