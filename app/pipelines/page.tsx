import { readBugs } from '@/lib/config';
import PipelineMonitor from './pipeline-monitor';
export const dynamic = 'force-dynamic';
export default async function Pipelines() {
  return <PipelineMonitor bugs={await readBugs()} />;
}
