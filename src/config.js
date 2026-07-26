export const LIMITS = {
  sessionTtlSec: 90 * 24 * 3600,
  pollSignatureWindowSec: 300,
  sourceFailureThreshold: 3,
  sourceRetryAfterSec: 3600,
  defaultNotifyThreshold: 78,
  renotifyDropRatio: 0.9,
  maxFeedRows: 200,
};

export const CATEGORY_WEIGHTS = {
  monitor: 1.2,
  gpu: 1.15,
  ssd: 1.1,
  cpu: 1.1,
  ram: 1.0,
  motherboard: 1.0,
  psu: 1.0,
  case: 0.9,
  cooler: 0.9,
  keyboard: 1.0,
  mouse: 1.0,
  headset: 1.0,
  audio: 1.0,
  webcam: 0.8,
  unknown: 0.5,
};
