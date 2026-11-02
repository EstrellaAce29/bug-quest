import type { Metadata } from 'next';
import Stage from './stage';
export const metadata: Metadata = { title: 'Bug Quest · Stage', description: 'Watch your testing agents catch bugs and verify fixes live.' };
export default function StagePage() { return <Stage />; }
