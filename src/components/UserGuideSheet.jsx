import { AlertTriangle, ArrowRight } from "lucide-react";
import { MobileBottomSheet } from "./MobileBottomSheet";

// "How to use TaxiFlow": shown once after the first sign-in to a workspace and
// again from the Help button. Every way out (Skip, Close, Escape, Done or a
// step button) counts as seen; the parent remembers that per user and workspace.
// Stays mounted while closed so the sheet can hand focus back to where it was;
// the guide content is only built while it is open.
export function UserGuideSheet({ open, getGuide, onClose, onNavigate }) {
  const guide = open ? getGuide() : null;

  if (!guide) {
    return <MobileBottomSheet open={false} onClose={onClose} />;
  }

  const firstStep = guide.firstStep;

  return (
    <MobileBottomSheet
      open
      className="user-guide-root"
      eyebrow={`Guide for ${guide.role}`}
      title={guide.title}
      subtitle={guide.intro}
      onClose={onClose}
      closeLabel="Close guide"
      initialFocusSelector="[data-guide-primary='true']"
      footer={
        <div className="user-guide-footer">
          <button type="button" className="action-button user-guide-secondary" onClick={onClose}>
            Skip for now
          </button>
          {firstStep?.actionLabel ? (
            <button
              type="button"
              className="action-button user-guide-primary"
              data-guide-primary="true"
              onClick={() => onNavigate(firstStep.view)}
            >
              Start: {firstStep.title}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="action-button user-guide-primary"
              data-guide-primary="true"
              onClick={onClose}
            >
              Done
            </button>
          )}
        </div>
      }
    >
      <div className="user-guide-body">
        {firstStep ? (
          <section className="user-guide-first" aria-labelledby="user-guide-first-heading">
            <p className="eyebrow" id="user-guide-first-heading">
              Do this first
            </p>
            <p>
              <strong>{firstStep.title}</strong> (step {guide.steps.indexOf(firstStep) + 1} below).
            </p>
          </section>
        ) : null}

        {guide.steps.length > 0 ? (
          <section aria-labelledby="user-guide-steps-heading">
            <h4 id="user-guide-steps-heading">Your day, step by step</h4>
            <ol className="user-guide-steps">
              {guide.steps.map((step) => (
                <li key={step.id} className="user-guide-step">
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                  {step.example ? <p className="user-guide-example">{step.example}</p> : null}
                  {step.actionLabel ? (
                    <button
                      type="button"
                      className="action-button user-guide-step-action"
                      onClick={() => onNavigate(step.view)}
                    >
                      {step.actionLabel}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {guide.warnings.length > 0 ? (
          <section aria-labelledby="user-guide-warnings-heading">
            <h4 id="user-guide-warnings-heading">Good to know</h4>
            {guide.warnings.map((item) => (
              <article key={item.id} className="user-guide-warning" data-testid={`guide-warning-${item.id}`}>
                <strong>
                  <AlertTriangle size={16} aria-hidden="true" /> {item.title}
                </strong>
                <dl>
                  <dt>What happened</dt>
                  <dd>{item.what}</dd>
                  <dt>Why it matters</dt>
                  <dd>{item.why}</dd>
                  <dt>What to do</dt>
                  <dd>{item.todo}</dd>
                </dl>
              </article>
            ))}
          </section>
        ) : null}

        <p className="panel-note">You can open this guide again at any time from the Help button at the top.</p>
      </div>
    </MobileBottomSheet>
  );
}
