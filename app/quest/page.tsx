import type { Metadata } from 'next';
import Quest from './quest';
export const metadata: Metadata = { title: 'Bug Quest', description: 'Start an AI testing quest: catch silent pipeline bugs, auto-fix, and verify with Kane and SQL.' };
export default function QuestPage() { return <Quest />; }
