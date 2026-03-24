"use client";

export function AnalyzingView({
  displayUsername,
  steps,
  progress,
}: {
  displayUsername: string;
  steps: ReadonlyArray<{ id: string; label: string; state: string }>;
  progress: number;
}) {
  return (
    <main className="mp-page mp-analyzing">
      <section className="mp-analyzing-card">
        <p className="mp-kicker mp-pulse">PROCESSING</p>
        <h2>Analyzing {displayUsername}&apos;s listening history...</h2>
        <div className="mp-status-lines">
          {steps.map((step) => (
            <div key={step.id} className={`mp-status-line is-${step.state}`}>
              <span />
              <p>{step.label}</p>
            </div>
          ))}
        </div>
        <div className="mp-progress-track">
          <div className="mp-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>
    </main>
  );
}
