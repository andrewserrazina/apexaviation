// Typed client for mobile-training-report -- Phase 5 (Training Report
// mobile). One thin wrapper, mirroring lib/api/readiness.ts's/
// lib/api/reviewQueue.ts's shape: validated immediately with assertShape
// before the caller ever sees the data.
import type { MobileTrainingReportAggregates } from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isValidTrainingReportAggregates } from './validate'

export async function fetchTrainingReportAggregates(): Promise<MobileTrainingReportAggregates> {
  const data = await invokeMobileFunction<MobileTrainingReportAggregates>('mobile-training-report')
  assertShape(isValidTrainingReportAggregates(data), 'fetchTrainingReportAggregates', data)
  return data
}
