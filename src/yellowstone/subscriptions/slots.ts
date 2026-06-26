import {
  SubscribeRequest,
  SubscribeRequestFilterSlots,
  SubscribeUpdateSlot,
  CommitmentLevel,
} from "@triton-one/yellowstone-grpc"
import type { SlotUpdate } from "../types.js"

const SLOT_CONFIRMED = 1
const SLOT_FINALIZED = 2

export function buildSlotRequest(fromSlot?: bigint): SubscribeRequest {
  const slots: Record<string, SubscribeRequestFilterSlots> = {
    all: SubscribeRequestFilterSlots.create({
      filterByCommitment: true,
    }),
  }

  const req = SubscribeRequest.create({
    slots,
    commitment: CommitmentLevel.PROCESSED,
  })

  if (fromSlot !== undefined && fromSlot > BigInt(0)) {
    req.fromSlot = fromSlot.toString()
  }

  return req
}

function parseSlotStatus(status: number): SlotUpdate["status"] {
  if (status === SLOT_CONFIRMED) return "confirmed"
  if (status === SLOT_FINALIZED) return "root"
  return "processed"
}

export function parseSlotUpdate(update: SubscribeUpdateSlot): SlotUpdate {
  return {
    slot: BigInt(update.slot),
    parent: update.parent ? BigInt(update.parent) : null,
    status: parseSlotStatus(update.status),
    timestamp: Date.now(),
  }
}
