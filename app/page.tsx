'use client';

import { useState, useEffect } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { WizardNav } from '@/components/WizardNav';
import { IntakeStep } from '@/components/IntakeStep';
import { ConfigStep } from '@/components/ConfigStep';
import { ExecutionStep } from '@/components/ExecutionStep';
import { SystemTelemetryPanel } from '@/components/SystemTelemetryPanel';

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const { currentStep, setCurrentStep, isTicketValid, isConfigValid } = useTicketStore();
  const { isVisible: telemetryVisible } = useTelemetryStore();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  const steps = [
    { number: 1, title: 'Ingestion', completed: isTicketValid() },
    { number: 2, title: 'Parameters', completed: isConfigValid() },
    { number: 3, title: 'Execution', completed: false },
  ];

  const handleStepClick = (step: number) => {
    if (step === 1) {
      setCurrentStep(1);
    } else if (step === 2 && isTicketValid()) {
      setCurrentStep(2);
    } else if (step === 3 && isTicketValid() && isConfigValid()) {
      setCurrentStep(3);
    }
  };

  const bottomPadding = telemetryVisible ? 'pb-28' : '';

  return (
    <div className={`min-h-screen bg-slate-950 ${bottomPadding}`}>
      {currentStep !== 3 && (
        <WizardNav
          steps={steps}
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />
      )}

      {currentStep === 1 && (
        <IntakeStep onNext={() => setCurrentStep(2)} />
      )}

      {currentStep === 2 && (
        <ConfigStep
          onNext={() => setCurrentStep(3)}
          onBack={() => setCurrentStep(1)}
        />
      )}

      {currentStep === 3 && (
        <ExecutionStep onBack={() => setCurrentStep(2)} />
      )}

      <SystemTelemetryPanel />
    </div>
  );
}
