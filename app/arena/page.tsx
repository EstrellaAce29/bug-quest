import type { Metadata } from 'next';
import Arena from './arena';
export const metadata: Metadata = { title: 'Bug Quest', description: 'Coach an agent. Catch silent data bugs. Three rounds, one leaderboard.' };
export default function ArenaPage() { return <Arena />; }
