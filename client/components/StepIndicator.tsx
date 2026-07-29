import React from 'react';

interface Props {
  currentStep: 1 | 2 | 3 | 4;
  label: string;
}

const STEP_LABELS = [
  '① Xoay viewer → chọn góc',
  '② Locked — Vẽ Rectangle Select',
  '③ Vẽ Mask (Brush / Lasso) — trong vùng Rect',
  '④ Preview — toggle 👁 để so sánh → Apply',
];

export default function StepIndicator({ currentStep, label }: Props) {
  return (
    <div className="step-indicator">
      <div className="step-dots">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`step-dot ${step < currentStep ? 'done' : ''} ${step === currentStep ? 'active' : ''}`}
          />
        ))}
      </div>
      <span className="step-label">{label || STEP_LABELS[currentStep - 1]}</span>
    </div>
  );
}
