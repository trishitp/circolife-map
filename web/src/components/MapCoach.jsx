import { useState } from 'react';
import { COACH_STEPS, advanceCoach, coachStepIndex, dismissCoach } from '../lib/mapOnboarding';

export default function MapCoach() {
  const [step, setStep] = useState(() => coachStepIndex());
  if (step < 0 || step >= COACH_STEPS.length) return null;
  const s = COACH_STEPS[step];

  const next = () => {
    const n = advanceCoach();
    setStep(n);
  };

  return (
    <div className="map-coach" role="status">
      <div className="map-coach-body">
        <strong>{s.title}</strong>
        <p>{s.body}</p>
      </div>
      <div className="map-coach-actions">
        <span className="map-coach-progress">{step + 1}/{COACH_STEPS.length}</span>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => { dismissCoach(); setStep(-1); }}
        >
          Dismiss
        </button>
        <button type="button" className="btn sm" onClick={next}>
          {step + 1 >= COACH_STEPS.length ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
}