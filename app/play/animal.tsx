import styles from './play.module.css';
import { ANIMALS } from '@/lib/play-character.mjs';

export const PLAYER_COLORS = [
  { body: '#b7ef91', dark: '#5e8150', accent: '#e8ffc1' },
  { body: '#ffae9e', dark: '#b97470', accent: '#ffe6c1' },
  { body: '#91d6ed', dark: '#5785a5', accent: '#c5f7e7' },
  { body: '#cfb0f3', dark: '#8970b2', accent: '#ffe1f0' },
];
const COATS: Record<string, { fur: string; dark: string; cream: string }> = {
  rabbit: { fur: '#eee1cc', dark: '#b5a294', cream: '#fff8e9' },
  wolf: { fur: '#9dabb9', dark: '#5d7083', cream: '#e8edf1' },
  fox: { fur: '#e7a064', dark: '#a66d45', cream: '#fff0d9' },
  owl: { fur: '#b99a70', dark: '#7d644c', cream: '#fff0d3' },
  bear: { fur: '#ac8268', dark: '#775745', cream: '#e7cdb0' },
  cat: { fur: '#e5bc87', dark: '#ac825d', cream: '#fff0da' },
  raccoon: { fur: '#b2b3b2', dark: '#626d7a', cream: '#f2ede2' },
  hedgehog: { fur: '#c5a27d', dark: '#80654f', cream: '#edd9bd' },
};

// Original geometric animal drawings. Shared explorer scarves identify players.
export default function Animal({ animal, index = 0, name, happy = false, thinking = false }: {
  animal: string; index?: number; name?: string; happy?: boolean; thinking?: boolean;
}) {
  const kind = ANIMALS.some(item => item === animal) ? animal : 'rabbit';
  const coat = COATS[kind]; const scarf = PLAYER_COLORS[index % PLAYER_COLORS.length];
  return <svg viewBox="0 0 200 230" role="img" aria-label={name ? `${name}, ${kind}` : `${kind} character`} className={styles.animalSvg}>
    <g stroke="#42404a" strokeWidth="3.7" strokeLinecap="round" strokeLinejoin="round" className={styles.animalBreath}>
      <g className={styles.animalTail}>
        {kind === 'fox' && <><path d="M126 172q64 20 49-68-17 23-42 15-18 15-7 53Z" fill={coat.fur} /><path d="M166 130q14-6 9-26-12 15-28 15l9 14 10-3Z" fill={coat.cream} /></>}
        {kind === 'wolf' && <path d="M133 175q49 15 38-43l-14 8-3-18q-30 17-21 53Z" fill={coat.dark} />}
        {kind === 'cat' && <path d="M132 174q48 13 36-33-5-20 9-23" fill="none" stroke={coat.fur} strokeWidth="18" />}
        {kind === 'raccoon' && <><path d="M132 180q53 13 42-57-26 8-42 26Z" fill={coat.fur} /><path d="m148 135 25 8m-36 9 38 10m-40 5 33 14" fill="none" stroke={coat.dark} strokeWidth="10" /></>}
        {kind === 'rabbit' && <circle cx="145" cy="172" r="15" fill={coat.cream} />}
        {kind === 'bear' && <circle cx="141" cy="171" r="12" fill={coat.dark} />}
        {kind === 'hedgehog' && <path d="m52 178-13-19 9-12-10-15 17-7-2-20 20 3 8-20 15 12 17-14 10 20 21-2-3 22 19 7-11 17 9 16-17 11Z" fill={coat.dark} />}
        {kind === 'owl' && <path d="m82 180 17 28 19-28" fill={coat.dark} />}
      </g>
      <ellipse cx="99" cy="159" rx="44" ry="45" fill={coat.fur} />
      <ellipse cx="99" cy="164" rx="27" ry="31" fill={coat.cream} stroke="none" />
      <ellipse cx="76" cy="201" rx="18" ry="10" fill={coat.fur} />
      <ellipse cx="122" cy="201" rx="18" ry="10" fill={coat.fur} />
      {kind === 'owl' ? <><path d="M61 140q-20 9-10 33l18-8m67-25q20 9 10 33l-18-8" fill={coat.dark} /><path d="M69 207v7m8-7v7m39-7v7m8-7v7" stroke="#bd9861" /></> : <><ellipse cx="61" cy="160" rx="12" ry="19" transform="rotate(15 61 160)" fill={coat.fur} /><ellipse cx="138" cy="158" rx="12" ry="19" transform="rotate(-19 138 158)" fill={coat.fur} /></>}
      <g className={`${styles.animalHead} ${thinking ? styles.animalThinking : ''}`}>
        <g className={styles.animalEars}>
          {kind === 'rabbit' && <><ellipse cx="72" cy="58" rx="17" ry="44" transform="rotate(-12 72 58)" fill={coat.fur} /><ellipse cx="129" cy="56" rx="17" ry="43" transform="rotate(12 129 56)" fill={coat.fur} /><path d="m69 30 7 43m56-43-7 43" stroke="#d6a8aa" strokeWidth="12" /></>}
          {['fox', 'wolf', 'cat'].includes(kind) && <><path d="m50 89-4-49 41 29m26 0 40-29-3 49" fill={coat.fur} /><path d="m56 55 3 23 15-9m69-14-3 23-15-9" fill="#d7aaa2" stroke="none" /></>}
          {['bear', 'raccoon'].includes(kind) && <><circle cx="58" cy="67" r="21" fill={coat.fur} /><circle cx="141" cy="67" r="21" fill={coat.fur} /><circle cx="58" cy="67" r="11" fill={coat.dark} stroke="none" /><circle cx="141" cy="67" r="11" fill={coat.dark} stroke="none" /></>}
          {kind === 'owl' && <path d="m57 82-8-35 39 22m24 0 39-22-8 35" fill={coat.dark} />}
          {kind === 'hedgehog' && <><circle cx="65" cy="83" r="13" fill={coat.fur} /><circle cx="133" cy="83" r="13" fill={coat.fur} /></>}
        </g>
        {kind === 'fox' || kind === 'wolf' ? <path d="M49 82q50-37 101 0l10 24-18 1 10 14-28 6q-24 34-49 0l-27-6 11-14-18-1Z" fill={coat.fur} /> : <ellipse cx="100" cy="103" rx={kind === 'hedgehog' ? 43 : 53} ry={kind === 'owl' ? 49 : 43} fill={coat.fur} />}
        {kind === 'fox' || kind === 'wolf' ? <path d="M53 111q27 2 47 23 23-21 47-23-14 34-47 33-33 0-47-33Z" fill={coat.cream} stroke="none" /> : kind === 'owl' ? <><ellipse cx="78" cy="104" rx="25" ry="30" fill={coat.cream} stroke="none" /><ellipse cx="122" cy="104" rx="25" ry="30" fill={coat.cream} stroke="none" /></> : <ellipse cx="100" cy="122" rx={kind === 'hedgehog' ? 24 : 28} ry="20" fill={coat.cream} stroke="none" />}
        {kind === 'raccoon' && <path d="M49 96q23-15 51 1 28-16 51-1l-4 21q-24 10-47-4-25 14-47-2Z" fill={coat.dark} stroke="none" />}
        {kind === 'cat' && <><path d="m88 63 3 14m18-14-2 14" stroke={coat.dark} /><path d="m61 117-18-4m19 12-18 3m94-11 18-4m-19 12 18 3" strokeWidth="2" /></>}
        <g className={styles.animalBlink}>
          {happy ? <path d="m72 106 7-6 7 6m28 0 7-6 7 6" fill="none" stroke={kind === 'raccoon' ? coat.cream : '#42404a'} strokeWidth="4" /> : <><ellipse cx="79" cy="104" rx={kind === 'owl' ? 7 : 5} ry="8" fill="#42404a" stroke={kind === 'raccoon' ? coat.cream : 'none'} strokeWidth="2" /><ellipse cx="121" cy="104" rx={kind === 'owl' ? 7 : 5} ry="8" fill="#42404a" stroke={kind === 'raccoon' ? coat.cream : 'none'} strokeWidth="2" /><circle cx="81" cy="101" r="1.7" fill="white" stroke="none" /><circle cx="123" cy="101" r="1.7" fill="white" stroke="none" /></>}
        </g>
        {kind === 'owl' ? <path d="m94 119 6 10 7-10-7-3Z" fill="#d9a75e" strokeWidth="2" /> : <><path d="m94 121 6 5 6-5q-6-5-12 0" fill="#7c6162" stroke="none" /><path d={happy ? 'M91 132q9 11 18 0' : 'M100 126v5m-8 1q8 6 16 0'} fill="none" strokeWidth="2" /></>}
        <ellipse cx="62" cy="119" rx="8" ry="4" fill="#e6a8a4" opacity=".5" stroke="none" /><ellipse cx="138" cy="119" rx="8" ry="4" fill="#e6a8a4" opacity=".5" stroke="none" />
      </g>
      <path d="m71 141 29 12 29-12-8 17-20-4-17 17-7-20Z" fill={scarf.body} strokeWidth="2.5" />
      <circle cx="137" cy="164" r="15" fill={scarf.accent} fillOpacity=".7" strokeWidth="3" /><path d="m147 176 10 12" stroke={scarf.dark} strokeWidth="7" /><path d="m132 162 4-3 5 2m-7 4 4 3" fill="none" stroke={scarf.dark} strokeWidth="2" />
    </g>
  </svg>;
}
