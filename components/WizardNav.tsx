'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type Step = {
  number: number;
  title: string;
  completed: boolean;
};

type WizardNavProps = {
  steps: Step[];
  currentStep: number;
  onStepClick?: (step: number) => void;
};

export function WizardNav({ steps, currentStep, onStepClick }: WizardNavProps) {
  return (
    <div className="flex items-center justify-center gap-2 p-2 border-b border-slate-800">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center">
          <button
            onClick={() => onStepClick?.(step.number)}
            disabled={!step.completed && step.number > currentStep}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 transition-all',
              currentStep === step.number && 'text-slate-100',
              step.completed && 'text-slate-300',
              step.number > currentStep && !step.completed && 'text-slate-500 cursor-not-allowed'
            )}
          >
            <div
              className={cn(
                'flex items-center justify-center w-5 h-5 rounded-sm border',
                currentStep === step.number && 'border-blue-500 bg-blue-500 text-slate-950',
                step.completed && 'border-green-600 bg-green-600 text-slate-950',
                step.number > currentStep && 'border-slate-700 text-slate-600'
              )}
            >
              {step.completed ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="text-[10px] font-bold">{step.number}</span>
              )}
            </div>
            <span className="text-xs font-medium uppercase tracking-wide">
              {step.title}
            </span>
          </button>
          {index < steps.length - 1 && (
            <div className="h-px w-6 bg-slate-800 mx-1" />
          )}
        </div>
      ))}
    </div>
  );
}
