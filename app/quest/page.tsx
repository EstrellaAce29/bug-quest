import type { Metadata } from 'next';
import Quest from './quest';
export const metadata: Metadata = { title: 'Bug Quest', description: 'Replay real Kane runs: find the silent pipeline bug, fix it, and verify the result.' };
export default function QuestPage() { return <Quest />; }
