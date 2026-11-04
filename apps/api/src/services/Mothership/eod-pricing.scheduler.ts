import { applyPendingEodUpdates, getEodPricingTime, nextEod, setEodPricingTime } from './eod-pricing.service';

const RETRY_DELAY_MS = 60_000;
let activeTimer: { setTime: (time: string) => string } | undefined;

export function setRunningEodPricingTime(time: string): string {
  if (!activeTimer) return setEodPricingTime(time);
  return activeTimer.setTime(time);
}

/**
 * Runs EOD pricing with the built-in JavaScript timer. The database claim in
 * processEodUpdate keeps retries and multiple API instances idempotent.
 */
export function startEodPricingTimer() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const scheduleNext = (delay: number) => {
    if (closed) return;
    timer = setTimeout(() => {
      void runAndSchedule();
    }, Math.max(0, delay));
  };

  const runAndSchedule = async () => {
    try {
      const result = await applyPendingEodUpdates();
      console.log('[EOD pricing] timer run complete', result);
      scheduleNext(Date.parse(nextEod()) - Date.now());
    } catch (error) {
      console.error('[EOD pricing] timer run failed; retrying in one minute', error);
      scheduleNext(RETRY_DELAY_MS);
    }
  };

  void runAndSchedule();
  const controller = {
    setTime: (time: string) => {
      const selectedTime = setEodPricingTime(time);
      if (timer) clearTimeout(timer);
      scheduleNext(Date.parse(nextEod()) - Date.now());
      console.log(`[EOD pricing] next run set to ${selectedTime} (${getEodPricingTime()})`);
      return selectedTime;
    },
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (activeTimer === controller) activeTimer = undefined;
    },
  };
  activeTimer = controller;
  return controller;
}
