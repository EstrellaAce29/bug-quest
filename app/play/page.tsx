import type { Metadata } from 'next';
import Play from './play';
export const metadata: Metadata = { title: 'Bug Quest', description: 'Coach an agent. Catch silent data bugs. Three rounds, one leaderboard.' };
export default function PlayPage() { return <Play />; }
