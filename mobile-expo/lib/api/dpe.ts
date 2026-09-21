// Typed client for mobile-dpe -- the AI DPE oral-practice examiner.
// start/message/end mirror web's dpe-chat exactly (see mobile-dpe/
// index.ts's own header comment); resume/history are mobile-only
// additions. Every response is runtime-validated before being handed to
// a screen, matching every other lib/api/*.ts file in this folder.
import type {
  MobileDpeHistoryResponse,
  MobileDpeResumeResponse,
  MobileDpeTurnResponse,
} from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isValidDpeHistoryResponse, isValidDpeResumeResponse, isValidDpeTurnResponse } from './validate'

function validateTurnResponse(data: unknown, context: string): MobileDpeTurnResponse {
  assertShape(isValidDpeTurnResponse(data), context, data)
  return data as MobileDpeTurnResponse
}

export async function startDpeSession(): Promise<MobileDpeTurnResponse> {
  const data = await invokeMobileFunction<MobileDpeTurnResponse, { action: 'start' }>('mobile-dpe', { action: 'start' })
  return validateTurnResponse(data, 'startDpeSession')
}

export async function sendDpeMessage(sessionId: string, message: string): Promise<MobileDpeTurnResponse> {
  const data = await invokeMobileFunction<MobileDpeTurnResponse, { action: 'message'; sessionId: string; message: string }>('mobile-dpe', {
    action: 'message',
    sessionId,
    message,
  })
  return validateTurnResponse(data, 'sendDpeMessage')
}

export async function endDpeSession(sessionId: string): Promise<MobileDpeTurnResponse> {
  const data = await invokeMobileFunction<MobileDpeTurnResponse, { action: 'end'; sessionId: string }>('mobile-dpe', {
    action: 'end',
    sessionId,
  })
  return validateTurnResponse(data, 'endDpeSession')
}

export async function resumeDpeSession(sessionId: string): Promise<MobileDpeResumeResponse> {
  const data = await invokeMobileFunction<MobileDpeResumeResponse, { action: 'resume'; sessionId: string }>('mobile-dpe', {
    action: 'resume',
    sessionId,
  })
  assertShape(isValidDpeResumeResponse(data), 'resumeDpeSession', data)
  return data as MobileDpeResumeResponse
}

export async function fetchDpeHistory(limit?: number): Promise<MobileDpeHistoryResponse> {
  const data = await invokeMobileFunction<MobileDpeHistoryResponse, { action: 'history'; limit?: number }>('mobile-dpe', {
    action: 'history',
    ...(limit !== undefined ? { limit } : {}),
  })
  assertShape(isValidDpeHistoryResponse(data), 'fetchDpeHistory', data)
  return data as MobileDpeHistoryResponse
}
