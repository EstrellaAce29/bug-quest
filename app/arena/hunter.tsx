export const HUNTERS = [
  { name: 'Moss Scout', body: '#a7ef77', dark: '#477e39', accent: '#e7ffa5' },
  { name: 'Coral Ranger', body: '#ff9687', dark: '#b54d65', accent: '#ffdb96' },
  { name: 'Tide Tracker', body: '#81d8ff', dark: '#4378af', accent: '#aff8e4' },
  { name: 'Orbit Sleuth', body: '#c5a1ff', dark: '#7656aa', accent: '#ffcaed' },
];

// Original vector bug-hunters, drawn here rather than derived from existing IP.
export default function Hunter({ index, happy = false }: { index: number; happy?: boolean }) {
  const color = HUNTERS[index % HUNTERS.length];
  return <svg viewBox="0 0 200 220" role="img" aria-label={color.name} className="hunter-svg">
    <g stroke="#263047" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M72 172v23l-18 8v7h34v-38m40 0v23l18 8v7h-34v-38" fill={color.dark} />
      <rect x="48" y="106" width="28" height="60" rx="12" fill={color.dark} />
      <path d="M145 119l17 18 7-7 9 10-15 18-26-22" fill={color.body} />
      <path d="M58 122l-17 19-9-7-8 11 18 16 24-23" fill={color.body} />
      <rect x="62" y="104" width="77" height="76" rx="21" fill={color.body} />
      <path d="M72 150h57v18H72z" fill={color.dark} strokeWidth="3" />
      <path d="M87 124h27m-13-12v25" stroke={color.dark} strokeWidth="4" />
      <circle cx="101" cy="155" r="11" fill={color.accent} />
      <path d="M96 155h10m-5-5v10" strokeWidth="2.5" />
      <path d={index % 2 === 0 ? 'M100 37V19m-7-2 7-7 7 7' : 'M81 36 68 23m51 13 13-13'} fill="none" stroke={color.body} />
      <circle cx={index % 2 === 0 ? 100 : 68} cy={index % 2 === 0 ? 12 : 21} r="7" fill={color.accent} />
      {index % 2 === 1 && <circle cx="133" cy="21" r="7" fill={color.accent} />}
      <rect x="46" y="42" width="108" height="75" rx={index === 2 ? 30 : 22} fill={color.body} />
      <path d="M46 73h-9v19h9m108-19h9v19h-9" fill={color.dark} />
      <rect x="59" y="57" width="82" height="41" rx="14" fill="#263047" stroke="none" />
      {happy ? <g fill="none" stroke={color.accent} strokeWidth="5"><path d="m72 80 7-6 7 6m28 0 7-6 7 6" /></g> : <g fill={color.accent} stroke="none"><rect x="74" y="69" width="11" height="17" rx="5" /><rect x="115" y="69" width="11" height="17" rx="5" /></g>}
      <path d={happy ? 'M91 94q10 12 20 0' : 'M93 102h15'} fill="none" stroke={happy ? color.accent : color.dark} strokeWidth="3" />
      <path d="M65 49h17" stroke={color.accent} strokeWidth="4" />
      {index === 1 && <path d="m140 42 12-7 9 8-13 8" fill={color.accent} />}
      {index === 3 && <path d="m84 39 5-12h22l5 12" fill={color.accent} />}
      <circle cx="169" cy="125" r="16" fill={color.accent} fillOpacity=".8" strokeWidth="4" />
      <path d="m179 137 10 12" stroke={color.dark} strokeWidth="7" />
      <path d="m163 125 4-4 7 2m-8 3 4 4" fill="none" stroke={color.dark} strokeWidth="2" />
    </g>
  </svg>;
}
