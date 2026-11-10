export interface ProbabilityEstimate {
  status: 'validated' | 'unavailable';
  target: 'macro-direction-close-4h';
  horizonHours: 4;
  direction: 'up' | 'down' | null;
  /** Probability in [0,1], never signed. Null means it cannot be estimated reliably. */
  value: number | null;
  interval95: [number, number] | null;
  calibrationSamples: number;
  validationSamples: number;
  modelId: string | null;
  validUntil: string | null;
  reason: string;
}
